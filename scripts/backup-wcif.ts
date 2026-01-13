import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getWcif } from '@/engine/auth';

const competitionId = process.argv[2];
if (!competitionId) {
  console.error('Usage: bun run scripts/backup-wcif.ts <competition-id>');
  process.exit(1);
}

const wcif = await getWcif(competitionId, true);
const backupDir = join(resolve(process.cwd(), '.typecomp'), 'backups');
await mkdir(backupDir, { recursive: true });

const backupPath = join(
  backupDir,
  `${competitionId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
await Bun.write(backupPath, JSON.stringify(wcif, null, 2));
console.log(`✅ Backup saved to ${backupPath}`);
