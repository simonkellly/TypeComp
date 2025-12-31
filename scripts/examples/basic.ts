import { competingIn, createTypeComp } from '@/lib/api';
import { parseActivityCode } from '@/lib/functions/activity-code';
import {
  getGroupNumber,
  getGroupsForRound,
} from '@/lib/functions/groups-helpers';
import type { Group, Person, Scorer } from '@/lib/types/core';

const competitionId = 'LetsGoCarlow2026';
const tc = await createTypeComp(competitionId);

/* ============================================================================
 * Create a round of 3x3
 * Group competitors by age
 * Also keep people with the same birthday apart
 * ========================================================================== */

const round = tc
  .round('333-r1')
  .createGroups(4, {
    room: 'Ballroom',
    from: '2026-01-17T14:15:00',
    to: '2026-01-17T15:00:00',
  })
  .competitors(competingIn('333'))
  .maxGroupSize(25);

function ageOrderGroup(totalGroups: number, strength: number): Scorer {
  const sorted = [...tc.ctx.competition.persons]
    .filter(competingIn('333'))
    .filter((p) => p.birthdate)
    .sort(
      (a, b) =>
        new Date(b.birthdate ?? '1900-01-01').getTime() -
        new Date(a.birthdate ?? '1900-01-01').getTime(),
    );

  const ageRank = new Map(
    sorted.map((p, i) => [p.registrantId, i / sorted.length]),
  );

  return {
    getScore(person: Person, group: Group): number {
      const rank = ageRank.get(person.registrantId) ?? 0;
      const parsed = parseActivityCode(group.activityCode);
      const groupNum = parsed?.groupNumber ?? 1;

      const targetGroup = Math.min(
        Math.floor(rank * totalGroups) + 1,
        totalGroups,
      );
      return groupNum === targetGroup ? strength : 0;
    },
  };
}

function sharedBirthdayScorer(): Scorer {
  return {
    getScore(person: Person, _group: Group, otherPeople: Person[]): number {
      if (!person.birthdate) return 0;
      const personBirthday = person.birthdate.split('T')[0];
      const hasSharedBirthday = otherPeople.some((other) => {
        if (!other.birthdate) return false;
        const otherBirthday = other.birthdate.split('T')[0];
        return personBirthday === otherBirthday;
      });

      return hasSharedBirthday ? -1000 : 0;
    },
  };
}

round.groupBy.custom(ageOrderGroup(4, 100));
round.groupBy.custom(sharedBirthdayScorer());

round.stations.by(
  (person) =>
    person.birthdate
      ? new Date(person.birthdate).getTime()
      : new Date('1900-01-01').getTime(),
  'descending',
);

const result = round.assign();

/* ============================================================================
 * Print the group assignment status
 * ========================================================================== */

console.log(
  `Assigned ${result.assigned} competitors to ${result.groups} groups`,
);

if (result.warnings.length > 0) {
  console.log('Warnings:');
  for (const w of result.warnings) {
    console.log(`  - ${w}`);
  }
}

/* ============================================================================
 * Print the group assignments
 * ========================================================================== */

const groups = getGroupsForRound(tc.ctx.competition, '333-r1').sort(
  (a, b) => (getGroupNumber(a) ?? 0) - (getGroupNumber(b) ?? 0),
);

for (const group of groups) {
  const assigned = tc.ctx.competition.persons
    .filter((p) =>
      p.assignments?.some(
        (a) => a.activityId === group.id && a.assignmentCode === 'competitor',
      ),
    )
    .map((p) => ({
      Name: p.name,
      Age: p.birthdate
        ? Math.floor(
            Math.abs(
              new Date().getFullYear() - new Date(p.birthdate).getFullYear(),
            ),
          )
        : 'N/A',
      Station:
        p.assignments?.find((a) => a.activityId === group.id)?.stationNumber ||
        '',
    }))
    .sort((a, b) => Number(a.Station) - Number(b.Station));

  console.log(`\nGroup ${getGroupNumber(group)}:`);
  console.table(assigned);
}

await tc.commit();
