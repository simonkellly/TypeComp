import { DateTime } from 'luxon';
import type { Scorer as CoreScorer, Group, Person } from '../types/core';

export type Scorer = CoreScorer;

import { parseActivityCode } from '../functions/activity-code';
import { PersonalBest } from '../functions/events';
import type { StaffScorer } from '../functions/staff';
import type { EventId } from '../types/literals';
import type { Activity, Competition } from '../types/wcif';
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
      if (!personCache.get(person.registrantId)) {
        return 0;
      }

      if (!groupCache.has(group.id)) {
        groupCache.set(group.id, groupFilter(group));
      }
      if (!groupCache.get(group.id)) {
        return 0;
      }

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
    const venue = competition.schedule.venues[0];
    const timezone = venue?.timezone || 'UTC';
    return DateTime.fromISO(group.endTime).setZone(timezone);
  };

  const getGroupForActivityId = (activityId: number): Group | null => {
    for (const venue of competition.schedule.venues) {
      for (const room of venue.rooms) {
        for (const parentActivity of room.activities) {
          if (parentActivity.childActivities) {
            for (const child of parentActivity.childActivities) {
              if (child.id === activityId) {
                return child as Group;
              }
            }
          }
        }
      }
    }
    return null;
  };

  return {
    getScore(person: Person, group: Group, _otherPeople: Person[]): number {
      if (!groupCache.has(group.id)) {
        groupCache.set(group.id, currentGroupFilter(group));
      }
      if (!groupCache.get(group.id)) {
        return 0;
      }

      const currentEnd = getEndTime(group);
      let closestMinutes: number | null = null;

      for (const assignment of person.assignments || []) {
        if (assignment.assignmentCode !== 'competitor') continue;

        const otherGroup = getGroupForActivityId(assignment.activityId);
        if (!otherGroup) continue;
        if (!otherGroupFilter(otherGroup)) continue;

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

export function likelyAtVenue(
  competition: Competition,
  _sigma: number = 60,
): Scorer {
  const getEndTime = (group: Group): DateTime => {
    const venue = competition.schedule.venues[0];
    const timezone = venue?.timezone || 'UTC';
    return DateTime.fromISO(group.endTime).setZone(timezone);
  };

  const getStartTime = (group: Group): DateTime => {
    const venue = competition.schedule.venues[0];
    const timezone = venue?.timezone || 'UTC';
    return DateTime.fromISO(group.startTime).setZone(timezone);
  };

  const activityMap = new Map<number, { start: DateTime; end: DateTime }>();

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const parent of room.activities) {
        if (parent.childActivities) {
          for (const child of parent.childActivities) {
            activityMap.set(child.id, {
              start: getStartTime(child as Group),
              end: getEndTime(child as Group),
            });
          }
        }
      }
    }
  }

  return {
    getScore(person: Person, group: Group, _otherPeople: Person[]): number {
      const targetTime = getStartTime(group);
      const personActivities = (person.assignments || [])
        .filter(
          (a) =>
            a.assignmentCode === 'competitor' ||
            a.assignmentCode.startsWith('staff-'),
        )
        .map((a) => activityMap.get(a.activityId))
        .filter((t): t is { start: DateTime; end: DateTime } => !!t)
        .sort((a, b) => a.start.toMillis() - b.start.toMillis());

      if (personActivities.length === 0) return 0;

      const activitiesToday = personActivities.filter((a) =>
        a.start.hasSame(targetTime, 'day'),
      );
      if (activitiesToday.length === 0) return 0;

      const starts = activitiesToday.map((a) => a.start);
      const ends = activitiesToday.map((a) => a.end);

      const firstStart = starts[0];
      if (firstStart !== undefined && firstStart > targetTime) {
        const diffMinutes = firstStart.diff(targetTime, 'minutes').minutes;
        if (diffMinutes === undefined) return 0;

        return 100 / (diffMinutes + 10);
      }

      const prevEndIndex = ends.findLastIndex((end) => end <= targetTime);
      const nextStartIndex = starts.findIndex((start) => start >= targetTime);

      if (prevEndIndex !== -1) {
        const prevEnd = ends[prevEndIndex];
        if (!prevEnd) return 2;

        if (nextStartIndex !== -1) {
          const nextStart = starts[nextStartIndex];
          if (!nextStart) return 3;
          const gapDuration = nextStart.diff(prevEnd, 'minutes').minutes;

          const minutesConfig = 60;
          if (gapDuration > minutesConfig * 2) {
            return 3;
          }

          return 5;
        } else {
          const timeSinceLast = targetTime.diff(prevEnd, 'minutes').minutes;
          if (timeSinceLast > 30) {
            return 2;
          }
          return 4;
        }
      }

      return 1;
    },
  };
}

