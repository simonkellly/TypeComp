import {
  canScramble,
  competingIn,
  competingInAny,
  createTypeComp,
} from '@/lib/api';
import { combineStaffScorers } from '@/lib/api/scorers';
import { PersonalBest } from '@/lib/functions/events';
import { getGroupNumber } from '@/lib/functions/groups-helpers';
import type { StaffScorer } from '@/lib/functions/staff';
import { assignParallelEvents, assignStationsBySpeed } from '@/lib/solvers';
import type { Activity, Person } from '@/lib/types/core';
import { COMPETITION_ID, classifyRounds, STAFF_REQUIREMENTS } from './config';

const tc = await createTypeComp(COMPETITION_ID);

const { parallelEventGroups } = classifyRounds(tc);

for (const eventGroup of parallelEventGroups) {
  if (eventGroup.length === 0) continue;

  const competitors = tc.persons.filter(competingInAny(...eventGroup));

  if (competitors.length === 0) continue;

  const numWaves = Math.ceil(competitors.length / 18);

  for (const eventId of eventGroup) {
    const roundId = `${eventId}-r1`;
    try {
      tc.round(roundId).createGroups(numWaves);
    } catch {}
  }

  const result = await assignParallelEvents(tc.ctx, eventGroup, {
    maxGroupSize: 18,
    groupCount: numWaves,
    verbose: false,
  });

  const stationAssignments = new Map<number, number>();

  for (let waveNum = 1; waveNum <= numWaves; waveNum++) {
    const waveCompetitors = competitors.filter(
      (p) => result.assignments.get(p.registrantId) === waveNum,
    );
    const waveStations = assignStationsBySpeed(waveCompetitors, eventGroup);

    for (const [pId, station] of waveStations) {
      stationAssignments.set(pId, station);
    }
  }

  for (const eventId of eventGroup) {
    const roundId = `${eventId}-r1`;
    const groups = tc.groups(roundId);
    if (groups.length === 0) continue;

    const groupsByNumber = new Map<number, number>();
    for (const g of groups) {
      const match = g.activityCode.match(/g(\d+)/);
      if (match?.[1]) groupsByNumber.set(parseInt(match[1], 10), g.id);
    }

    for (const [personId, waveNum] of result.assignments) {
      const person = tc.persons.byId(personId);
      if (person && competingIn(eventId)(person)) {
        const groupId = groupsByNumber.get(waveNum);
        if (groupId) {
          if (!person.assignments) person.assignments = [];
          person.assignments = person.assignments.filter(
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
  }

  const allPotentialStaff = tc.persons.registered();

  const scramblers = STAFF_REQUIREMENTS.scramblers;
  const runners = STAFF_REQUIREMENTS.runners;
  const fixedStaffPerWave = scramblers + runners;

  const totalStaffCapacity = allPotentialStaff.length;
  const totalFixedStaff = fixedStaffPerWave * numWaves;
  const remainingForJudges = Math.max(0, totalStaffCapacity - totalFixedStaff);
  const judgesPerWave = Math.min(
    STAFF_REQUIREMENTS.judges,
    Math.floor(remainingForJudges / numWaves),
  );

  const assignedStaffHistory = new Set<number>();
  const waveAnchorGroups = new Map<number, number>();

  const scramblerScores = new Map<number, number>();
  const eligibleScramblers = allPotentialStaff.filter((p) => {
    return eventGroup.some((eid) => canScramble(eid)(p));
  });

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

  const rankings = new Map<string, Map<number, number>>();
  const allPeopleForRanking = tc.persons.registered();
  const highestRank = allPeopleForRanking.length + 1;

  for (const eventId of eventGroup) {
    const baseEventId = SCRAMBLE_MAP[eventId] ?? eventId;
    const resultType =
      baseEventId.includes('bf') || baseEventId.includes('mbf')
        ? 'single'
        : 'average';

    const eventScores = allPeopleForRanking.map((p) => ({
      id: p.registrantId,
      score: PersonalBest(p, baseEventId, resultType) ?? Infinity,
    }));

    eventScores.sort((a, b) => a.score - b.score);

    const eventRankMap = new Map<number, number>();
    eventScores.forEach((item, index) => {
      eventRankMap.set(
        item.id,
        item.score === Infinity ? highestRank : index + 1,
      );
    });

    rankings.set(eventId, eventRankMap);
  }

  eligibleScramblers.forEach((person) => {
    let sumRanks = 0;
    for (const eventId of eventGroup) {
      const rank =
        rankings.get(eventId)?.get(person.registrantId) ?? highestRank;
      sumRanks += rank;
    }
    scramblerScores.set(person.registrantId, 10000 / (sumRanks + 1));
  });

  const sortedScramblers = [...eligibleScramblers].sort(
    (a, b) =>
      (scramblerScores.get(b.registrantId) ?? 0) -
      (scramblerScores.get(a.registrantId) ?? 0),
  );

  const actualWavesForStaffing = new Set<number>();
  for (const [, waveNum] of result.assignments) {
    actualWavesForStaffing.add(waveNum);
  }

  for (const waveNum of Array.from(actualWavesForStaffing).sort(
    (a, b) => a - b,
  )) {
    let anchorEvent: string | null = null;
    let anchorGroupId: number | null = null;

    for (const eid of eventGroup) {
      const gid = tc
        .groups(`${eid}-r1`)
        .find((g) => g.activityCode.endsWith(`g${waveNum}`))?.id;
      if (gid) {
        anchorEvent = eid;
        anchorGroupId = gid;
        break;
      }
    }

    if (!anchorEvent || !anchorGroupId) continue;

    waveAnchorGroups.set(waveNum, anchorGroupId);

    const balancedScramblerScorer: StaffScorer = {
      caresAboutJobs: true,
      caresAboutStations: false,
      Score(
        _competition,
        person: Person,
        _activity: Activity,
        jobName?: string,
      ): number {
        if (jobName !== 'staff-scrambler') return 0;
        if (scramblerScores.get(person.registrantId) === 0) return 0;

        const positionInList = sortedScramblers.findIndex(
          (p) => p.registrantId === person.registrantId,
        );
        if (positionInList === -1) return 0;

        const idealWave = (positionInList % numWaves) + 1;
        const distanceFromIdeal = Math.abs(waveNum - idealWave);

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

    const combinedScorer = combineStaffScorers(
      balancedScramblerScorer,
      speedScorer,
    );

    const alreadyStaffed = (p: Person) => {
      if (assignedStaffHistory.has(p.registrantId)) return [() => true];
      return [];
    };

    const potentialStaff = tc.persons.filter(
      (p) => !assignedStaffHistory.has(p.registrantId),
    );

    const waveCompetitors = competitors.filter(
      (p) => result.assignments.get(p.registrantId) === waveNum,
    );
    const maxJudgesForWave = Math.min(judgesPerWave, waveCompetitors.length);
    const competitorIds = new Set(waveCompetitors.map((c) => c.registrantId));

    let currentJudges = maxJudgesForWave;
    let success = false;

    while (currentJudges >= 6 && !success) {
      try {
        const scramblerEligibility = (p: Person) =>
          eventGroup.some((eid) => canScramble(eid)(p)) &&
          potentialStaff.includes(p);

        const sb = tc
          .staff(`${anchorEvent}-r1`)
          .groups((g) => g.id === anchorGroupId)
          .from(
            (p) =>
              potentialStaff.includes(p) && !competitorIds.has(p.registrantId),
          )
          .unavailable(alreadyStaffed)
          .scramblers(scramblers, scramblerEligibility)
          .runners(runners)
          .judges(currentJudges)
          .scorer(combinedScorer)
          .avoidConflicts(true);

        const res = sb.assign();

        if (res.assigned > 0) {
          success = true;
          potentialStaff.forEach((p) => {
            if (
              p.assignments?.some(
                (a) =>
                  a.activityId === anchorGroupId &&
                  !a.assignmentCode.startsWith('competitor'),
              )
            ) {
              assignedStaffHistory.add(p.registrantId);
            }
          });
        } else {
          currentJudges -= 2;
        }
      } catch (_e) {
        currentJudges -= 2;
      }
    }
  }

  for (const eventId of eventGroup) {
    const roundId = `${eventId}-r1`;
    const groups = tc.groups(roundId);

    for (const group of groups) {
      const hasCompetitors =
        tc.persons.filter((p: Person) =>
          (p.assignments ?? []).some(
            (a) =>
              a.activityId === group.id && a.assignmentCode === 'competitor',
          ),
        ).length > 0;

      if (!hasCompetitors) {
        for (const person of tc.competition.persons) {
          if (person.assignments) {
            person.assignments = person.assignments.filter(
              (a) => a.activityId !== group.id,
            );
          }
        }

        for (const venue of tc.ctx.competition.schedule.venues) {
          for (const room of venue.rooms) {
            for (const activity of room.activities) {
              if (
                activity.activityCode === roundId &&
                activity.childActivities
              ) {
                const index = activity.childActivities.findIndex(
                  (g) => g.id === group.id,
                );
                if (index !== -1) {
                  activity.childActivities.splice(index, 1);
                }
              }
            }
          }
        }
      }
    }

    const wavesWithCompetitors = new Set<number>();
    for (const group of tc.groups(roundId)) {
      const waveNum = getGroupNumber(group);
      if (
        waveNum !== null &&
        tc.persons.filter((p: Person) =>
          (p.assignments ?? []).some(
            (a) =>
              a.activityId === group.id && a.assignmentCode === 'competitor',
          ),
        ).length > 0
      ) {
        wavesWithCompetitors.add(waveNum);
      }
    }
    tc.round(roundId).scrambleSetCount(wavesWithCompetitors.size);
  }
}

const allActivityIds = new Set<number>();
for (const venue of tc.ctx.competition.schedule.venues) {
  for (const room of venue.rooms) {
    for (const activity of room.activities) {
      allActivityIds.add(activity.id);
      if (activity.childActivities) {
        for (const child of activity.childActivities) {
          allActivityIds.add(child.id);
        }
      }
    }
  }
}

for (const person of tc.competition.persons) {
  if (person.assignments) {
    person.assignments = person.assignments.filter((a) =>
      allActivityIds.has(a.activityId),
    );
  }
}

await tc.commit();
