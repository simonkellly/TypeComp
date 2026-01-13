import {
  competingIn,
  createTypeComp,
  type Group,
  getGroupNumber,
  getGroupsForRound,
  type Person,
  type Scorer,
} from '@/lib';

const COMPETITION_ID = 'LetsGoCarlow2026';
const tc = await createTypeComp(COMPETITION_ID);

console.log(`\n=== Custom Scorers Example ===`);
console.log(`Competition: ${tc.competition.name}\n`);

function ageOrderScorer(totalGroups: number, strength: number): Scorer {
  const competitors = tc.persons
    .filter(competingIn('333'))
    .filter((p) => p.birthdate)
    .sort(
      (a, b) =>
        new Date(b.birthdate ?? '1900-01-01').getTime() -
        new Date(a.birthdate ?? '1900-01-01').getTime(),
    );

  const ageRank = new Map(
    competitors.map((p, i) => [p.registrantId, i / competitors.length]),
  );

  return {
    getScore(person: Person, group: Group): number {
      const rank = ageRank.get(person.registrantId) ?? 0;
      const groupNum = getGroupNumber(group) ?? 1;
      const targetGroup = Math.min(
        Math.floor(rank * totalGroups) + 1,
        totalGroups,
      );
      return groupNum === targetGroup ? strength : 0;
    },
  };
}

function sharedBirthdayPenalty(): Scorer {
  return {
    getScore(person: Person, _group: Group, otherPeople: Person[]): number {
      if (!person.birthdate) return 0;
      const birthday = person.birthdate.split('T')[0];
      const hasMatch = otherPeople.some(
        (other) => other.birthdate?.split('T')[0] === birthday,
      );
      return hasMatch ? -1000 : 0;
    },
  };
}

const result = tc
  .round('333-r1')
  .createGroups(4, {
    room: 'Ballroom',
    from: '2026-01-17T14:15:00',
    to: '2026-01-17T15:00:00',
  })
  .competitors(competingIn('333'))
  .maxGroupSize(25)
  .groupBy.custom(ageOrderScorer(4, 100))
  .custom(sharedBirthdayPenalty())
  .done()
  .stations.by(
    (p) => new Date(p.birthdate ?? '1900-01-01').getTime(),
    'descending',
  )
  .done()
  .assign();

console.log(
  `Assigned ${result.assigned} competitors to ${result.groups} groups`,
);
for (const w of result.warnings) {
  console.log(`  Warning: ${w}`);
}

const groups = getGroupsForRound(tc.competition, '333-r1').sort(
  (a, b) => (getGroupNumber(a) ?? 0) - (getGroupNumber(b) ?? 0),
);

for (const group of groups) {
  const members = tc.competition.persons
    .filter((p) =>
      p.assignments?.some(
        (a) => a.activityId === group.id && a.assignmentCode === 'competitor',
      ),
    )
    .map((p) => ({
      Name: p.name,
      Age: p.birthdate
        ? new Date().getFullYear() - new Date(p.birthdate).getFullYear()
        : 'N/A',
      Station:
        p.assignments?.find((a) => a.activityId === group.id)?.stationNumber ??
        '',
    }))
    .sort((a, b) => Number(a.Station) - Number(b.Station));

  console.log(`\nGroup ${getGroupNumber(group)}:`);
  console.table(members);
}

await tc.commit();
