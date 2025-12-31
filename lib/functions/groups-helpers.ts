import { DateTime } from 'luxon';
import type { Group } from '../types/core';
import type {
  Activity,
  Assignment,
  Competition,
  Person,
  Round,
} from '../types/wcif';
import { activityCodeContains, parseActivityCode } from './activity-code';

export function getAllGroups(competition: Competition): Group[] {
  const groups: Group[] = [];

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        if (activity.childActivities) {
          for (const childActivity of activity.childActivities) {
            groups.push(childActivity as Group);
          }
        }
      }
    }
  }

  return groups;
}

export function getGroupsForRoundCode(
  competition: Competition,
  roundCode: string,
): Group[] {
  const roundParsed = parseActivityCode(roundCode);

  if (!roundParsed?.eventId) {
    return [];
  }

  return getAllGroups(competition).filter((group) => {
    const groupActivityCode = group.activityCode;

    if (!groupActivityCode || typeof groupActivityCode !== 'string') {
      return false;
    }
    const groupParsed = parseActivityCode(groupActivityCode);

    if (!groupParsed) {
      return false;
    }

    return activityCodeContains(roundParsed, groupParsed);
  });
}

export function getGroupsForRound(
  competition: Competition,
  roundId: string,
): Group[] {
  return getGroupsForRoundCode(competition, roundId);
}

function parseWcifRoundId(
  roundId: string,
): { eventId: string; roundNumber: number } | null {
  const match = roundId.match(/^(\w+)-r(\d+)$/);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    eventId: match[1],
    roundNumber: parseInt(match[2], 10),
  };
}

export function getWcifRound(
  competition: Competition,
  roundId: string,
): Round | null {
  const parsed = parseWcifRoundId(roundId);

  if (!parsed) {
    return null;
  }
  const event = competition.events.find((e) => e.id === parsed.eventId);

  if (!event) {
    return null;
  }

  return event.rounds.find((r) => r.id === roundId) || null;
}

export function getActivityById(
  competition: Competition,
  activityId: number,
): Activity | null {
  const findActivity = (activities: Activity[]): Activity | null => {
    for (const activity of activities) {
      if (activity.id === activityId) {
        return activity;
      }
      if (activity.childActivities && activity.childActivities.length > 0) {
        const found = findActivity(activity.childActivities);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      const found = findActivity(room.activities);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

export function getGroupForActivityId(
  competition: Competition,
  activityId: number,
): Group | null {
  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const parentActivity of room.activities) {
        if (parentActivity.childActivities) {
          for (const childActivity of parentActivity.childActivities) {
            if (childActivity.id === activityId) {
              return childActivity as Group;
            }
          }
        }
      }
    }
  }

  return null;
}

export function getStartTime(group: Group, competition: Competition): DateTime {
  const venue = competition.schedule.venues[0];
  const timezone = venue?.timezone || 'UTC';

  return DateTime.fromISO(group.startTime).setZone(timezone);
}

export function getEndTime(group: Group, competition: Competition): DateTime {
  const venue = competition.schedule.venues[0];
  const timezone = venue?.timezone || 'UTC';

  return DateTime.fromISO(group.endTime).setZone(timezone);
}

export function getAllActivitiesForRoundId(
  competition: Competition,
  roundId: string,
): Activity[] {
  const { eventId, roundNumber } = parseActivityCode(roundId) ?? {};
  if (!eventId || roundNumber === null) return [];

  const activities: Activity[] = [];

  const findActivities = (acts: Activity[]) => {
    for (const activity of acts) {
      const parsed = parseActivityCode(activity.activityCode ?? '');
      if (
        parsed &&
        parsed.eventId === eventId &&
        parsed.roundNumber === roundNumber
      ) {
        activities.push(activity);
      }
      if (activity.childActivities && activity.childActivities.length > 0) {
        findActivities(activity.childActivities);
      }
    }
  };

  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      findActivities(room.activities);
    }
  }

  return activities;
}

export function getMiscActivityForId(
  competition: Competition,
  activityId: number,
): Activity | null {
  for (const venue of competition.schedule.venues) {
    for (const room of venue.rooms) {
      for (const activity of room.activities) {
        if (activity.id === activityId && !activity.childActivities?.length) {
          return activity;
        }
      }
    }
  }

  return null;
}

export function deduplicateGroups(groups: Group[]): Group[] {
  const uniqueByNumber = new Map<number, Group>();

  for (const group of groups) {
    const match = group.activityCode.match(/g(\d+)/);

    if (!match) {
      continue;
    }

    const groupNum = parseInt(match[1] ?? '0', 10);

    if (groupNum > 0 && !uniqueByNumber.has(groupNum)) {
      uniqueByNumber.set(groupNum, group);
    }
  }

  return [...uniqueByNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([_, group]) => group);
}

export function getGroupNumber(group: Group): number | null {
  const match = group.activityCode.match(/g(\d+)/);

  return match?.[1] ? parseInt(match[1], 10) : null;
}

export function assignedGroup(
  person: Person,
  round: Round,
  competition: Competition,
): Group | null {
  const roundParsed = parseActivityCode(round.id);

  if (!roundParsed) return null;

  for (const assignment of person.assignments || []) {
    if (assignment.assignmentCode !== 'competitor') continue;

    const group = getGroupForActivityId(competition, assignment.activityId);
    if (!group) continue;

    const groupParsed = parseActivityCode(group.activityCode);
    if (!groupParsed) continue;

    if (
      groupParsed.eventId === roundParsed.eventId &&
      groupParsed.roundNumber === roundParsed.roundNumber
    ) {
      return group;
    }
  }

  return null;
}

export function assignedGroups(
  person: Person,
  competition: Competition,
): Group[] {
  const activityIds = (person.assignments || [])
    .filter((assignment) => assignment.assignmentCode === 'competitor')
    .map((assignment) => assignment.activityId);

  return getAllGroups(competition).filter((group) =>
    activityIds.includes(group.id),
  );
}

export function assignmentAtTime(
  person: Person,
  time: DateTime,
  competition: Competition,
): Assignment | null {
  const venue = competition.schedule.venues[0];
  const timezone = venue?.timezone || 'UTC';
  const targetTime = time.setZone(timezone);

  for (const assignment of person.assignments || []) {
    const activity = getActivityById(competition, assignment.activityId);
    if (!activity || !activity.startTime || !activity.endTime) continue;

    const activityStart = DateTime.fromISO(activity.startTime).setZone(
      timezone,
    );
    const activityEnd = DateTime.fromISO(activity.endTime).setZone(timezone);

    if (targetTime >= activityStart && targetTime < activityEnd) {
      return assignment;
    }
  }

  return null;
}

export function overlaps(
  group: Group,
  startTime: DateTime,
  endTime: DateTime,
  competition: Competition,
): boolean {
  const groupStart = getStartTime(group, competition);
  const groupEnd = getEndTime(group, competition);

  return groupEnd > startTime && endTime > groupStart;
}
