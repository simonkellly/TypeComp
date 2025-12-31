import { DateTime } from 'luxon';
import type { TypeComp } from '@/lib/api';

export const COMPETITION_ID = 'DublinPickNMix2026';

export function getRoomName(tc: TypeComp): string {
  const venue = tc.ctx.competition.schedule.venues[0];
  if (venue && venue.rooms.length > 0) {
    return venue.rooms[0]?.name ?? 'Main Hall';
  }
  return 'Main Hall';
}

export const STAFF_REQUIREMENTS = {
  scramblers: 4,
  runners: 2,
  judges: 18,
};

export function getRoundDate(tc: TypeComp, roundId: string): string {
  const venues = tc.ctx.competition.schedule.venues;
  for (const venue of venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        if (activity.activityCode === roundId) {
          const startTime = activity.startTime;
          if (!startTime) {
            console.warn(
              `Could not find start time for ${roundId}, using 2000-01-01`,
            );
            return '2000-01-01' as const;
          }
          return startTime.split('T')[0] ?? '2000-01-01';
        }
      }
    }
  }
  console.warn(`Could not find date for ${roundId}, using 2000-01-01`);
  return '2000-01-01' as const;
}

export function classifyRounds(tc: TypeComp): {
  normalRounds: string[];
  parallelEventGroups: string[][];
} {
  const competition = tc.ctx.competition;

  const allRounds: { code: string; start: DateTime; end: DateTime }[] = [];
  const processedCodes = new Set<string>();

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        if (activity.activityCode.match(/^[^-]+-r\d+$/)) {
          if (processedCodes.has(activity.activityCode)) continue;
          processedCodes.add(activity.activityCode);

          allRounds.push({
            code: activity.activityCode,
            start: DateTime.fromISO(activity.startTime),
            end: DateTime.fromISO(activity.endTime),
          });
        }
      }
    }
  }

  const normalRounds: string[] = [];
  const parallelBlocks: Set<string>[] = [];
  const visited = new Set<string>();

  for (const round of allRounds) {
    if (visited.has(round.code)) continue;

    const cluster = new Set<string>();
    const queue = [round];

    while (queue.length > 0) {
      const current = queue.pop();
      if (!current) continue;

      if (cluster.has(current.code)) continue;

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

    if (cluster.size > 1) {
      parallelBlocks.push(cluster);
    } else {
      normalRounds.push(round.code);
    }
  }

  const parallelEventGroups = parallelBlocks.map((block) => {
    return Array.from(block)
      .map((code) => code.split('-r')[0])
      .filter((event): event is string => event !== undefined);
  });

  return { normalRounds, parallelEventGroups };
}
