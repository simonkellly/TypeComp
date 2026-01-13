import type { Competition } from '@wca/helpers';
import { patchWcifWithRetries } from '@/engine/auth';

const wcifPath = process.argv[2];
if (!wcifPath) {
  console.error('Usage: bun run scripts/push-wcif.ts <wcif-file>');
  process.exit(1);
}

const wcif = (await Bun.file(wcifPath).json()) as Competition;
const keys = Object.keys(wcif).filter((k) => k !== 'id');

await patchWcifWithRetries(wcif.id, wcif, keys);
console.log('✅ WCIF successfully pushed to WCA API');
