import { DateTime } from 'luxon';
import type { Competition, Person } from '../types/wcif';

export function firstName(person: Person): string {
  if (!person.name) return '';
  return person.name.split(' ')[0] || '';
}

export function lastName(person: Person): string {
  if (!person.name) return '';
  const parts = person.name.split(' ');
  if (parts.length <= 1) return '';
  const lastPart = parts[parts.length - 1];
  if (!lastPart) return '';
  if (lastPart.startsWith('(') && lastPart.endsWith(')')) {
    const secondLast = parts.length > 2 ? parts[parts.length - 2] : undefined;
    return secondLast || '';
  }
  return lastPart;
}

export function wcaLink(person: Person): string | null {
  if (!person.wcaId) return null;
  return `https://www.worldcubeassociation.org/persons/${person.wcaId}`;
}

export function wcaIdYear(person: Person): number | null {
  if (!person.wcaId) return null;
  const year = parseInt(person.wcaId.slice(0, 4), 10);
  return Number.isNaN(year) ? null : year;
}

export function age(person: Person, competition: Competition): number {
  if (!person.birthdate) return 0;

  const venue = competition.schedule.venues[0];
  const timezone = venue?.timezone || 'UTC';
  const competitionStart = venue?.rooms[0]?.activities[0]?.startTime;

  let referenceDate: DateTime;
  if (competitionStart) {
    referenceDate = DateTime.fromISO(competitionStart).setZone(timezone);
  } else {
    referenceDate = DateTime.now().setZone(timezone);
  }

  const birthDate = DateTime.fromISO(person.birthdate).setZone(timezone);
  const ageInYears = referenceDate.diff(birthDate, 'years').years;

  return Math.floor(ageInYears);
}