export function fastestScrambler(
  eventIds: string | string[],
  nicheBonus: number = 1.5,
): StaffScorer {
  const NICHE_EVENTS = new Set([
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

  const SCRAMBLE_MAP: Record<string, string> = {
    '333': '333',
    '333bf': '333',
    '333oh': '333',
    '333fm': '333',
    '333mbf': '333',
    '444': '444',
    '444bf': '444',
    '555': '555',
    '555bf': '555',
  };

  const _ONE_HOUR_CENTISECONDS = 360000;

  const events = Array.isArray(eventIds) ? eventIds : [eventIds];

  return {
    caresAboutJobs: true,
    caresAboutStations: false,

    Score(
      _competition: Competition,
      person: Person,
      activity: Activity,
      _jobName?: string,
      _stationNumber?: number,
    ): number {
      let targetEvents = events;

      if (targetEvents.length === 0) {
        const parsed = parseActivityCode(activity.activityCode);
        if (parsed?.eventId) targetEvents = [parsed.eventId];
      }

      if (targetEvents.length === 0) return 0;

      let totalScore = 0;
      let validEvents = 0;

      for (const eventId of targetEvents) {
        const baseEventId = SCRAMBLE_MAP[eventId] ?? eventId;
        const resultType =
          baseEventId.includes('bf') || baseEventId.includes('mbf')
            ? 'single'
            : 'average';

        const pb = PersonalBest(person, baseEventId, resultType);

        if (pb === null || pb <= 0) continue;

        let score = 10000 / (pb + 100);

        if (NICHE_EVENTS.has(eventId)) {
          score *= nicheBonus;
        }

        totalScore += score;
        validEvents++;
      }

      if (validEvents === 0) return 0;

      return totalScore / validEvents;
    },
  };
}

export function proficiency(eventId: string): StaffScorer {
  const getSuitability = (person: Person): number => {
    const isRegistered =
      person.registration?.status === 'accepted' &&
      person.registration?.eventIds.includes(eventId as EventId);

    const SCRAMBLE_MAP: Record<string, string> = {
      '333': '333',
      '333bf': '333',
      '333oh': '333',
      '333fm': '333',
      '333mbf': '333',
      '444': '444',
      '444bf': '444',
      '555': '555',
      '555bf': '555',
      '666': '666',
      '777': '777',
      clock: 'clock',
      minx: 'minx',
      pyram: 'pyram',
      skewb: 'skewb',
      sq1: 'sq1',
    };
    const baseEventId = SCRAMBLE_MAP[eventId] ?? eventId;
    const pbs = person.personalBests || [];

    const hasPB = pbs.some((pb) => pb.eventId === (baseEventId as EventId));

    if (isRegistered && hasPB) return 3;
    if (isRegistered) return 2;
    if (hasPB) return 1;
    return 0;
  };

  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    Score(
      _competition: Competition,
      person: Person,
      _activity: Activity,
    ): number {
      return getSuitability(person);
    },
  };
}

export function staffScorer(
  scoreFn: (person: Person, activity: Activity) => number,
): StaffScorer {
  return {
    caresAboutJobs: false,
    caresAboutStations: false,
    Score(
      _competition: Competition,
      person: Person,
      activity: Activity,
    ): number {
      return scoreFn(person, activity);
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

export function combineStaffScorers(...scorers: StaffScorer[]): StaffScorer {
  return {
    caresAboutJobs: scorers.some((s) => s.caresAboutJobs),
    caresAboutStations: scorers.some((s) => s.caresAboutStations),
    Score(
      competition: Competition,
      person: Person,
      activity: Activity,
      jobName?: string,
      stationNumber?: number,
    ): number {
      return scorers.reduce(
        (total, scorer) =>
          total +
          scorer.Score(competition, person, activity, jobName, stationNumber),
        0,
      );
    },
  };
}
