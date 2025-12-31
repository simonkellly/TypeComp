import { competingInAny, createTypeComp } from '@/lib/api';
import { assignParallelEvents, assignStationsBySpeed } from '@/lib/solvers';

const competitionId = 'Example2026';

const tc = await createTypeComp(competitionId);

const waveEvents = [
  '222',
  '444',
  '555',
  '666',
  '777',
  '333oh',
  'clock',
  'minx',
  'pyram',
  'skewb',
  'sq1',
];

const waveCompetitors = tc.persons.filter(competingInAny(...waveEvents));

console.log(`Found ${waveCompetitors.length} competitors in wave events`);

for (const eventId of waveEvents) {
  tc.round(`${eventId}-r1`).createGroups(3, {
    room: 'Main Room',
    from: '2026-01-17T10:00:00',
    to: '2026-01-17T13:00:00',
  });
}

const result = await assignParallelEvents(tc.ctx, waveEvents, {
  maxGroupSize: 18,
  groupCount: 3,
  verbose: true,
});

console.log(`\nAssigned ${result.totalAssigned} competitors to waves`);
console.log('Group sizes:', result.groupSizes);
console.log('Events per group:', result.eventsPerGroup);

const stationNumbers = assignStationsBySpeed(waveCompetitors, waveEvents);

for (const eventId of waveEvents) {
  const roundId = `${eventId}-r1`;
  const groups = tc.groups(roundId);

  if (groups.length === 0) continue;

  const groupsByNumber = new Map<number, number>();
  for (const group of groups) {
    const match = group.activityCode.match(/g(\d+)/);
    if (match?.[1]) {
      groupsByNumber.set(parseInt(match[1], 10), group.id);
    }
  }

  for (const [personId, groupNum] of result.assignments) {
    const person = tc.persons.byId(personId);
    const groupId = groupsByNumber.get(groupNum);

    if (person && groupId) {
      if (!person.assignments) person.assignments = [];

      person.assignments = person.assignments.filter(
        (a) =>
          a.assignmentCode !== 'competitor' ||
          !groups.some((g) => g.id === a.activityId),
      );

      person.assignments.push({
        activityId: groupId,
        assignmentCode: 'competitor',
        stationNumber: stationNumbers.get(personId) ?? null,
      });
    }
  }
}

console.log('\nWave assignments complete!');

await tc.commit();
