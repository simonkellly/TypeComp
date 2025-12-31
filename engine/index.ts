import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createMutationTracker,
  type MutationTracker,
} from '@/lib/runtime/mutations';
import type { Competition } from '@/lib/types/wcif';

export {
  getAccessToken,
  getWcif,
  login,
  patchWcif,
  patchWcifWithRetries,
} from './auth';

export interface TypeCompOptions {
  dryRun: boolean;

  noLocalCache: boolean;

  commit: boolean;

  verbose: boolean;
}

export function parseCliArgs(): TypeCompOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      commit: { type: 'boolean', short: 'c', default: false },
      'no-local-cache': { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: false,
    allowPositionals: true,
  });

  const commit = values.commit === true;
  const noLocalCache = values['no-local-cache'] === true;
  const verbose = values.verbose === true;

  return {
    dryRun: !commit,
    noLocalCache,
    commit,
    verbose,
  };
}

export interface ExecutionContext {
  competition: Competition;

  dryRun: boolean;

  mutations: MutationTracker;

  competitionId: string;

  options: TypeCompOptions;

  finish: () => Promise<void>;
}

const TYPECOMP_DIR = resolve(process.cwd(), '.typecomp');
const LOCAL_WCIF_DIR = join(TYPECOMP_DIR, 'local-wcif');

function getLocalWcifPath(competitionId: string): string {
  return join(LOCAL_WCIF_DIR, `${competitionId}.json`);
}

async function loadWcifFromFile(
  competitionId: string,
): Promise<Competition | null> {
  const localPath = getLocalWcifPath(competitionId);
  const file = Bun.file(localPath);

  if (await file.exists()) {
    return await file.json();
  }

  return null;
}

async function saveWcifToFile(
  competition: Competition,
  competitionId: string,
): Promise<void> {
  const localPath = getLocalWcifPath(competitionId);

  await Bun.write(localPath, JSON.stringify(competition, null, 2));
}

async function saveWcifToAPI(
  competition: Competition,
  competitionId: string,
): Promise<void> {
  const { patchWcifWithRetries } = await import('./auth');
  const keys = ['persons', 'schedule', 'events', 'extensions'];

  await patchWcifWithRetries(competitionId, competition, keys);
}

export async function createContext(
  competitionId: string,
  options?: Partial<TypeCompOptions>,
): Promise<ExecutionContext> {
  const cliOptions = parseCliArgs();
  const mergedOptions: TypeCompOptions = { ...cliOptions, ...options };

  let competition: Competition;

  if (!mergedOptions.noLocalCache) {
    const localWcif = await loadWcifFromFile(competitionId);

    if (localWcif) {
      if (mergedOptions.verbose) {
        console.log(
          `Loaded WCIF from local cache: ${getLocalWcifPath(competitionId)}`,
        );
      }
      competition = localWcif;
    } else {
      const { getWcif } = await import('./auth');

      competition = await getWcif(competitionId, false);
    }
  } else {
    const { getWcif } = await import('./auth');

    competition = await getWcif(competitionId, true);
  }

  const ctx: ExecutionContext = {
    competition,
    dryRun: mergedOptions.dryRun,
    mutations: createMutationTracker(),
    competitionId,
    options: mergedOptions,
    finish: async (): Promise<void> => {
      await saveWcifToFile(ctx.competition, competitionId);

      if (ctx.options.commit) {
        console.log('Committing WCIF to WCA API...');
        await saveWcifToAPI(ctx.competition, competitionId);
        console.log('✅ WCIF committed to WCA API');
      } else {
        console.log('Dry run - WCIF saved locally only');
        console.log(`  Local file: ${getLocalWcifPath(competitionId)}`);
        console.log('  Run with --commit to push to WCA');
      }
    },
  };

  return ctx;
}

export async function loadWcif(
  competitionId: string,
  options?: { noLocalCache?: boolean },
): Promise<Competition> {
  if (!options?.noLocalCache) {
    const localWcif = await loadWcifFromFile(competitionId);

    if (localWcif) {
      return localWcif;
    }
  }

  const { getWcif } = await import('./auth');

  return await getWcif(competitionId, options?.noLocalCache ?? false);
}

export async function saveWcif(
  competition: Competition,
  competitionId: string,
  commit = false,
): Promise<void> {
  await saveWcifToFile(competition, competitionId);

  if (commit) {
    await saveWcifToAPI(competition, competitionId);
  }
}
