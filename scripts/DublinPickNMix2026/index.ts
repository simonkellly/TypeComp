import {
  assignGroupifier,
  assignParallelEvents,
  assignStationsBySpeed,
  canScramble,
  clearEmptyGroups,
  combineStaffScorers,
  competingIn,
  competingInAny,
  createTypeComp,
  delegateDeprioritizer,
  fastestScrambler,
  followingGroupScorer,
  getActivityById,
  getGroupNumber,
  groupNumber,
  PersonalBest,
  parseActivityCode,
  registered,
  removeOrphanAssignments,
} from '@/lib';
import {
  getRoomByActivity,
  maxActivityId,
} from '@/lib/functions/groups-helpers';
import { AssignMisc } from '@/lib/functions/staff';
import type { JobDefinition } from '@/lib/types/core';
import { ASSIGNMENT_OPTIONS, COMPETITION_ID, WAVE_EXCLUSIONS } from './config';
import { classifyRounds } from './util';

const { maxGroupSize, scramblers, runners } = ASSIGNMENT_OPTIONS;

const tc = await createTypeComp(COMPETITION_ID);
const { normalRounds, parallelEventGroups } = classifyRounds(tc);

console.log('\n=== Assigning First Rounds ===\n');

const blindfoldedRoundId = '333bf-r1';
if (normalRounds.includes(blindfoldedRoundId)) {
  const competitors = tc.persons.filter(competingIn('333bf'));
  if (competitors.length > 0) {
    const ONE_MINUTE_CS = 6000;
    const slowCompetitors = competitors.filter((p) => {
      const pbSingle = PersonalBest(p, '333bf', 'single');
      return pbSingle === null || pbSingle >= ONE_MINUTE_CS;
    });
    const fastCompetitors = competitors.filter((p) => {
      const pbSingle = PersonalBest(p, '333bf', 'single');
      return pbSingle !== null && pbSingle < ONE_MINUTE_CS;
    });

    tc.round(blindfoldedRoundId).createGroups(2);

    const roundBuilder = tc.round(blindfoldedRoundId);
    if (slowCompetitors.length > 0) {
      roundBuilder.manuallyAssign((p) => slowCompetitors.includes(p), 1);
    }
    if (fastCompetitors.length > 0) {
      roundBuilder.manuallyAssign((p) => fastCompetitors.includes(p), 2);
    }

    roundBuilder.stations.bySpeed('333bf', 'single');
    roundBuilder.assign();

    const staffScorer = combineStaffScorers(
      fastestScrambler('333bf'),
      followingGroupScorer(-50, 10),
      delegateDeprioritizer(-1000),
    );

    const defaultJudges = ASSIGNMENT_OPTIONS.judges ?? 0;
    let staffAssigned = 0;

    if (slowCompetitors.length > 0 && defaultJudges > 0) {
      const groupJudges = Math.min(defaultJudges, slowCompetitors.length);
      const staffResult = tc
        .staff(blindfoldedRoundId)
        .groups(groupNumber(1))
        .from(registered)
        .judges(groupJudges)
        .scramblers(scramblers, canScramble('333bf'))
        .runners(runners)
        .preferFastScramblers()
        .scorer(staffScorer)
        .avoidConflicts(true)
        .overwrite(true)
        .assign();
      staffAssigned += staffResult.assigned;
    }

    if (fastCompetitors.length > 0 && defaultJudges > 0) {
      const groupJudges = Math.min(defaultJudges, fastCompetitors.length);
      const staffResult = tc
        .staff(blindfoldedRoundId)
        .groups(groupNumber(2))
        .from(registered)
        .judges(groupJudges)
        .scramblers(scramblers, canScramble('333bf'))
        .runners(runners)
        .preferFastScramblers()
        .scorer(staffScorer)
        .avoidConflicts(true)
        .overwrite(true)
        .assign();
      staffAssigned += staffResult.assigned;
    }

    tc.round(blindfoldedRoundId).scrambleSetCountFromUniqueGroups();
    console.log(
      `✓ ${blindfoldedRoundId}: ${slowCompetitors.length} slow + ${fastCompetitors.length} fast = ${competitors.length} competitors, ${staffAssigned} staff`,
    );
  }
}

for (const roundId of normalRounds) {
  const parsed = parseActivityCode(roundId);
  if (!parsed || parsed.roundNumber !== 1) continue;

  if (roundId === blindfoldedRoundId) continue;

  const competitors = tc.persons.filter(competingIn(parsed.eventId));
  if (competitors.length === 0) continue;

  const groupCount = Math.ceil(competitors.length / maxGroupSize);
  const result = assignGroupifier(tc, roundId, {
    ...ASSIGNMENT_OPTIONS,
    groupCount,
  });

  tc.round(roundId).scrambleSetCountFromUniqueGroups();
  console.log(
    `✓ ${roundId}: ${result.competitorsAssigned} competitors, ${result.staffAssigned} staff`,
  );
}

