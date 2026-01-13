export {
  activityCodeContains,
  formatActivityCode,
  type ParsedActivityCode,
  parseActivityCode,
} from '../functions/activity-code';

import { parseActivityCode } from '../functions/activity-code';

export function extractGroupNumber(activityCode: string): number | null {
  const match = activityCode.match(/g(\d+)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

export function extractRoundId(activityCode: string): string | null {
  const match = activityCode.match(/^([a-z0-9]+-r\d+)/);
  return match?.[1] ?? null;
}

export function extractEventId(activityCode: string): string | null {
  const match = activityCode.match(/^([a-z0-9]+)-r/);
  return match?.[1] ?? null;
}

export function parseRoundId(
  roundId: string,
): { eventId: string; roundNumber: number } | null {
  const match = roundId.match(/^(\w+)-r(\d+)$/);
  if (!match?.[1] || !match[2]) return null;
  return {
    eventId: match[1],
    roundNumber: parseInt(match[2], 10),
  };
}

export function formatRoundId(eventId: string, roundNumber: number): string {
  return `${eventId}-r${roundNumber}`;
}

export function formatGroupCode(roundId: string, groupNumber: number): string {
  return `${roundId}-g${groupNumber}`;
}

export function isGroupActivityCode(activityCode: string): boolean {
  return extractGroupNumber(activityCode) !== null;
}

export function isRoundActivityCode(activityCode: string): boolean {
  const parsed = parseActivityCode(activityCode);
  return parsed !== null && parsed.roundNumber !== null;
}
