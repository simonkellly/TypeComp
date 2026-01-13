import type { Competition, Person } from '../types/wcif';
import { parseActivityCode } from './activity-code';
import { competitorsForRound } from './competitors';
import { getGroupsForRound } from './groups-helpers';
import { firstName } from './persons';

export type SortingRule = 'ranks' | 'balanced' | 'symmetric' | 'name-optimised';

const RANK_ONLY_EVENTS = [
  '333',
  '222',
  '333bf',
  '333oh',
  '333ft',
  'pyram',
  'skewb',
  'clock',
  'sq1',
];

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export function sortedCompetitorsForRound(
  competition: Competition,
  roundId: string,
  sortingRule: SortingRule,
): Person[] {
  const sortedByRanks = competitorsForRound(competition, roundId);
  const { eventId, roundNumber } = parseActivityCode(roundId) ?? {};

  if (roundNumber !== null && roundNumber !== undefined && roundNumber > 1) {
    return sortedByRanks;
  }

  if (sortingRule === 'ranks') {
    return sortedByRanks;
  }

  if (
    sortingRule === 'balanced' &&
    eventId &&
    RANK_ONLY_EVENTS.includes(eventId)
  ) {
    return sortedByRanks;
  }

  if (['balanced', 'symmetric'].includes(sortingRule)) {
    const groups = getGroupsForRound(competition, roundId);
    const groupCount = groups.length;

    if (groupCount === 0) return sortedByRanks;

    return sortedByRanks.slice().sort((a, b) => {
      const idxA = sortedByRanks.indexOf(a);
      const idxB = sortedByRanks.indexOf(b);
      const valA =
        groupCount - ((sortedByRanks.length - idxA - 1) % groupCount);
      const valB =
        groupCount - ((sortedByRanks.length - idxB - 1) % groupCount);
      if (valA === valB) {
        return Math.random() - 0.5;
      }
      return valA - valB;
    });
  }

  if (sortingRule === 'name-optimised') {
    const byName = new Map<string, Person[]>();

    for (const p of sortedByRanks) {
      const first = firstName(p);
      byName.set(first, [...(byName.get(first) ?? []), p]);
    }

    const nameGroups = [...byName.values()].sort((a, b) => a.length - b.length);

    let result: Person[] = [];

    for (const group of nameGroups) {
      if (result.length === 0) {
        result = [...group];
        continue;
      }

      const chunkSize = Math.ceil(result.length / group.length);
      const chunks = chunk(result, chunkSize);

      result = chunks.flatMap((c, i) => {
        const person = group[i];
        return person ? [...c, person] : c;
      });
    }

    return result;
  }

  throw new Error(`Unrecognised sorting rule: '${sortingRule}'`);
}