console.log('\n=== Assigning Parallel Wave Events ===\n');

for (const eventGroup of parallelEventGroups) {
  if (eventGroup.length === 0) continue;

  const competitors = tc.persons.filter(competingInAny(...eventGroup));
  if (competitors.length === 0) continue;

  const numWaves = Math.ceil(competitors.length / maxGroupSize);

  for (const eventId of eventGroup) {
    try {
      tc.round(`${eventId}-r1`).createGroups(numWaves);
    } catch {}
  }

  const result = await assignParallelEvents(tc.ctx, eventGroup, {
    maxGroupSize,
    groupCount: numWaves,
    verbose: false,
    waveExclusions: WAVE_EXCLUSIONS,
  });

  const stationAssignments = assignStationsForWaves(
    competitors,
    result.assignments,
    numWaves,
    eventGroup,
  );

  for (const eventId of eventGroup) {
    applyCompetitorAssignments(
      tc,
      eventId,
      result.assignments,
      stationAssignments,
    );
    tc.round(`${eventId}-r1`).scrambleSetCount(
      new Set(result.assignments.values()).size,
    );
  }

  const staffWaveAssignment = distributeStaffAcrossWaves(
    tc.persons.all(),
    result.assignments,
    numWaves,
    WAVE_EXCLUSIONS,
  );

  assignStaffToWaves(tc, eventGroup, staffWaveAssignment, numWaves);

  for (const eventId of eventGroup) {
    const removed = clearEmptyGroups(tc.competition, `${eventId}-r1`);
    if (removed > 0) {
      console.log(`  ↳ Cleared ${removed} empty group(s) for ${eventId}-r1`);
      tc.round(`${eventId}-r1`).scrambleSetCountFromUniqueGroups();
    }
  }

  console.log(
    `✓ ${eventGroup.join(', ')}: ${competitors.length} competitors in ${numWaves} waves`,
  );
}

const orphansRemoved = removeOrphanAssignments(tc.competition);
if (orphansRemoved > 0) {
  console.log(`\n✓ Removed ${orphansRemoved} orphan assignment(s)`);
}

console.log('\n=== Saving ===\n');
await tc.commit();
console.log('✓ Done!');

function assignStationsForWaves(
  competitors: ReturnType<typeof tc.persons.filter>,
  assignments: Map<number, number>,
  numWaves: number,
  eventGroup: string[],
): Map<number, number> {
  const stationAssignments = new Map<number, number>();
  for (let waveNum = 1; waveNum <= numWaves; waveNum++) {
    const waveCompetitors = competitors.filter(
      (p) => assignments.get(p.registrantId) === waveNum,
    );
    for (const [pId, station] of assignStationsBySpeed(
      waveCompetitors,
      eventGroup,
    )) {
      stationAssignments.set(pId, station);
    }
  }
  return stationAssignments;
}

function applyCompetitorAssignments(
  tc: Awaited<ReturnType<typeof createTypeComp>>,
  eventId: string,
  assignments: Map<number, number>,
  stationAssignments: Map<number, number>,
): void {
  const roundId = `${eventId}-r1`;
  const groups = tc.groups(roundId);
  const groupsByNumber = new Map(
    groups.map((g) => [getGroupNumber(g) ?? 0, g.id]),
  );

  for (const [personId, waveNum] of assignments) {
    const person = tc.persons.byId(personId);
    const groupId = groupsByNumber.get(waveNum);

    if (person && groupId && competingIn(eventId)(person)) {
      person.assignments = (person.assignments ?? []).filter(
        (a) =>
          a.assignmentCode !== 'competitor' ||
          !groups.some((g) => g.id === a.activityId),
      );
      person.assignments.push({
        activityId: groupId,
        assignmentCode: 'competitor',
        stationNumber: stationAssignments.get(personId) ?? null,
      });
    }
  }
}

