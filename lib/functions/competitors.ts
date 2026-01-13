import type { Competition, Person } from '../types/wcif';
import { parseActivityCode } from './activity-code';
import { PersonalBest } from './events';
import { getActivityById, getWcifRound } from './groups-helpers';
import { fisherYatesShuffle, sortByArray } from './utils';

export function bestAverageAndSingle(
  person: Person,
  eventId: string,
): [number, number] {
  const single = PersonalBest(person, eventId, 'single') ?? Infinity;
  const average = PersonalBest(person, eventId, 'average') ?? Infinity;

  return ['333bf', '444bf', '555bf', '333mbf'].includes(eventId)
    ? [single, average]
    : [average, single];
}

export function acceptedPeople(competition: Competition): Person[] {
  return competition.persons.filter(
    (p) => p.registration?.status === 'accepted',
  );
}

export function competitorsForRound(
  competition: Competition,
  roundId: string,
): Person[] {
  const { eventId, roundNumber } = parseActivityCode(roundId) ?? {};
  if (!eventId) return [];

  const round = getWcifRound(competition, roundId);
  if (!round) return [];

  const competitorsInRound = round.results
    .map(({ personId }) =>
      competition.persons.find((p) => p.registrantId === personId),
    )
    .filter((p): p is Person => p !== undefined && p !== null);

  if (roundNumber === 1 || roundNumber === null) {
    const competitors =
      competitorsInRound.length > 0
        ? competitorsInRound
        : competition.persons.filter((p) => {
            if (p.registration?.status !== 'accepted') return false;
            const eventIds = p.registration?.eventIds;
            if (!Array.isArray(eventIds)) return false;
            return eventIds.some((id) => String(id) === eventId);
          });

    return sortByArray(fisherYatesShuffle(competitors), (p) => [
      ...bestAverageAndSingle(p, eventId).map((r) => -r),
      p.name,
    ]);
  }

  if (competitorsInRound.length > 0) {
    const event = competition.events.find((e) => e.id === eventId);
    const prev = event?.rounds[(roundNumber ?? 1) - 2] ?? null;

    if (!prev) return competitorsInRound;

    return sortByArray(competitorsInRound, (p) => {
      const result = prev.results.find((r) => r.personId === p.registrantId);
      return [-(result?.ranking ?? 0)];
    });
  }

  return [];
}

export function isForeigner(competition: Competition, person: Person): boolean {
  const compCountry = competition.schedule.venues[0]?.countryIso2;
  return compCountry ? person.countryIso2 !== compCountry : false;
}

export function suitabilityForEvent(person: Person, eventId: string): number {
  const hasPB = (person.personalBests ?? []).some(
    (pb) => pb.eventId === eventId,
  );
  const isRegistered =
    person.registration?.eventIds?.includes(eventId as never) ?? false;

  if (hasPB && isRegistered) return 3;
  if (hasPB) return 2;
  if (isRegistered) return 1;
  return 0;
}

export function staffAssignments(person: Person) {
  return (person.assignments ?? []).filter((a) =>
    a.assignmentCode.startsWith('staff-'),
  );
}

export function staffAssignmentsForEvent(
  competition: Competition,
  person: Person,
  eventId: string,
) {
  return staffAssignments(person).filter((a) => {
    const activity = getActivityById(competition, a.activityId);
    if (!activity?.activityCode) return false;
    const parsed = parseActivityCode(activity.activityCode);
    return parsed?.eventId === eventId;
  });
}
