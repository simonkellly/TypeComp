import type { Activity, Competition, Person } from '../types/wcif';
import { getActivityById } from './groups-helpers';

export function availableDuring(
  competition: Competition,
  activity: Activity,
  person: Person,
): boolean {
  const activityStart = new Date(activity.startTime).getTime();
  const activityEnd = new Date(activity.endTime).getTime();

  return !(person.assignments ?? []).some((a) => {
    const assigned = getActivityById(competition, a.activityId);
    if (!assigned) return false;

    const assignedStart = new Date(assigned.startTime).getTime();
    const assignedEnd = new Date(assigned.endTime).getTime();

    return assignedStart < activityEnd && activityStart < assignedEnd;
  });
}

export function availabilityRate(
  competition: Competition,
  activity: Activity,
  person: Person,
): number {
  const activityStart = new Date(activity.startTime).getTime();
  const activityEnd = new Date(activity.endTime).getTime();
  const activityDuration = activityEnd - activityStart;

  if (activityDuration <= 0) return 0;

  const busyTime = (person.assignments || []).reduce((sum, a) => {
    const assigned = getActivityById(competition, a.activityId);
    if (!assigned) return sum;

    const assignedStart = new Date(assigned.startTime).getTime();
    const assignedEnd = new Date(assigned.endTime).getTime();

    if (assignedStart >= activityEnd || assignedEnd <= activityStart) {
      return sum;
    }

    const overlapStart = Math.max(activityStart, assignedStart);
    const overlapEnd = Math.min(activityEnd, assignedEnd);
    return sum + (overlapEnd - overlapStart);
  }, 0);

  return -(busyTime / activityDuration);
}

export function competesIn15Minutes(
  competition: Competition,
  person: Person,
  time: string,
): boolean {
  const timeMs = new Date(time).getTime();
  const fifteenMinutes = 15 * 60 * 1000;

  const competingStarts = (person.assignments || [])
    .filter((a) => a.assignmentCode === 'competitor')
    .map((a) => {
      const activity = getActivityById(competition, a.activityId);
      return activity?.startTime;
    })
    .filter((t): t is string => t !== undefined && t !== null)
    .filter((t) => new Date(t).getTime() >= timeMs);

  if (competingStarts.length === 0) return false;

  const nextStart = competingStarts.reduce((a, b) => (a < b ? a : b));
  return new Date(nextStart).getTime() - timeMs <= fifteenMinutes;
}

export function presenceRate(
  competition: Competition,
  person: Person,
  time: string,
): number {
  const timeMs = new Date(time).getTime();
  const timeDay = new Date(time).getDay();

  const todayActivities = (person.assignments || [])
    .map((a) => getActivityById(competition, a.activityId))
    .filter(
      (a): a is Activity =>
        a !== null && !!a && new Date(a.startTime).getDay() === timeDay,
    );

  if (todayActivities.length === 0) return 0;

  const starts = todayActivities
    .map((a) => new Date(a.startTime).getTime())
    .sort((a, b) => a - b);
  const ends = todayActivities
    .map((a) => new Date(a.endTime).getTime())
    .sort((a, b) => a - b);

  const firstStart = starts[0];
  if (firstStart !== undefined && firstStart > timeMs) {
    return 1 + 1 / (firstStart - timeMs);
  }

  const prevEnd = ends.filter((t) => t <= timeMs).at(-1) ?? 0;
  const nextStart = starts.find((t) => t >= timeMs) ?? 0;

  if (prevEnd > 0) {
    const afterLast = timeMs - prevEnd;
    const beforeNext = nextStart - timeMs;
    const oneHour = 3600000;
    const thirtyMin = 1800000;

    if (nextStart > 0 && afterLast > oneHour && beforeNext > oneHour) return 3;
    if (nextStart === 0 && afterLast > thirtyMin) return 2;
  }

  return 4;
}

export function activitiesOverlap(a: Activity, b: Activity): boolean {
  const aStart = new Date(a.startTime).getTime();
  const aEnd = new Date(a.endTime).getTime();
  const bStart = new Date(b.startTime).getTime();
  const bEnd = new Date(b.endTime).getTime();

  return aStart < bEnd && bStart < aEnd;
}

export function activitiesIntersection(a: Activity, b: Activity): number {
  if (!activitiesOverlap(a, b)) return 0;

  const times = [a.startTime, a.endTime, b.startTime, b.endTime]
    .map((t) => new Date(t).getTime())
    .sort((x, y) => x - y);

  const startTime = times[1];
  const endTime = times[2];

  if (startTime === undefined || endTime === undefined) return 0;
  return endTime - startTime;
}

export function activityDuration(activity: Activity): number {
  return (
    new Date(activity.endTime).getTime() -
    new Date(activity.startTime).getTime()
  );
}
