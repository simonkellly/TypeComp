import {
  assignGroupifier,
  createTypeComp,
  parseActivityCode,
  roundsMissingAssignments,
} from '@/lib';
import { ASSIGNMENT_OPTIONS, COMPETITION_ID } from './config';

const DRY_RUN = process.argv.includes('--dry-run');

const tc = await createTypeComp(COMPETITION_ID, { dryRun: DRY_RUN });

console.log(`\n=== Checking for Subsequent Rounds to Assign ===\n`);

const roundsToAssign = roundsMissingAssignments(tc.competition, false);

if (roundsToAssign.length === 0) {
  console.log('No subsequent rounds need assignment.');
  console.log('\nPossible reasons:');
  console.log('  - No rounds have been opened yet');
  console.log('  - All open rounds already have assignments');
  console.log('  - Rounds have already started (attempts recorded)');
  process.exit(0);
}

console.log(`Found ${roundsToAssign.length} round(s) to assign:\n`);
for (const round of roundsToAssign) {
  console.log(`  ${round.id}: ${round.results.length} competitors advancing`);
}

console.log('\n=== Assigning Rounds ===\n');

for (const round of roundsToAssign) {
  const parsed = parseActivityCode(round.id);
  if (!parsed) continue;

  const maxGroupSize = ASSIGNMENT_OPTIONS.maxGroupSize ?? 18;
  const groupCount = Math.ceil(round.results.length / maxGroupSize);

  const result = assignGroupifier(tc, round.id, {
    ...ASSIGNMENT_OPTIONS,
    competitorsSortingRule: 'ranks',
    groupCount,
    createGroups: true,
  });

  tc.round(round.id).scrambleSetCountFromUniqueGroups();

  console.log(
    `✓ ${round.id}: ${result.competitorsAssigned} competitors, ${result.staffAssigned} staff (${groupCount} groups)`,
  );

  for (const warning of result.warnings) {
    console.warn(`  ⚠️  ${warning}`);
  }
}

if (DRY_RUN) {
  console.log('\n=== Dry Run Complete ===\n');
  console.log('No changes were saved. Remove --dry-run to save changes.');
} else {
  console.log('\n=== Saving ===\n');
  await tc.commit();
  console.log('✓ Done!');
}
