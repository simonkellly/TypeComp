import { DateTime } from 'luxon';
import type { Activity } from '../types/wcif';

export function unavailableBetween(
  start: DateTime,
  end: DateTime,
): (activity: Activity) => boolean {
  return (activity: Activity) => {
    if (!activity.startTime || !activity.endTime) return false;
    const activityStart = DateTime.fromISO(activity.startTime);
    const activityEnd = DateTime.fromISO(activity.endTime);
    return activityEnd > start && end > activityStart;
  };
}

export function duringTimes(
  times: DateTime[],
): (activity: Activity) => boolean {
  return (activity: Activity) => {
    if (!activity.startTime) return false;
    const activityStart = DateTime.fromISO(activity.startTime);
    return times.some((time) => +time === +activityStart);
  };
}

export function beforeTimes(
  times: DateTime[],
): (activity: Activity) => boolean {
  return (activity: Activity) => {
    if (!activity.endTime) return false;
    const activityEnd = DateTime.fromISO(activity.endTime);
    return times.some((time) => +time === +activityEnd);
  };
}

export function unavailableForDate(
  date: Date,
  timezone?: string,
): (activity: Activity) => boolean {
  return (activity: Activity) => {
    if (!activity.startTime) return false;
    const activityStart = DateTime.fromISO(activity.startTime);
    const targetDate = DateTime.fromJSDate(date);
    if (timezone) {
      return (
        activityStart.setZone(timezone).year ===
          targetDate.setZone(timezone).year &&
        activityStart.setZone(timezone).month ===
          targetDate.setZone(timezone).month &&
        activityStart.setZone(timezone).day === targetDate.setZone(timezone).day
      );
    }
    return (
      activityStart.year === targetDate.year &&
      activityStart.month === targetDate.month &&
      activityStart.day === targetDate.day
    );
  };
}
