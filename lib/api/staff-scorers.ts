import { DateTime } from 'luxon';
import {
  getBaseEventForScrambling,
  getScramblingResultType,
  isNicheEvent,
  STAFF_JOBS,
} from '../constants';
import { PersonalBest } from '../functions/events';
import { getExtensionData } from '../functions/extensions';
import type { Group, Person, StaffScorer } from '../types/core';
import type { Activity, RegistrantId } from '../types/wcif';
import { parseActivityCode } from '../utils/activity-utils';
import { GroupLookupCache } from '../utils/group-cache';
import type { PersonFilter } from './filters';

export type { StaffScorer } from '../types/core';

export function staffScorer(
  scoreFn: (person: Person, activity: Activity) => number,
): StaffScorer {
  return {
    caresAboutJobs: false,
    caresAboutStations: false,
    score(_competition, person, activity) {
      return scoreFn(person, activity);
    },
  };
}

export function fastestScrambler(
  eventIds: string | string[],
  nicheBonus: number = 1.5,
): StaffScorer {
  const events = Array.isArray(eventIds) ? eventIds : [eventIds];

  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(_competition, person, activity, jobName) {
      if (jobName !== 'staff-scrambler') return 0;

      let targetEvents = events;
      if (targetEvents.length === 0) {
        const parsed = parseActivityCode(activity.activityCode);
        if (parsed?.eventId) targetEvents = [parsed.eventId];
      }
      if (targetEvents.length === 0) return 0;

      let totalScore = 0;
      let validEvents = 0;

      for (const eventId of targetEvents) {
        const baseEventId = getBaseEventForScrambling(eventId);
        const resultType = getScramblingResultType(eventId);
        const pb = PersonalBest(person, baseEventId, resultType);

        if (pb === null || pb <= 0) continue;

        let score = 10000 / (pb + 100);
        if (isNicheEvent(eventId)) score *= nicheBonus;

        totalScore += score;
        validEvents++;
      }

      return validEvents === 0 ? 0 : totalScore / validEvents;
    },
  };
}

export function priorAssignmentScorer(
  staffingWeight: number,
  competingWeight: number,
  sinceTime?: DateTime,
): StaffScorer {
  let cache: GroupLookupCache | null = null;

  return {
    caresAboutJobs: false,
    caresAboutStations: false,
    score(competition, person, activity) {
      if (!cache) cache = new GroupLookupCache(competition);

      const timezone = cache.getTimezone();
      const activityStart = DateTime.fromISO(activity.startTime).setZone(
        timezone,
      );

      let staffingHours = 0;
      let competingHours = 0;

      for (const assignment of person.assignments ?? []) {
        const group = cache.get(assignment.activityId);
        if (!group) continue;

        const groupStart = DateTime.fromISO(group.startTime).setZone(timezone);
        const groupEnd = DateTime.fromISO(group.endTime).setZone(timezone);

        if (groupStart >= activityStart) continue;
        if (sinceTime && groupStart < sinceTime) continue;

        const hours = groupEnd.diff(groupStart, 'hours').hours;

        if (assignment.assignmentCode.startsWith('staff-')) {
          staffingHours += hours;
        } else if (assignment.assignmentCode === 'competitor') {
          competingHours += hours;
        }
      }

      return staffingWeight * staffingHours + competingWeight * competingHours;
    },
  };
}

export function preferenceScorer(
  weight: number,
  propertyPrefix: string,
  prior: number,
  jobs: readonly string[] = STAFF_JOBS,
): StaffScorer {
  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(_competition, person, _activity, jobName) {
      if (!jobName) return 0;

      const bareJobName = jobName.startsWith('staff-')
        ? jobName.slice(6)
        : jobName;
      if (!jobs.includes(bareJobName)) return 0;

      const personExt = getExtensionData<{
        properties?: Record<string, unknown>;
      }>('Person', person, 'org.cubingusa.natshelper.v1.');
      const properties = personExt?.properties || {};

      const prefs: [string, number][] = [];
      let totalPrefs = 0;

      for (const [key, value] of Object.entries(properties)) {
        if (key.startsWith(propertyPrefix) && typeof value === 'number') {
          const job = key.slice(propertyPrefix.length);
          prefs.push([job, value]);
          totalPrefs += value;
        }
      }

      if (totalPrefs === 0) return 0;

      const jobPref = prefs.find(([job]) => job === bareJobName);
      if (!jobPref) return -100000;

      const targetRatio = jobPref[1] / totalPrefs;

      const allStaffAssignments = (person.assignments ?? []).filter((a) =>
        a.assignmentCode.startsWith('staff-'),
      );
      const matchingAssignments = allStaffAssignments.filter(
        (a) => a.assignmentCode === `staff-${bareJobName}`,
      );

      if (allStaffAssignments.length === 0) return 0;

      const actualRatio =
        matchingAssignments.length / allStaffAssignments.length;
      const decay = Math.min(allStaffAssignments.length, prior) / prior;

      return decay * weight * (targetRatio - actualRatio);
    },
  };
}

