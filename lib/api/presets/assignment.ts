import { DateTime } from 'luxon';
import { STAFF_JOBS } from '../../constants';
import { getGroupsForRound } from '../../functions/groups-helpers';
import { sortedCompetitorsForRound } from '../../functions/sorting';
import type { RegistrantId } from '../../types/wcif';
import type { TypeComp } from '../context';
import {
  and,
  canScramble,
  competingIn,
  groupNumber,
  isDelegate,
  not,
  registered,
} from '../filters';
import {
  combineStaffScorers,
  consecutiveJobScorer,
  delegateDeprioritizer,
  disperseDelegates,
  followingGroupScorer,
  mismatchedStationScorer,
  preferenceScorer,
  priorAssignmentScorer,
  sameJobScorer,
} from '../scorers';
import type { StaffScorer } from '../staff-scorers';
import type { StageManager } from '../stages';

export interface GroupifierOptions {
  competitorsSortingRule?:
    | 'ranks'
    | 'balanced'
    | 'symmetric'
    | 'name-optimised';
  maxGroupSize?: number;
  scramblers?: number;
  runners?: number;
  judges?: number;
  noTasksForNewcomers?: boolean;
  tasksForOwnEventsOnly?: boolean;
  noRunningForForeigners?: boolean;
  printStations?: boolean;
  groupCount?: number;
  createGroups?: boolean;
  balanceStaffWorkload?: boolean;
  respectJobPreferences?: boolean;
  avoidConsecutiveSameJob?: boolean;
  keepJudgesAtStation?: boolean;
  deprioritizeDelegates?: boolean;
  avoidBeforeCompeting?: boolean;
  stages?: StageManager;
  date?: string;
}

export interface GroupifierResult {
  roundId: string;
  competitorsAssigned: number;
  staffAssigned: number;
  warnings: string[];
}

function buildStaffScorers(options: {
  balanceStaffWorkload: boolean;
  respectJobPreferences: boolean;
  avoidConsecutiveSameJob: boolean;
  keepJudgesAtStation: boolean;
  avoidBeforeCompeting: boolean;
  deprioritizeDelegates: boolean;
  date?: string;
}): StaffScorer[] {
  const {
    balanceStaffWorkload,
    respectJobPreferences,
    avoidConsecutiveSameJob,
    keepJudgesAtStation,
    avoidBeforeCompeting,
    deprioritizeDelegates,
    date,
  } = options;

  const scorers: StaffScorer[] = [];

  if (balanceStaffWorkload && date) {
    const dayStart = DateTime.fromISO(`${date}T00:00`);
    scorers.push(priorAssignmentScorer(-5, -1, dayStart));
  }

  if (respectJobPreferences) {
    scorers.push(preferenceScorer(5, 'percent-', 15, STAFF_JOBS));
  }

  if (avoidConsecutiveSameJob) {
    scorers.push(sameJobScorer(60, -5, 4, STAFF_JOBS));
    scorers.push(consecutiveJobScorer(90, -3, 0, STAFF_JOBS));
  }

  if (keepJudgesAtStation) {
    scorers.push(mismatchedStationScorer(-10));
  }

  if (avoidBeforeCompeting) {
    scorers.push(followingGroupScorer(-50, 10));
  }

  if (deprioritizeDelegates) {
    scorers.push(delegateDeprioritizer(-1000));
  }

  return scorers;
}

