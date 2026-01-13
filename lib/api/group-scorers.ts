import { DateTime } from 'luxon';
import { getGroupForActivityId } from '../functions/groups-helpers';
import type { Group, Person, Scorer } from '../types/core';
import type { Competition } from '../types/wcif';
import type { GroupFilter, PersonFilter } from './filters';

export function byMatchingValue(
  valueFn: (person: Person) => unknown,
  score: number,
  limit?: number,
): Scorer {
  const cache = new Map<number, unknown>();

  const getValue = (person: Person): unknown => {
    if (!cache.has(person.registrantId)) {
      cache.set(person.registrantId, valueFn(person));
    }
    return cache.get(person.registrantId);
  };

  return {
    getScore(person: Person, _group: Group, otherPeople: Person[]): number {
      const val = getValue(person);
      let matching = otherPeople.filter((p) => getValue(p) === val).length;
      if (limit !== undefined && matching > limit) {
        matching = limit;
      }
      return matching * score;
    },
  };
}

export function byFilters(
  personFilter: PersonFilter,
  groupFilter: GroupFilter,
  score: number,
): Scorer {
  const personCache = new Map<number, boolean>();
  const groupCache = new Map<number, boolean>();

  return {
    getScore(person: Person, group: Group, _otherPeople: Person[]): number {
      if (!personCache.has(person.registrantId)) {
        personCache.set(person.registrantId, personFilter(person));
      }
      if (!personCache.get(person.registrantId)) return 0;

      if (!groupCache.has(group.id)) {
        groupCache.set(group.id, groupFilter(group));
      }
      if (!groupCache.get(group.id)) return 0;

      return score;
    },
  };
}

export function sameCountry(score: number, limit?: number): Scorer {
  return byMatchingValue((p) => p.countryIso2, score, limit);
}

export function differentFirstNames(penalty: number = -5): Scorer {
  return byMatchingValue(
    (p) => p.name.split(' ')[0]?.toLowerCase(),
    penalty,
    1,
  );
}

export function sameWcaIdYear(score: number, limit?: number): Scorer {
  return byMatchingValue(
    (p) => (p.wcaId ? parseInt(p.wcaId.slice(0, 4), 10) : null),
    score,
    limit,
  );
}

export function spreadOut(
  personFilter: PersonFilter,
  strength: number = 1,
): Scorer {
  return {
    getScore(person: Person, group: Group, _otherPeople: Person[]): number {
      if (!personFilter(person)) return 0;

      const match = group.activityCode.match(/g(\d+)/);
      if (!match?.[1]) return 0;

      const groupNum = parseInt(match[1], 10);
      let score = 0;
      if (groupNum % 2 === 1) score += strength;
      if (groupNum % 4 === 1) score += strength;
      if (groupNum % 8 === 1) score += strength;
      return score;
    },
  };
}

export function recentlyCompeted(
  competition: Competition,
  currentGroupFilter: GroupFilter,
  otherGroupFilter: GroupFilter,
  scoreFn: (minutesSince: number) => number,
): Scorer {
  const groupCache = new Map<number, boolean>();

  const getEndTime = (group: Group): DateTime => {
    const timezone = competition.schedule.venues[0]?.timezone ?? 'UTC';
    return DateTime.fromISO(group.endTime).setZone(timezone);
  };

  return {
    getScore(person: Person, group: Group, _otherPeople: Person[]): number {
      if (!groupCache.has(group.id)) {
        groupCache.set(group.id, currentGroupFilter(group));
      }
      if (!groupCache.get(group.id)) return 0;

      const currentEnd = getEndTime(group);
      let closestMinutes: number | null = null;

      for (const assignment of person.assignments ?? []) {
        if (assignment.assignmentCode !== 'competitor') continue;

        const otherGroup = getGroupForActivityId(
          competition,
          assignment.activityId,
        );
        if (!otherGroup || !otherGroupFilter(otherGroup)) continue;

        const otherEnd = getEndTime(otherGroup);
        const diffMinutes = currentEnd.diff(otherEnd, 'minutes').minutes;

        if (diffMinutes >= 0) {
          if (closestMinutes === null || diffMinutes < closestMinutes) {
            closestMinutes = diffMinutes;
          }
        }
      }

      if (closestMinutes === null) return 0;
      return scoreFn(closestMinutes);
    },
  };
}

export function combineScorers(...scorers: Scorer[]): Scorer {
  return {
    getScore(person: Person, group: Group, otherPeople: Person[]): number {
      return scorers.reduce(
        (total, scorer) => total + scorer.getScore(person, group, otherPeople),
        0,
      );
    },
  };
}

export function disperseDelegates(
  isDelegateFn: (person: Person) => boolean,
  penalty: number = -10,
): Scorer {
  return {
    getScore(person: Person, _group: Group, otherPeople: Person[]): number {
      if (!isDelegateFn(person)) return 0;
      const delegateCount = otherPeople.filter(isDelegateFn).length;
      return delegateCount * penalty;
    },
  };
}
