import { DateTime } from 'luxon';
import type { Group } from '../types/core';
import type {
  Activity,
  Assignment,
  Competition,
  Person,
  Room,
  Round,
} from '../types/wcif';
import { activityCodeContains, parseActivityCode } from './activity-code';
import { getExtensionData } from './extensions';

function allRooms(competition: Competition): Room[] {
  return competition.schedule.venues.flatMap((v) => v.rooms);
}

function allActivities(competition: Competition): Activity[] {
  return allRooms(competition).flatMap((r) => r.activities);
}

function forEachActivity(
  competition: Competition,
  fn: (activity: Activity) => void,
): void {
  for (const activity of allActivities(competition)) {
    fn(activity);
  }
}

export function getAllGroups(competition: Competition): Group[] {
  return allActivities(competition).flatMap(
    (a) => (a.childActivities ?? []) as Group[],
  );
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
  return (
    allActivities(competition).find((a) => a.id === activityId) ??
    getAllGroups(competition).find((g) => g.id === activityId) ??
    null
  );
}

export function getGroupForActivityId(
  competition: Competition,
  activityId: number,
): Group | null {
  return getAllGroups(competition).find((g) => g.id === activityId) ?? null;
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
  return (
    allActivities(competition).find(
      (a) => a.id === activityId && !a.childActivities?.length,
    ) ?? null
  );
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

export function maxActivityId(competition: Competition): number {
  return Math.max(
    0,
    ...allActivities(competition).flatMap((a) => [
      a.id,
      ...(a.childActivities ?? []).map((c) => c.id),
    ]),
  );
}

export function groupActivitiesByRound(
  competition: Competition,
  roundId: string,
): Activity[] {
  const roundActivities = getAllActivitiesForRoundId(competition, roundId);

  return roundActivities.flatMap((parent) =>
    (parent.childActivities ?? []).filter((child) => {
      const parsed = parseActivityCode(child.activityCode ?? '');
      return parsed?.groupNumber !== null;
    }),
  );
}

export function getRoomByActivity(
  competition: Competition,
  activityId: number,
): Room | null {
  return (
    allRooms(competition).find((room) =>
      room.activities.some(
        (a) =>
          a.id === activityId ||
          a.childActivities?.some((c) => c.id === activityId),
      ),
    ) ?? null
  );
}

export function getStationsByActivity(
  competition: Competition,
  activityId: number,
): number | null {
  const room = getRoomByActivity(competition, activityId);
  if (!room) return null;

  const config = getExtensionData<{ stations?: number }>('RoomConfig', room);
  return config?.stations ?? null;
}

export function hasDistributedAttempts(roundId: string): boolean {
  const parsed = parseActivityCode(roundId);
  return parsed ? ['333fm', '333mbf'].includes(parsed.eventId) : false;
}

export function isRoundOpenForAssignment(round: Round): boolean {
  const parsed = parseActivityCode(round.id);
  if (!parsed) return false;

  if (parsed.roundNumber === 1 && round.results.length === 0) return true;

  if (
    round.results.length > 0 &&
    round.results.every((r) => r.attempts.length === 0)
  ) {
    return true;
  }

  return false;
}

export function hasGroupAssignments(
  competition: Competition,
  roundId: string,
): boolean {
  const groups = getGroupsForRound(competition, roundId);
  if (groups.length === 0) return false;

  const activityIds = new Set(groups.map((g) => g.id));
  return competition.persons.some((p) =>
    (p.assignments ?? []).some((a) => activityIds.has(a.activityId)),
  );
}

export function roundsMissingAssignments(
  competition: Competition,
  includeFirstRounds: boolean = false,
): Round[] {
  return competition.events
    .flatMap((e) => e.rounds)
    .filter((round) => {
      const parsed = parseActivityCode(round.id);
      if (!parsed) return false;

      if (!includeFirstRounds && parsed.roundNumber === 1) return false;

      return (
        isRoundOpenForAssignment(round) &&
        !hasGroupAssignments(competition, round.id)
      );
    });
}

export function getAllActivityIds(competition: Competition): Set<number> {
  return new Set(
    allActivities(competition).flatMap((a) => [
      a.id,
      ...(a.childActivities ?? []).map((c) => c.id),
    ]),
  );
}

export function removeOrphanAssignments(competition: Competition): number {
  const validIds = getAllActivityIds(competition);

  let removed = 0;
  for (const person of competition.persons) {
    const before = person.assignments?.length ?? 0;
    person.assignments = (person.assignments ?? []).filter((a) =>
      validIds.has(a.activityId),
    );
    removed += before - (person.assignments?.length ?? 0);
  }

  return removed;
}

export function clearAllAssignmentsAndGroups(competition: Competition): void {
  for (const person of competition.persons) {
    person.assignments = [];
  }
  forEachActivity(competition, (a) => {
    a.childActivities = [];
  });
}

export function clearEmptyGroups(
  competition: Competition,
  roundId: string,
): number {
  const groups = getGroupsForRound(competition, roundId);
  const assigned = new Set(
    competition.persons.flatMap((p) =>
      (p.assignments ?? [])
        .filter((a) => a.assignmentCode === 'competitor')
        .map((a) => a.activityId),
    ),
  );

  const emptyIds = new Set(
    groups.filter((g) => !assigned.has(g.id)).map((g) => g.id),
  );
  if (emptyIds.size === 0) return 0;

  forEachActivity(competition, (a) => {
    if (a.childActivities) {
      a.childActivities = a.childActivities.filter((c) => !emptyIds.has(c.id));
    }
  });
  removeOrphanAssignments(competition);
  return emptyIds.size;
}