function assignCompetitors(
  tc: TypeComp,
  roundId: string,
  eventId: string,
  options: {
    maxGroupSize: number;
    competitorsSortingRule: string;
    printStations: boolean;
    groupCount?: number;
    stages?: StageManager;
    date?: string;
  },
): { assigned: number; warnings: string[] } {
  const {
    maxGroupSize,
    competitorsSortingRule,
    printStations,
    groupCount,
    stages,
    date,
  } = options;

  const needsCustomSorting = competitorsSortingRule !== 'ranks';
  let sortedCompetitors: ReturnType<typeof sortedCompetitorsForRound> | null =
    null;
  let originalOrder: Map<number, number> | undefined;

  if (needsCustomSorting) {
    const existingGroups = getGroupsForRound(tc.competition, roundId);
    if (existingGroups.length === 0 && groupCount) {
      tc.round(roundId).createGroups(groupCount);
    }

    sortedCompetitors = sortedCompetitorsForRound(
      tc.competition,
      roundId,
      competitorsSortingRule as Parameters<typeof sortedCompetitorsForRound>[2],
    );

    originalOrder = new Map(
      tc.competition.persons.map((p, idx) => [p.registrantId, idx]),
    );

    const sortedOrder = new Map(
      sortedCompetitors.map((p, idx) => [p.registrantId, idx]),
    );

    tc.competition.persons.sort((a, b) => {
      const orderA = sortedOrder.get(a.registrantId);
      const orderB = sortedOrder.get(b.registrantId);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return 0;
    });
  }

  try {
    const round = tc
      .round(roundId)
      .competitors(competingIn(eventId))
      .maxGroupSize(maxGroupSize);

    round.groupBy.sameCountry(4, 2).differentNames(-5);

    const competingDelegates = (
      sortedCompetitors ??
      tc.competition.persons.filter((p) => competingIn(eventId)(p))
    ).filter(isDelegate);

    if (competingDelegates.length > 0) {
      round.groupBy.custom(disperseDelegates(isDelegate, -10));
    }

    if (stages && date) {
      for (const stage of stages.all()) {
        round.groupBy.when(
          stages.personOnStage(stage.name, date),
          stages.byName(stage.name),
          10,
        );
      }
    }

    if (printStations) {
      round.stations.bySpeed(eventId, 'average');
    }

    return round.assign();
  } finally {
    if (originalOrder) {
      const order = originalOrder;
      tc.competition.persons.sort((a, b) => {
        const idxA = order.get(a.registrantId) ?? Infinity;
        const idxB = order.get(b.registrantId) ?? Infinity;
        return idxA - idxB;
      });
    }
  }
}

function assignStaffWithReduction(
  tc: TypeComp,
  roundId: string,
  eventId: string,
  options: {
    judges: number;
    scramblers: number;
    runners: number;
    staffScorers: StaffScorer[];
  },
): { assigned: number; warnings: string[] } {
  const { judges, scramblers, runners, staffScorers } = options;

  let currentJudges = judges;
  let currentScramblers = scramblers;
  let currentRunners = runners;
  const originalCounts = { judges, scramblers, runners };
  const warnings: string[] = [];

  for (let attempt = 0; attempt < 50; attempt++) {
    const builder = tc
      .staff(roundId)
      .from(registered)
      .preferFastScramblers()
      .overwrite(true);

    if (currentJudges > 0) builder.judges(currentJudges);
    if (currentScramblers > 0)
      builder.scramblers(currentScramblers, canScramble(eventId));
    if (currentRunners > 0) builder.runners(currentRunners);

    if (staffScorers.length > 0) {
      builder.scorer(combineStaffScorers(...staffScorers));
    }

    const result = builder.assign();
    const hasInsufficientStaff = result.warnings.some((w) =>
      w.includes('Not enough people'),
    );

    if (!hasInsufficientStaff) {
      if (currentJudges < originalCounts.judges) {
        warnings.push(
          `Reduced judges from ${originalCounts.judges} to ${currentJudges}`,
        );
      }
      if (currentScramblers < originalCounts.scramblers) {
        warnings.push(
          `Reduced scramblers from ${originalCounts.scramblers} to ${currentScramblers}`,
        );
      }
      if (currentRunners < originalCounts.runners) {
        warnings.push(
          `Reduced runners from ${originalCounts.runners} to ${currentRunners}`,
        );
      }

      return {
        assigned: result.assigned,
        warnings: [...result.warnings, ...warnings],
      };
    }

    if (currentJudges > 0) {
      currentJudges--;
    } else if (currentScramblers > 0) {
      currentScramblers--;
    } else if (currentRunners > 0) {
      currentRunners--;
    } else {
      warnings.push(...result.warnings);
      warnings.push('Failed to assign staff after reducing all counts');
      return { assigned: 0, warnings };
    }
  }

  return { assigned: 0, warnings: ['Staff assignment exceeded max attempts'] };
}

