import { DateTime } from 'luxon';
import { getActivityById } from '../functions/groups-helpers';
import type { Activity, Assignment, Competition, Person } from '../types/wcif';

export interface AssignmentWithPersonId extends Assignment {
  personId: number;
}

export function availabilityRate(
  competitor: Person,
  activity: Activity,
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
): number {
  const activityStart = DateTime.fromISO(activity.startTime);
  const activityEnd = DateTime.fromISO(activity.endTime);
  const activityDuration = activityEnd.diff(activityStart).as('milliseconds');

  if (activityDuration === 0) {
    return 0;
  }

  const competitorAssignments = allAssignments.filter(
    (a) => a.personId === competitor.registrantId,
  );

  let timeWhenBusy = 0;

  for (const assignment of competitorAssignments) {
    const assignedActivity = getActivityById(
      competition,
      assignment.activityId,
    );

    if (assignedActivity && activitiesOverlap(assignedActivity, activity)) {
      timeWhenBusy =
        timeWhenBusy + activitiesIntersection(assignedActivity, activity);
    }
  }

  return -(timeWhenBusy / activityDuration);
}

export function activitiesOverlap(first: Activity, second: Activity): boolean {
  const firstStart = DateTime.fromISO(first.startTime);
  const firstEnd = DateTime.fromISO(first.endTime);
  const secondStart = DateTime.fromISO(second.startTime);
  const secondEnd = DateTime.fromISO(second.endTime);

  return firstStart < secondEnd && secondStart < firstEnd;
}

export function activitiesIntersection(
  first: Activity,
  second: Activity,
): number {
  if (!activitiesOverlap(first, second)) {
    return 0;
  }

  const firstStart = DateTime.fromISO(first.startTime);
  const firstEnd = DateTime.fromISO(first.endTime);
  const secondStart = DateTime.fromISO(second.startTime);
  const secondEnd = DateTime.fromISO(second.endTime);

  const times = [firstStart, firstEnd, secondStart, secondEnd].sort(
    (a, b) => a.toMillis() - b.toMillis(),
  );

  const intersectionStart = times[1];
  const intersectionEnd = times[2];

  if (!intersectionStart || !intersectionEnd) {
    return 0;
  }

  return intersectionEnd.diff(intersectionStart).as('milliseconds');
}

export function presenceRate(
  competitor: Person,
  time: DateTime,
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
): number {
  const competitorAssignments = allAssignments.filter(
    (a) => a.personId === competitor.registrantId,
  );

  const dateStr = time.toISODate();

  if (!dateStr) {
    return 0;
  }
  const activitiesThisDay = competitorAssignments
    .map((a) => getActivityById(competition, a.activityId))
    .filter((a): a is Activity => {
      return a?.startTime?.startsWith(dateStr) ?? false;
    });

  if (activitiesThisDay.length === 0) {
    return 0;
  }

  const startTimes = activitiesThisDay
    .map((a) => DateTime.fromISO(a.startTime))
    .sort((a, b) => a.toMillis() - b.toMillis());
  const endTimes = activitiesThisDay
    .map((a) => DateTime.fromISO(a.endTime))
    .sort((a, b) => a.toMillis() - b.toMillis());

  const firstStartTime = startTimes[0];

  if (firstStartTime && firstStartTime > time) {
    const diffMs = firstStartTime.diff(time).as('milliseconds');

    return diffMs > 0 ? 1 + 1 / diffMs : 1;
  }

  const previousEndTime = endTimes
    .filter((et) => et <= time)
    .sort((a, b) => b.toMillis() - a.toMillis())[0];
  const nextStartTime = startTimes.find((st) => st >= time);

  if (previousEndTime) {
    if (nextStartTime) {
      const afterLast = time.diff(previousEndTime).as('hours');
      const beforeNext = nextStartTime.diff(time).as('hours');

      if (afterLast > 1 && beforeNext > 1) {
        return 3;
      }
    } else {
      const afterLast = time.diff(previousEndTime).as('minutes');

      if (afterLast > 30) {
        return 2;
      }
    }
  }

  return 4;
}

export function competesInMinutes(
  competitor: Person,
  activityEndTime: DateTime | string,
  minutes: number,
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
): boolean {
  const endTime =
    typeof activityEndTime === 'string'
      ? DateTime.fromISO(activityEndTime)
      : activityEndTime;

  const competitorCompetingAssignments = allAssignments.filter(
    (a) =>
      a.personId === competitor.registrantId &&
      a.assignmentCode === 'competitor',
  );

  const competingStartTimes = competitorCompetingAssignments
    .map((a) => getActivityById(competition, a.activityId))
    .filter((a): a is Activity => a !== null)
    .map((a) => DateTime.fromISO(a.startTime))
    .filter((startTime) => startTime >= endTime);

  if (competingStartTimes.length === 0) {
    return false;
  }

  const earliestCompetingStart = competingStartTimes.reduce((min, current) =>
    current < min ? current : min,
  );

  return earliestCompetingStart.diff(endTime).as('minutes') <= minutes;
}

export function assignByAvailability(
  groups: Activity[],
  competitors: Person[],
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
  options: {
    resolveConflicts?: boolean;
    sortingRule?: 'ranks' | 'balanced' | 'symmetric' | 'name-optimised';
  } = {},
): Map<number, Person[]> {
  const {
    resolveConflicts: _resolveConflicts = true,
    sortingRule: _sortingRule = 'ranks',
  } = options;
  const assignments = new Map<number, Person[]>();

  for (const group of groups) {
    assignments.set(group.id, []);
  }

  for (const competitor of competitors) {
    let bestGroup: Activity | null = null;
    let bestAvailabilityRate = -Infinity;

    for (const group of groups) {
      const rate = availabilityRate(
        competitor,
        group,
        competition,
        allAssignments,
      );

      if (rate > bestAvailabilityRate) {
        bestAvailabilityRate = rate;
        bestGroup = group;
      }
    }

    if (bestGroup) {
      const currentAssignments = assignments.get(bestGroup.id) || [];

      currentAssignments.push(competitor);
      assignments.set(bestGroup.id, currentAssignments);
    }
  }

  return assignments;
}