export function sameJobScorer(
  centerMinutes: number,
  positiveWeight: number,
  negativeWeight: number,
  jobs?: readonly string[],
): StaffScorer {
  let cache: GroupLookupCache | null = null;

  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(competition, person, activity, jobName) {
      if (!jobName) return 0;

      const bareJobName = jobName.startsWith('staff-')
        ? jobName.slice(6)
        : jobName;
      if (jobs && !jobs.includes(bareJobName)) return 0;

      if (!cache) cache = new GroupLookupCache(competition);

      const timezone = cache.getTimezone();
      const activityStart = DateTime.fromISO(activity.startTime).setZone(
        timezone,
      );

      let mostRecentEnd: DateTime | null = null;

      for (const assignment of person.assignments ?? []) {
        if (assignment.assignmentCode !== `staff-${bareJobName}`) continue;

        const group = cache.get(assignment.activityId);
        if (!group) continue;

        const groupEnd = DateTime.fromISO(group.endTime).setZone(timezone);
        if (groupEnd > activityStart) continue;

        if (!mostRecentEnd || groupEnd > mostRecentEnd) {
          mostRecentEnd = groupEnd;
        }
      }

      if (!mostRecentEnd) return 0;

      const minutesSince = activityStart.diff(mostRecentEnd, 'minutes').minutes;

      return minutesSince > centerMinutes
        ? ((minutesSince - centerMinutes) / centerMinutes) * positiveWeight
        : ((centerMinutes - minutesSince) / centerMinutes) * negativeWeight;
    },
  };
}

export function consecutiveJobScorer(
  centerMinutes: number,
  positiveWeight: number,
  negativeWeight: number,
  jobs?: readonly string[],
): StaffScorer {
  let cache: GroupLookupCache | null = null;

  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(competition, person, activity, jobName) {
      if (!jobName) return 0;

      const bareJobName = jobName.startsWith('staff-')
        ? jobName.slice(6)
        : jobName;
      if (jobs && !jobs.includes(bareJobName)) return 0;

      if (!cache) cache = new GroupLookupCache(competition);

      const timezone = cache.getTimezone();
      let totalMinutes = 0;
      let currentStart = DateTime.fromISO(activity.startTime).setZone(timezone);

      while (true) {
        let foundPreceding = false;

        for (const assignment of person.assignments ?? []) {
          if (!assignment.assignmentCode.startsWith('staff-')) continue;

          const bareJob = assignment.assignmentCode.slice(6);
          if (jobs && !jobs.includes(bareJob)) continue;

          const group = cache.get(assignment.activityId);
          if (!group) continue;

          const groupEnd = DateTime.fromISO(group.endTime).setZone(timezone);
          if (Math.abs(groupEnd.toMillis() - currentStart.toMillis()) < 1000) {
            const groupStart = DateTime.fromISO(group.startTime).setZone(
              timezone,
            );
            totalMinutes += groupEnd.diff(groupStart, 'minutes').minutes;
            currentStart = groupStart;
            foundPreceding = true;
            break;
          }
        }

        if (!foundPreceding) break;
      }

      if (totalMinutes === 0) return 0;

      return totalMinutes > centerMinutes
        ? ((totalMinutes - centerMinutes) / centerMinutes) * negativeWeight
        : ((centerMinutes - totalMinutes) / centerMinutes) * positiveWeight;
    },
  };
}

export function mismatchedStationScorer(weight: number): StaffScorer {
  let cache: GroupLookupCache | null = null;

  return {
    caresAboutJobs: true,
    caresAboutStations: true,
    score(competition, person, activity, jobName, stationNumber) {
      if (!jobName || stationNumber === undefined || stationNumber === null)
        return 0;

      if (!cache) cache = new GroupLookupCache(competition);

      const timezone = cache.getTimezone();
      const activityStart = DateTime.fromISO(activity.startTime).setZone(
        timezone,
      );

      for (const assignment of person.assignments ?? []) {
        if (assignment.assignmentCode !== jobName) continue;

        const group = cache.get(assignment.activityId);
        if (!group) continue;

        const groupEnd = DateTime.fromISO(group.endTime).setZone(timezone);

        if (Math.abs(groupEnd.toMillis() - activityStart.toMillis()) < 1000) {
          if (
            assignment.stationNumber !== null &&
            assignment.stationNumber !== stationNumber
          ) {
            return weight;
          }
          break;
        }
      }

      return 0;
    },
  };
}

