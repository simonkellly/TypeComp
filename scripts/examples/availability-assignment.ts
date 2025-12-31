import { competingIn, createTypeComp } from '@/lib/api';
import { assignByAvailability } from '@/lib/optimizers';
import type { Group } from '@/lib/types/core';

const competitionId = 'Example2026';

const tc = await createTypeComp(competitionId);

tc.round('333-r1').createGroups(3, {
  room: 'Main Room',
  from: '2026-01-17T14:15:00',
  to: '2026-01-17T15:00:00',
});

const groups = tc.groups('333-r1');
const competitors = tc.persons.filter(competingIn('333'));

console.log(`Found ${competitors.length} competitors for 3x3`);
console.log(`Created ${groups.length} groups`);

const allAssignments = tc.competition.persons.flatMap((p) => {
  return (p.assignments || []).map((a) => ({
    ...a,
    personId: p.registrantId,
  }));
});

const assignments = assignByAvailability(
  groups,
  competitors,
  tc.competition,
  allAssignments,
  {
    resolveConflicts: true,
    sortingRule: 'balanced',
  },
);

console.log('\nAvailability-based assignments:');
for (const [groupId, assignedCompetitors] of assignments) {
  const group = groups.find((g): g is Group => g.id === groupId);
  console.log(
    `Group ${group?.activityCode}: ${assignedCompetitors.length} competitors`,
  );
}

await tc.commit();
