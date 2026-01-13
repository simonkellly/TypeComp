import {
  canScramble,
  competingIn,
  createTypeComp,
  getGroupNumber,
  getGroupsForRound,
} from '@/lib';

const COMPETITION_ID = 'LetsGoCarlow2026';

const tc = await createTypeComp(COMPETITION_ID);

console.log(`\n=== TypeComp Basic Example ===`);
console.log(`Competition: ${tc.competition.name}`);
console.log(`Registered: ${tc.persons.registered().length} competitors\n`);

const ROUND_ID = '333-r1';
const EVENT_ID = '333';
const NUM_GROUPS = 4;

tc.round(ROUND_ID)
  .createGroups(NUM_GROUPS, {
    room: 'Ballroom',
    from: '2026-01-17T14:15:00',
    to: '2026-01-17T15:00:00',
  })
  .competitors(competingIn(EVENT_ID))
  .maxGroupSize(25)
  .groupBy.sameCountry(4, 2)
  .differentNames(-5)
  .done()
  .stations.bySpeed(EVENT_ID, 'average')
  .done()
  .assign();

tc.staff(ROUND_ID)
  .from(competingIn(EVENT_ID))
  .judges(12)
  .scramblers(4, canScramble(EVENT_ID))
  .runners(2)
  .preferFastScramblers()
  .overwrite(true)
  .assign();

tc.round(ROUND_ID).scrambleSetCountFromUniqueGroups();

console.log('\n=== Assignment Summary ===\n');

const groups = getGroupsForRound(tc.competition, ROUND_ID).sort(
  (a, b) => (getGroupNumber(a) ?? 0) - (getGroupNumber(b) ?? 0),
);

for (const group of groups) {
  const competitors = tc.competition.persons.filter((p) =>
    p.assignments?.some(
      (a) => a.activityId === group.id && a.assignmentCode === 'competitor',
    ),
  );

  const staff = tc.competition.persons.filter((p) =>
    p.assignments?.some(
      (a) => a.activityId === group.id && a.assignmentCode.startsWith('staff-'),
    ),
  );

  console.log(
    `Group ${getGroupNumber(group)}: ${competitors.length} competitors, ${staff.length} staff`,
  );
}

await tc.commit();
console.log('\n✓ Done!');