export function followingGroupScorer(
  weight: number,
  maxMinutes: number,
  personFilter?: PersonFilter,
): StaffScorer {
  const personCache = new Map<number, boolean>();
  let groupCache: GroupLookupCache | null = null;

  return {
    caresAboutJobs: false,
    caresAboutStations: false,
    score(competition, person, activity) {
      if (personFilter) {
        if (!personCache.has(person.registrantId)) {
          personCache.set(person.registrantId, personFilter(person));
        }
        if (!personCache.get(person.registrantId)) return 0;
      }

      if (!groupCache) groupCache = new GroupLookupCache(competition);

      const timezone = groupCache.getTimezone();
      const activityEnd = DateTime.fromISO(activity.endTime).setZone(timezone);
      const maxEndTime = activityEnd.plus({ minutes: maxMinutes });

      for (const assignment of person.assignments ?? []) {
        if (assignment.assignmentCode !== 'competitor') continue;

        const group = groupCache.get(assignment.activityId);
        if (!group) continue;

        const groupStart = DateTime.fromISO(group.startTime).setZone(timezone);

        if (groupStart >= activityEnd && groupStart <= maxEndTime) {
          return weight;
        }
      }

      return 0;
    },
  };
}

export function delegateDeprioritizer(weight: number = -1000): StaffScorer {
  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(_competition, person, _activity, jobName) {
      if (!jobName?.startsWith('staff-')) return 0;

      const roles = person.roles ?? [];
      if (roles.includes('delegate') || roles.includes('trainee-delegate')) {
        return weight;
      }
      return 0;
    },
  };
}

export function balancedScramblerScorer(
  sortedScramblerIds: RegistrantId[],
  totalGroups: number,
): StaffScorer {
  const positionMap = new Map<RegistrantId, number>();
  for (let idx = 0; idx < sortedScramblerIds.length; idx++) {
    const id = sortedScramblerIds[idx];
    if (id !== undefined) positionMap.set(id, idx);
  }

  return {
    caresAboutJobs: true,
    caresAboutStations: false,
    score(_competition, person, activity, jobName) {
      if (jobName !== 'staff-scrambler') return 0;

      const position = positionMap.get(person.registrantId);
      if (position === undefined) return 0;

      const match = activity.activityCode.match(/g(\d+)/);
      if (!match?.[1]) return 0;

      const groupNum = parseInt(match[1], 10);
      const idealGroup = (position % totalGroups) + 1;
      const distanceFromIdeal = Math.abs(groupNum - idealGroup);

      return distanceFromIdeal === 0 ? 5 : -distanceFromIdeal * 2;
    },
  };
}

export function conditionalScorer(
  personCondition: PersonFilter,
  groupCondition: (group: Group) => boolean,
  jobCondition: (job: string | undefined) => boolean,
  stationCondition: (station: number | undefined) => boolean,
  score: number,
): StaffScorer {
  const personCache = new Map<number, boolean>();

  return {
    caresAboutJobs: true,
    caresAboutStations: true,
    score(_competition, person, activity, jobName, stationNumber) {
      if (!personCache.has(person.registrantId)) {
        personCache.set(person.registrantId, personCondition(person));
      }
      if (!personCache.get(person.registrantId)) return 0;

      const group: Group = {
        ...activity,
        activityCode: activity.activityCode,
        startTime: activity.startTime,
        endTime: activity.endTime,
      } as Group;

      if (!groupCondition(group)) return 0;
      if (!jobCondition(jobName)) return 0;
      if (!stationCondition(stationNumber)) return 0;

      return score;
    },
  };
}

export function combineStaffScorers(...scorers: StaffScorer[]): StaffScorer {
  return {
    caresAboutJobs: scorers.some((s) => s.caresAboutJobs),
    caresAboutStations: scorers.some((s) => s.caresAboutStations),
    score(competition, person, activity, jobName, stationNumber) {
      return scorers.reduce(
        (total, scorer) =>
          total +
          scorer.score(competition, person, activity, jobName, stationNumber),
        0,
      );
    },
  };
}
