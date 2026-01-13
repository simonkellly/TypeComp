import { cleanWcif } from '@/engine/clean';
import { loadWcif, saveWcif } from '@/engine/index';

const competitionId = process.argv[2];

if (!competitionId) {
  console.error('Usage: bun run scripts/clean-wcif.ts <competition-id>');
  console.error('Example: bun run scripts/clean-wcif.ts DublinPickNMix2026');
  process.exit(1);
}

try {
  const competition = await loadWcif(competitionId);
  cleanWcif(competition);
  await saveWcif(competition, competitionId, false);

  console.log('✅ WCIF cleaned successfully!');
  console.log(
    `   Removed: assignments, groups, tool-created activities, and custom extensions`,
  );
  console.log(`   Preserved: original schedule structure`);
  console.log(`   File: .typecomp/local-wcif/${competitionId}.json`);
} catch (error) {
  console.error('❌ Error cleaning WCIF:', error);
  process.exit(1);
}
