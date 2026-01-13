import { DateTime } from 'luxon';
import type { Competition } from '@/lib';
import type { TypeComp } from '@/lib/api';

interface RoundInfo {
  code: string;
  start: DateTime;
  end: DateTime;
}

export function classifyRounds(tc: TypeComp): {
  normalRounds: string[];
  parallelEventGroups: string[][];
} {
  const { competition } = tc.ctx;
  const allRounds = collectRounds(competition);
  return partitionRounds(allRounds);
}

function collectRounds(competition: Competition): RoundInfo[] {
  const rounds: RoundInfo[] = [];
  const seen = new Set<string>();

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        const code = activity.activityCode;
        if (/^[^-]+-r\d+$/.test(code) && !seen.has(code)) {
          seen.add(code);
          rounds.push({
            code,
            start: DateTime.fromISO(activity.startTime),
            end: DateTime.fromISO(activity.endTime),
          });
        }
      }
    }
  }
  return rounds;
}

function partitionRounds(allRounds: RoundInfo[]): {
  normalRounds: string[];
  parallelEventGroups: string[][];
} {
  const normalRounds: string[] = [];
  const parallelBlocks: Set<string>[] = [];
  const visited = new Set<string>();

  for (const round of allRounds) {
    if (visited.has(round.code)) continue;

    const cluster = findOverlappingCluster(round, allRounds, visited);

    if (cluster.size > 1) {
      parallelBlocks.push(cluster);
    } else {
      normalRounds.push(round.code);
    }
  }

  const parallelEventGroups = parallelBlocks.map((block) =>
    Array.from(block)
      .map((code) => code.split('-r')[0])
      .filter((event): event is string => event !== undefined),
  );

  return { normalRounds, parallelEventGroups };
}

function findOverlappingCluster(
  start: RoundInfo,
  allRounds: RoundInfo[],
  visited: Set<string>,
): Set<string> {
  const cluster = new Set<string>();
  const queue = [start];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || cluster.has(current.code)) continue;

    cluster.add(current.code);
    visited.add(current.code);

    const overlaps = allRounds.filter(
      (other) =>
        !cluster.has(other.code) &&
        current.start < other.end &&
        other.start < current.end,
    );
    queue.push(...overlaps);
  }

  return cluster;
}
