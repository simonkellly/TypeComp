export const EVENT_IDS = [
  '333',
  '222',
  '444',
  '555',
  '666',
  '777',
  '333bf',
  '333fm',
  '333oh',
  '333ft',
  'clock',
  'minx',
  'pyram',
  'skewb',
  'sq1',
  '444bf',
  '555bf',
  '333mbf',
] as const;

export type EventId = (typeof EVENT_IDS)[number];

export type EventLiteral = `_${EventId}`;

export type RoundLiteral = `${EventLiteral}-r${number}`;

export function eventLiteral(eventId: EventId): EventLiteral {
  return `_${eventId}`;
}

export function parseRoundLiteral(roundLiteral: RoundLiteral): {
  eventId: EventId;
  roundNumber: number;
} {
  const match = roundLiteral.match(/^_(\w+)-r(\d+)$/);

  if (!match?.[1] || !match[2]) {
    throw new Error(`Invalid round literal: ${roundLiteral}`);
  }

  return {
    eventId: match[1] as EventId,
    roundNumber: parseInt(match[2], 10),
  };
}

export function roundLiteral(
  eventId: EventId,
  roundNumber: number,
): RoundLiteral {
  return `_${eventId}-r${roundNumber}`;
}

export const EVENT_NAMES: Record<EventId, string> = {
  '333': '3x3x3 Cube',
  '222': '2x2x2 Cube',
  '444': '4x4x4 Cube',
  '555': '5x5x5 Cube',
  '666': '6x6x6 Cube',
  '777': '7x7x7 Cube',
  '333bf': '3x3x3 Blindfolded',
  '333fm': '3x3x3 Fewest Moves',
  '333oh': '3x3x3 One-Handed',
  '333ft': '3x3x3 With Feet',
  clock: 'Clock',
  minx: 'Megaminx',
  pyram: 'Pyraminx',
  skewb: 'Skewb',
  sq1: 'Square-1',
  '444bf': '4x4x4 Blindfolded',
  '555bf': '5x5x5 Blindfolded',
  '333mbf': '3x3x3 Multi-Blind',
};

export type AttemptResult = number | 'DNF' | 'DNS';

export function parseAttemptResult(
  result: string | number,
): AttemptResult | null {
  if (typeof result === 'number') {
    return result >= 0 ? result : null;
  }
  if (result === 'DNF' || result === 'DNS') {
    return result;
  }
  const num = parseFloat(result);

  if (!Number.isNaN(num) && num >= 0) {
    return num;
  }

  return null;
}