function distributeStaffAcrossWaves(
  allPersons: ReturnType<typeof tc.persons.all>,
  competitorAssignments: Map<number, number>,
  numWaves: number,
  waveExclusions: Map<number, number[]>,
): Map<number, number> {
  const canStaffWaves = new Map<number, number[]>();
  for (const person of allPersons) {
    if (!registered(person)) continue;
    const myWave = competitorAssignments.get(person.registrantId) ?? null;
    const excludedWaves = waveExclusions.get(person.registrantId) ?? [];
    const available: number[] = [];
    for (let w = 1; w <= numWaves; w++) {
      if (w === myWave) continue;
      if (excludedWaves.includes(w)) continue;
      available.push(w);
    }
    canStaffWaves.set(person.registrantId, available);
  }

  const staffWaveAssignment = new Map<number, number>();
  const waveStaffCounts = new Map<number, number>();
  for (let w = 1; w <= numWaves; w++) waveStaffCounts.set(w, 0);

  const sortedPersons = [...canStaffWaves.entries()]
    .filter(([, waves]) => waves.length > 0)
    .sort((a, b) => a[1].length - b[1].length);

  for (const [personId, availableWaves] of sortedPersons) {
    let bestWave: number | null = null;
    let bestCount = Infinity;
    for (const w of availableWaves) {
      const count = waveStaffCounts.get(w) ?? 0;
      if (count < maxGroupSize && count < bestCount) {
        bestCount = count;
        bestWave = w;
      }
    }
    if (bestWave !== null) {
      staffWaveAssignment.set(personId, bestWave);
      waveStaffCounts.set(bestWave, (waveStaffCounts.get(bestWave) ?? 0) + 1);
    }
  }

  return staffWaveAssignment;
}

function assignStaffToWaves(
  tc: Awaited<ReturnType<typeof createTypeComp>>,
  eventGroup: string[],
  staffWaveAssignment: Map<number, number>,
  numWaves: number,
): void {
  const scorer = combineStaffScorers(
    fastestScrambler(eventGroup),
    followingGroupScorer(-50, 10),
    delegateDeprioritizer(-1000),
  );
  const judgeSlots = maxGroupSize - scramblers;
  const jobs: JobDefinition[] = [
    {
      name: 'staff-scrambler',
      count: scramblers,
      eligibility: (p) => eventGroup.some((eid) => canScramble(eid)(p)),
    },
    { name: 'staff-runner', count: 0 },
    { name: 'staff-judge', count: judgeSlots },
  ];

  const firstGroup = eventGroup
    .map((eid) =>
      tc.groups(`${eid}-r1`).find((g) => g.activityCode.endsWith('g1')),
    )
    .find((g): g is NonNullable<typeof g> => g !== undefined);
  const room = firstGroup
    ? getRoomByActivity(tc.competition, firstGroup.id)
    : null;
  if (!room) return;

  for (let waveNum = 1; waveNum <= numWaves; waveNum++) {
    const waveGroups = eventGroup
      .map((eid) =>
        tc
          .groups(`${eid}-r1`)
          .find((g) => g.activityCode.endsWith(`g${waveNum}`)),
      )
      .filter((g): g is NonNullable<typeof g> => g !== undefined);
    if (waveGroups.length === 0) continue;

    const activities = waveGroups
      .map((g) => getActivityById(tc.competition, g.id))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    const startTime = activities.reduce(
      (min, a) => (!min || a.startTime < min ? a.startTime : min),
      null as string | null,
    );
    const endTime = activities.reduce(
      (max, a) => (!max || a.endTime > max ? a.endTime : max),
      null as string | null,
    );
    if (!startTime || !endTime) continue;

    const waveActivityId = maxActivityId(tc.competition) + 1;
    const waveGroupIds = new Set(waveGroups.map((g) => g.id));

    if (!room.activities) room.activities = [];
    room.activities.push({
      id: waveActivityId,
      name: `Wave ${waveNum}`,
      activityCode: `other-misc`,
      startTime,
      endTime,
      childActivities: [],
      extensions: [],
    });

    const waveCompetitors = tc.persons.all().filter((p) => {
      return (p.assignments ?? []).some(
        (a) =>
          a.assignmentCode === 'competitor' && waveGroupIds.has(a.activityId),
      );
    });
    const waveStationAssignments = assignStationsBySpeed(
      waveCompetitors,
      eventGroup,
    );

    for (const person of waveCompetitors) {
      if (!person.assignments) person.assignments = [];
      person.assignments.push({
        activityId: waveActivityId,
        assignmentCode: 'competitor',
        stationNumber: waveStationAssignments.get(person.registrantId) ?? null,
      });
    }

    const waveStaff = tc.persons.filter(
      (p) => staffWaveAssignment.get(p.registrantId) === waveNum,
    );
    const result = AssignMisc(
      tc.ctx,
      waveActivityId,
      waveStaff,
      jobs,
      [scorer],
      true,
      true,
    );
    if (result.warnings.length > 0) {
      console.warn(
        `⚠️  Wave ${waveNum} staff assignment warnings:`,
        result.warnings,
      );
    }
  }
}
