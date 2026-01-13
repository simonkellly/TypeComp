import { DateTime } from 'luxon';
import type { Competition } from '../types/wcif';

export function getTimezone(competition: Competition): string {
  return competition.schedule.venues[0]?.timezone ?? 'UTC';
}

export function parseTime(
  isoString: string,
  competition: Competition,
): DateTime {
  const timezone = getTimezone(competition);
  return DateTime.fromISO(isoString).setZone(timezone);
}

export function timeRangesOverlap(
  start1: DateTime,
  end1: DateTime,
  start2: DateTime,
  end2: DateTime,
): boolean {
  return start1 < end2 && start2 < end1;
}

export function getDurationMinutes(start: DateTime, end: DateTime): number {
  return end.diff(start, 'minutes').minutes;
}

export function isTimeInRange(
  time: DateTime,
  rangeStart: DateTime,
  rangeEnd: DateTime,
): boolean {
  return time >= rangeStart && time < rangeEnd;
}

export function extractDateString(dateTime: DateTime): string {
  return dateTime.toISODate() ?? '';
}

export function getDayStart(
  dateString: string,
  competition: Competition,
): DateTime {
  const timezone = getTimezone(competition);
  return DateTime.fromISO(`${dateString}T00:00:00`).setZone(timezone);
}

export function getDayEnd(
  dateString: string,
  competition: Competition,
): DateTime {
  const timezone = getTimezone(competition);
  return DateTime.fromISO(`${dateString}T23:59:59`).setZone(timezone);
}
