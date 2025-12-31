import { DateTime } from 'luxon';
import { PersonalBest } from '../functions/events';
import type { Group, Person } from '../types/core';
import type { Competition } from '../types/wcif';

export type PersonFilter = (person: Person) => boolean;

export type GroupFilter = (group: Group) => boolean;

export type ContextualPersonFilter = (
  person: Person,
  competition: Competition,
) => boolean;

export function and<T>(
  ...filters: ((item: T) => boolean)[]
): (item: T) => boolean {
  return (item: T) => filters.every((f) => f(item));
}

export function or<T>(
  ...filters: ((item: T) => boolean)[]
): (item: T) => boolean {
  return (item: T) => filters.some((f) => f(item));
}

export function not<T>(filter: (item: T) => boolean): (item: T) => boolean {
  return (item: T) => !filter(item);
}

export const registered: PersonFilter = (person) =>
  person.registration?.status === 'accepted' &&
  person.registration?.isCompeting === true;

export const accepted: PersonFilter = (person) =>
  person.registration?.status === 'accepted';

export const nonCompeting: PersonFilter = (person) =>
  person.registration?.status === 'accepted' &&
  person.registration?.isCompeting === false;

export function competingIn(eventId: string): PersonFilter {
  return (person) => {
    if (person.registration?.status !== 'accepted') return false;
    const eventIds = person.registration?.eventIds;
    if (!Array.isArray(eventIds)) return false;
    return eventIds.some((id) => String(id) === eventId);
  };
}

export function competingInAny(...eventIds: string[]): PersonFilter {
  return or(...eventIds.map(competingIn));
}

export function competingInAll(...eventIds: string[]): PersonFilter {
  return and(...eventIds.map(competingIn));
}

export function notCompetingIn(eventId: string): PersonFilter {
  return not(competingIn(eventId));
}

export function notCompetingInAny(...eventIds: string[]): PersonFilter {
  return and(...eventIds.map(notCompetingIn));
}

export function hasPB(
  eventId: string,
  type: 'single' | 'average' = 'average',
): PersonFilter {
  return (person) => {
    const pb = PersonalBest(person, eventId, type);
    return pb !== null && pb > 0;
  };
}

export function pbFasterThan(
  eventId: string,
  thresholdCs: number,
  type: 'single' | 'average' = 'average',
): PersonFilter {
  return (person) => {
    const pb = PersonalBest(person, eventId, type);
    return pb !== null && pb > 0 && pb < thresholdCs;
  };
}

export function pbSlowerThan(
  eventId: string,
  thresholdCs: number,
  type: 'single' | 'average' = 'average',
): PersonFilter {
  return (person) => {
    const pb = PersonalBest(person, eventId, type);
    return pb !== null && pb > thresholdCs;
  };
}

export function canScramble(eventId: string): PersonFilter {
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

  const baseEventId = SCRAMBLE_MAP[eventId] ?? eventId;
  const resultType =
    baseEventId.includes('bf') || baseEventId.includes('mbf')
      ? 'single'
      : 'average';

  return hasPB(baseEventId, resultType as 'single' | 'average');
}

export function fromCountry(countryIso2: string): PersonFilter {
  return (person) => person.countryIso2 === countryIso2;
}

export function fromCountries(...countries: string[]): PersonFilter {
  return or(...countries.map(fromCountry));
}

export const hasWcaId: PersonFilter = (person) =>
  person.wcaId !== null && person.wcaId !== undefined;

export const newcomer: PersonFilter = not(hasWcaId);

export function wcaIdYear(year: number): PersonFilter {
  return (person) => {
    if (!person.wcaId) return false;
    const idYear = parseInt(person.wcaId.slice(0, 4), 10);
    return idYear === year;
  };
}

export function wcaIdBefore(year: number): PersonFilter {
  return (person) => {
    if (!person.wcaId) return false;
    const idYear = parseInt(person.wcaId.slice(0, 4), 10);
    return idYear < year;
  };
}

export function wcaIdAfter(year: number): PersonFilter {
  return (person) => {
    if (!person.wcaId) return false;
    const idYear = parseInt(person.wcaId.slice(0, 4), 10);
    return idYear > year;
  };
}

export function gender(g: 'm' | 'f' | 'o'): PersonFilter {
  return (person) => person.gender === g;
}

export function hasRole(role: string): PersonFilter {
  return (person) => (person.roles || []).includes(role);
}

export const isDelegate: PersonFilter = hasRole('delegate');

export const isOrganizer: PersonFilter = hasRole('organizer');

export const isTraineeDelegate: PersonFilter = hasRole('trainee-delegate');

export function wcaId(id: string): PersonFilter {
  return (person) => person.wcaId === id;
}

export function registrantId(id: number): PersonFilter {
  return (person) => person.registrantId === id;
}

export function nameContains(str: string): PersonFilter {
  const lower = str.toLowerCase();
  return (person) => person.name.toLowerCase().includes(lower);
}

export function nameIs(name: string): PersonFilter {
  return (person) => person.name === name;
}

function getAge(person: Person, competition: Competition): number | null {
  if (!person.birthdate) return null;

  const birthDate = DateTime.fromISO(person.birthdate);
  if (!birthDate.isValid) return null;

  const startDateStr = competition.schedule?.startDate;
  const startDate = startDateStr
    ? DateTime.fromISO(startDateStr)
    : DateTime.now();

  if (!startDate.isValid) return null;

  return startDate.diff(birthDate, 'years').years;
}

export function age(min: number, max?: number): ContextualPersonFilter {
  return (person, competition) => {
    const personAge = getAge(person, competition);
    if (personAge === null) return false;

    if (personAge < min) return false;
    if (max !== undefined && personAge > max) return false;

    return true;
  };
}

export function olderThan(years: number): ContextualPersonFilter {
  return (person, competition) => {
    const personAge = getAge(person, competition);
    return personAge !== null && personAge > years;
  };
}

export function youngerThan(years: number): ContextualPersonFilter {
  return (person, competition) => {
    const personAge = getAge(person, competition);
    return personAge !== null && personAge < years;
  };
}

export function groupNumber(num: number): GroupFilter {
  return (group) => {
    const match = group.activityCode.match(/g(\d+)/);
    if (!match?.[1]) return false;
    return parseInt(match[1], 10) === num;
  };
}

export function groupNumberBetween(min: number, max: number): GroupFilter {
  return (group) => {
    const match = group.activityCode.match(/g(\d+)/);
    if (!match?.[1]) return false;
    const num = parseInt(match[1], 10);
    return num >= min && num <= max;
  };
}

export function forEvent(eventId: string): GroupFilter {
  return (group) => group.activityCode.startsWith(eventId);
}

export function forRound(roundId: string): GroupFilter {
  return (group) => group.activityCode.startsWith(roundId);
}

export const allGroups: GroupFilter = () => true;

export const noGroups: GroupFilter = () => false;

export function wcaIds(...ids: string[]): PersonFilter {
  const idSet = new Set(ids);
  return (person) => person.wcaId != null && idSet.has(person.wcaId);
}

export function registrantIds(...ids: number[]): PersonFilter {
  const idSet = new Set(ids);
  return (person) => idSet.has(person.registrantId);
}

export const everyone: PersonFilter = () => true;

export const nobody: PersonFilter = () => false;
