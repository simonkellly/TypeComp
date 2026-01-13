export const SCRAMBLE_MAP: Record<string, string> = {
  '333': '333',
  '222': '222',
  '444': '444',
  '555': '555',
  '666': '666',
  '777': '777',
  '333bf': '333',
  '333oh': '333',
  '333fm': '333',
  '333mbf': '333',
  '444bf': '444',
  '555bf': '555',
  clock: 'clock',
  minx: 'minx',
  pyram: 'pyram',
  skewb: 'skewb',
  sq1: 'sq1',
};

export const NICHE_EVENTS = new Set([
  'clock',
  'minx',
  'pyram',
  'skewb',
  'sq1',
  '333oh',
  '333bf',
  '444bf',
  '555bf',
  '333fm',
  '333mbf',
]);

export const STAFF_JOBS = ['judge', 'scrambler', 'runner'] as const;

export const STAFF_ASSIGNMENT_CODES = [
  'staff-judge',
  'staff-scrambler',
  'staff-runner',
  'staff-dataentry',
] as const;

export const DISTRIBUTED_EVENTS = new Set(['333fm', '333mbf']);

export function getBaseEventForScrambling(eventId: string): string {
  return SCRAMBLE_MAP[eventId] ?? eventId;
}

export function getScramblingResultType(eventId: string): 'single' | 'average' {
  const baseEvent = getBaseEventForScrambling(eventId);
  return baseEvent.includes('bf') || baseEvent.includes('mbf')
    ? 'single'
    : 'average';
}

export function isNicheEvent(eventId: string): boolean {
  return NICHE_EVENTS.has(eventId);
}

export function isDistributedEvent(eventId: string): boolean {
  return DISTRIBUTED_EVENTS.has(eventId);
}