export function assignGroupifier(
  tc: TypeComp,
  roundId: string,
  options: GroupifierOptions = {},
): GroupifierResult {
  const {
    maxGroupSize = 18,
    scramblers = 2,
    runners = 2,
    judges,
    competitorsSortingRule = 'ranks',
    printStations = true,
    createGroups = false,
    groupCount,
    balanceStaffWorkload = false,
    respectJobPreferences = false,
    avoidConsecutiveSameJob = false,
    keepJudgesAtStation = false,
    deprioritizeDelegates = true,
    avoidBeforeCompeting = true,
    stages,
    date,
  } = options;

  const result: GroupifierResult = {
    roundId,
    competitorsAssigned: 0,
    staffAssigned: 0,
    warnings: [],
  };

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    result.warnings.push(`Invalid round ID: ${roundId}`);
    return result;
  }

  try {
    if (createGroups && groupCount) {
      tc.round(roundId).createGroups(groupCount);
    }

    const compResult = assignCompetitors(tc, roundId, eventId, {
      maxGroupSize,
      competitorsSortingRule,
      printStations,
      groupCount,
      stages,
      date,
    });
    result.competitorsAssigned = compResult.assigned;
    result.warnings.push(...compResult.warnings);

    if (judges !== undefined || scramblers > 0 || runners > 0) {
      const staffScorers = buildStaffScorers({
        balanceStaffWorkload,
        respectJobPreferences,
        avoidConsecutiveSameJob,
        keepJudgesAtStation,
        avoidBeforeCompeting,
        deprioritizeDelegates,
        date,
      });

      const staffResult = assignStaffWithReduction(tc, roundId, eventId, {
        judges: judges ?? 0,
        scramblers,
        runners,
        staffScorers,
      });
      result.staffAssigned = staffResult.assigned;
      result.warnings.push(...staffResult.warnings);
    }
  } catch (e) {
    result.warnings.push(`Error assigning ${roundId}: ${e}`);
  }

  return result;
}

export function assignAllRounds(
  tc: TypeComp,
  options: GroupifierOptions = {},
): GroupifierResult[] {
  const results: GroupifierResult[] = [];

  const rounds = tc.competition.events.flatMap((e) =>
    e.rounds.map((r) => r.id),
  );

  for (const roundId of rounds) {
    if (!roundId.endsWith('-r1')) continue;

    const eventId = roundId.split('-')[0];
    if (eventId === '333fm' || eventId === '333mbf') continue;

    const result = assignGroupifier(tc, roundId, options);
    results.push(result);

    console.log(
      `✓ ${roundId}: ${result.competitorsAssigned} competitors, ${result.staffAssigned} staff`,
    );
  }

  return results;
}

export interface StandardStaffOptions {
  judges?: number;
  scramblers?: number;
  runners?: number;
  overwrite?: boolean;
}

export function assignRound(
  tc: TypeComp,
  roundId: string,
  options: { maxGroupSize?: number } & StandardStaffOptions = {},
): void {
  const {
    maxGroupSize = 20,
    judges = Math.ceil((options.maxGroupSize ?? 20) * 0.4),
    scramblers = 2,
    runners = 2,
  } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) throw new Error(`Invalid round ID: ${roundId}`);

  const round = tc
    .round(roundId)
    .competitors(competingIn(eventId))
    .maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4, 2).differentNames(-5);
  round.stations.bySpeed(eventId, 'average');
  round.assign();

  tc.staff(roundId)
    .from(registered)
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(true)
    .assign();
}

export function assignStaff(
  tc: TypeComp,
  roundId: string,
  options: StandardStaffOptions = {},
): void {
  const { judges = 8, scramblers = 2, runners = 2, overwrite = true } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) throw new Error(`Invalid round ID: ${roundId}`);

  tc.staff(roundId)
    .from(registered)
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(overwrite)
    .assign();
}

export function assignWaveStaff(
  tc: TypeComp,
  roundId: string,
  waveNumber: number,
  staffPool: (person: { registrantId: RegistrantId }) => boolean,
  options: StandardStaffOptions = {},
): void {
  const { judges = 6, scramblers = 2, runners = 2, overwrite = true } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) throw new Error(`Invalid round ID: ${roundId}`);

  tc.staff(roundId)
    .from(staffPool)
    .groups(groupNumber(waveNumber))
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(overwrite)
    .assign();
}

export function assignBlindfolded(
  tc: TypeComp,
  roundId: string,
  options: { maxGroupSize?: number } & StandardStaffOptions = {},
): void {
  const {
    maxGroupSize = 12,
    judges = Math.ceil((options.maxGroupSize ?? 12) * 0.5),
    scramblers = 2,
    runners = 2,
  } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) throw new Error(`Invalid round ID: ${roundId}`);

  const round = tc
    .round(roundId)
    .competitors(competingIn(eventId))
    .maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4, 2).differentNames(-5);
  round.stations.bySpeed(eventId, 'single');
  round.assign();

  tc.staff(roundId)
    .from(and(registered, not(competingIn(eventId))))
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(true)
    .assign();
}
