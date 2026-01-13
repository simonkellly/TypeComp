import { DateTime } from 'luxon';
import {
  getBaseEventForScrambling,
  getScramblingResultType,
} from '../constants';
import { PersonalBest } from '../functions/events';
import {
  getBooleanProperty,
  getNumberProperty,
  getStringProperty,
  hasPersonProperty,
} from '../functions/extensions';
import type { Group, Person } from '../types/core';
import type { Competition, RegistrantId } from '../types/wcif';
import { extractGroupNumber } from '../utils/activity-utils';

export type PersonFilter = (person: Person) => boolean;
export type GroupFilter = (group: Group) => boolean;

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
  const baseEventId = getBaseEventForScrambling(eventId);
  const resultType = getScramblingResultType(eventId);
  return hasPB(baseEventId, resultType);
}

export function fromCountry(countryIso2: string): PersonFilter {
  return (person) => person.countryIso2 === countryIso2;
}

export function fromCountries(...countries: string[]): PersonFilter {
  return or(...countries.map(fromCountry));
}

export function isForeigner(competition: Competition): PersonFilter {
  const compCountry = competition.schedule.venues[0]?.countryIso2;
  return (person) => (compCountry ? person.countryIso2 !== compCountry : false);
}

export const hasWcaId: PersonFilter = (person) =>
  person.wcaId !== null && person.wcaId !== undefined;

export const newcomer: PersonFilter = not(hasWcaId);

export function wcaId(id: string): PersonFilter {
  return (person) => person.wcaId === id;
}

export function wcaIds(...ids: string[]): PersonFilter {
  const idSet = new Set(ids);
  return (person) => person.wcaId != null && idSet.has(person.wcaId);
}

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

export function registrantId(id: RegistrantId): PersonFilter {
  return (person) => person.registrantId === id;
}

export function registrantIds(...ids: RegistrantId[]): PersonFilter {
  const idSet = new Set(ids);
  return (person) => idSet.has(person.registrantId);
}

export function nameContains(str: string): PersonFilter {
  const lower = str.toLowerCase();
  return (person) => person.name.toLowerCase().includes(lower);
}

export function nameIs(name: string): PersonFilter {
  return (person) => person.name === name;
}

export function gender(g: 'm' | 'f' | 'o'): PersonFilter {
  return (person) => person.gender === g;
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

export function ageBetween(
  min: number,
  max: number,
  competition: Competition,
): PersonFilter {
  return (person) => {
    const personAge = getAge(person, competition);
    if (personAge === null) return false;
    return personAge >= min && personAge <= max;
  };
}

export function olderThan(
  years: number,
  competition: Competition,
): PersonFilter {
  return (person) => {
    const personAge = getAge(person, competition);
    return personAge !== null && personAge > years;
  };
}

export function youngerThan(
  years: number,
  competition: Competition,
): PersonFilter {
  return (person) => {
    const personAge = getAge(person, competition);
    return personAge !== null && personAge < years;
  };
}

export function hasRole(role: string): PersonFilter {
  return (person) => (person.roles || []).includes(role);
}

export const isDelegate: PersonFilter = hasRole('delegate');
export const isOrganizer: PersonFilter = hasRole('organizer');
export const isTraineeDelegate: PersonFilter = hasRole('trainee-delegate');
export const isStaffScrambler: PersonFilter = hasRole('staff-scrambler');
export const isStaffRunner: PersonFilter = hasRole('staff-runner');
export const isStaffJudge: PersonFilter = hasRole('staff-judge');

export function hasStaffAssignments(person: Person): boolean {
  return (person.assignments ?? []).some((a) =>
    a.assignmentCode.startsWith('staff-'),
  );
}

export function staffAssignmentCountBetween(
  min: number,
  max?: number,
): PersonFilter {
  return (person) => {
    const count = (person.assignments ?? []).filter((a) =>
      a.assignmentCode.startsWith('staff-'),
    ).length;
    if (count < min) return false;
    if (max !== undefined && count > max) return false;
    return true;
  };
}

export function booleanProperty(key: string): PersonFilter {
  return (person) => getBooleanProperty(person, key);
}

export function stringProperty(key: string, value: string): PersonFilter {
  return (person) => getStringProperty(person, key) === value;
}

export function stringPropertyIn(key: string, values: string[]): PersonFilter {
  const valueSet = new Set(values);
  return (person) => {
    const propValue = getStringProperty(person, key);
    return propValue !== null && valueSet.has(propValue);
  };
}

export function numberPropertyGreaterThan(
  key: string,
  threshold: number,
): PersonFilter {
  return (person) => {
    const value = getNumberProperty(person, key);
    return value !== null && value > threshold;
  };
}

export function numberPropertyLessThan(
  key: string,
  threshold: number,
): PersonFilter {
  return (person) => {
    const value = getNumberProperty(person, key);
    return value !== null && value < threshold;
  };
}

export function numberPropertyBetween(
  key: string,
  min: number,
  max: number,
): PersonFilter {
  return (person) => {
    const value = getNumberProperty(person, key);
    return value !== null && value >= min && value <= max;
  };
}

export function numberPropertyEquals(key: string, value: number): PersonFilter {
  return (person) => getNumberProperty(person, key) === value;
}

export function hasProperty(key: string): PersonFilter {
  return (person) => hasPersonProperty(person, key);
}

export function groupNumber(num: number): GroupFilter {
  return (group) => extractGroupNumber(group.activityCode) === num;
}

export function groupNumberBetween(min: number, max: number): GroupFilter {
  return (group) => {
    const num = extractGroupNumber(group.activityCode);
    if (num === null) return false;
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

export const everyone: PersonFilter = () => true;
export const nobody: PersonFilter = () => false;
