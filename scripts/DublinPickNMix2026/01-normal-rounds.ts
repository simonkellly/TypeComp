import {
  canScramble,
  competingIn,
  createTypeComp,
  isDelegate,
} from '@/lib/api';
import { combineStaffScorers } from '@/lib/api/scorers';
import { PersonalBest } from '@/lib/functions/events';
import type { StaffScorer } from '@/lib/functions/staff';
import type { Activity, Person } from '@/lib/types/core';
import { COMPETITION_ID, classifyRounds, STAFF_REQUIREMENTS } from './config';

const tc = await createTypeComp(COMPETITION_ID);

const { normalRounds } = classifyRounds(tc);

for (const roundId of normalRounds) {
  const parts = roundId.split('-r');
  const eventId = parts[0];
  if (!eventId) continue;

  const roundNum = parseInt(parts[1] || '0', 10);
  const isFirstRound = roundNum === 1;
  if (!isFirstRound) {
    continue;
  }

  const round = tc.round(roundId);

  const competitors = tc.persons.filter(competingIn(eventId));

  if (competitors.length === 0) continue;

  const numGroups = Math.ceil(competitors.length / 18);

  round
    .createGroups(numGroups)
    .competitors(competingIn(eventId))
    .maxGroupSize(18)
    .groupBy.sameCountry(4, 2)
    .differentNames(-5)
    .done()
    .stations.bySpeed(eventId, 'average')
    .done()
    .assign();

  round.scrambleSetCountFromUniqueGroups();

  const judgesCount = STAFF_REQUIREMENTS.judges;

  const groups = tc.groups(roundId);
  if (groups.length === 0) continue;

  const staffPool = tc.persons.registered();

  const SCRAMBLE_MAP: Record<string, string> = {
    '333': '333',
    '333bf': '333',
    '333oh': '333',
    '333fm': '333',
    '333mbf': '333',
    '444': '444',
    '444bf': '444',
    '555': '555',
    '555bf': '555',
  };

  const scramblerScores = new Map<number, number>();
  const eligibleScramblers = staffPool.filter(canScramble(eventId));

  eligibleScramblers.forEach((person) => {
    const baseEventId = SCRAMBLE_MAP[eventId] ?? eventId;
    const resultType =
      baseEventId.includes('bf') || baseEventId.includes('mbf')
        ? 'single'
        : 'average';
    const pb = PersonalBest(person, baseEventId, resultType);
    const score = pb !== null && pb > 0 ? 10000 / (pb + 100) : 0;
    scramblerScores.set(person.registrantId, score);
  });

  const sortedScramblers = [...eligibleScramblers].sort(
    (a, b) =>
      (scramblerScores.get(b.registrantId) ?? 0) -
      (scramblerScores.get(a.registrantId) ?? 0),
  );

  const balancedScramblerScorer: StaffScorer = {
    caresAboutJobs: true,
    caresAboutStations: false,
    Score(
      _competition,
      person: Person,
      activity: Activity,
      jobName?: string,
    ): number {
      if (jobName !== 'staff-scrambler') return 0;
      if (scramblerScores.get(person.registrantId) === 0) return 0;

      const groupMatch = activity.activityCode.match(/g(\d+)/);
      if (!groupMatch?.[1]) return 0;

      const groupNum = parseInt(groupMatch[1], 10);
      const positionInList = sortedScramblers.findIndex(
        (p) => p.registrantId === person.registrantId,
      );
      if (positionInList === -1) return 0;

      const idealGroup = (positionInList % groups.length) + 1;
      const distanceFromIdeal = Math.abs(groupNum - idealGroup);

      return distanceFromIdeal === 0 ? 5 : -distanceFromIdeal * 2;
    },
  };

  const speedScorer: StaffScorer = {
    caresAboutJobs: true,
    caresAboutStations: false,
    Score(
      _competition,
      person: Person,
      _activity: Activity,
      jobName?: string,
    ): number {
      const scramblerScore = scramblerScores.get(person.registrantId) ?? 0;
      if (scramblerScore === 0) return 0;

      if (jobName === 'staff-scrambler') return scramblerScore;
      if (jobName === 'staff-judge') return -scramblerScore * 0.5;
      return 0;
    },
  };

  const delegateDeprioritizer: StaffScorer = {
    caresAboutJobs: true,
    caresAboutStations: false,
    Score(
      _competition,
      person: Person,
      _activity: Activity,
      jobName?: string,
    ): number {
      if (jobName?.startsWith('staff-') && isDelegate(person)) {
        return -1000;
      }
      return 0;
    },
  };

  const combinedScorer = combineStaffScorers(
    balancedScramblerScorer,
    speedScorer,
    delegateDeprioritizer,
  );

  for (const group of groups) {
    const groupCompetitors = tc.persons.filter((p: Person) =>
      (p.assignments ?? []).some(
        (a) => a.activityId === group.id && a.assignmentCode === 'competitor',
      ),
    );
    const maxJudgesForGroup = Math.min(judgesCount, groupCompetitors.length);
    const competitorIds = new Set(groupCompetitors.map((c) => c.registrantId));

    let groupJudges = maxJudgesForGroup;
    let groupAssigned = false;

    while (groupJudges >= 6 && !groupAssigned) {
      try {
        const attempt = tc
          .staff(roundId)
          .from(
            (p) => staffPool.includes(p) && !competitorIds.has(p.registrantId),
          )
          .groups((g) => g.id === group.id)
          .scramblers(STAFF_REQUIREMENTS.scramblers, canScramble(eventId))
          .runners(STAFF_REQUIREMENTS.runners)
          .judges(groupJudges)
          .scorer(combinedScorer)
          .avoidConflicts(true);

        const result = attempt.assign();

        if (result.warnings.length === 0 && result.assigned > 0) {
          groupAssigned = true;
        } else {
          groupJudges -= 2;
        }
      } catch {
        groupJudges -= 2;
      }
    }
  }
}

await tc.commit();
