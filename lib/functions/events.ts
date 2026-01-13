import type { ExecutionContext } from '@/engine';
import type { EventId } from '../types/literals';
import type { Competition, Event, Person, Round } from '../types/wcif';

function parseWcifRoundId(
  roundId: string,
): { eventId: string; roundNumber: number } | null {
  const match = roundId.match(/^(\w+)-r(\d+)$/);
  if (!match?.[1] || !match[2]) return null;
  return {
    eventId: match[1],
    roundNumber: parseInt(match[2], 10),
  };
}

function getWcifRound(competition: Competition, roundId: string): Round | null {
  const parsed = parseWcifRoundId(roundId);
  if (!parsed) return null;
  const event = competition.events.find((e) => e.id === parsed.eventId);
  if (!event) return null;
  return event.rounds.find((r) => r.id === roundId) || null;
}

export function Events(ctx: ExecutionContext): Event[] {
  return ctx.competition.events;
}

export function Rounds(ctx: ExecutionContext): Round[] {
  return ctx.competition.events.flatMap((event) => event.rounds);
}

export function getEventId(event: Event): string {
  return event.id;
}

export function RoundId(round: Round): string {
  return round.id;
}

export function RoundForEvent(
  ctx: ExecutionContext,
  roundNumber: number,
  event: Event,
): Round | null {
  const eventObj = ctx.competition.events.find((e) => e.id === event.id);
  if (!eventObj) return null;
  return eventObj.rounds[roundNumber - 1] || null;
}

export function CompetingInEvent(event: Event, person: Person): boolean {
  return (
    person.registration?.status === 'accepted' &&
    person.registration?.eventIds.includes(event.id)
  );
}

export function CompetingInRound(
  ctx: ExecutionContext,
  round: Round,
  person: Person,
): boolean {
  const wcifRound = getWcifRound(ctx.competition, round.id);
  if (!wcifRound) return false;
  return wcifRound.results.some(
    (result) => result.personId === person.registrantId,
  );
}

export function PositionInRound(
  ctx: ExecutionContext,
  round: Round,
  person: Person,
): number | null {
  const wcifRound = getWcifRound(ctx.competition, round.id);
  if (!wcifRound) return null;
  const result = wcifRound.results.find(
    (r) => r.personId === person.registrantId,
  );
  return result?.ranking ?? null;
}

export function RegisteredEvents(
  person: Person,
  competition: Competition,
): Event[] {
  if (!person.registration || person.registration.status !== 'accepted') {
    return [];
  }

  const eventIds = person.registration.eventIds || [];
  return competition.events.filter((event) => eventIds.includes(event.id));
}

export function PersonalBest(
  person: Person,
  eventId: EventId | string,
  type: 'single' | 'average' | 'default' = 'default',
): number | null {
  const pbs = (person.personalBests || []).filter(
    (pb) => pb.eventId === eventId,
  );
  if (pbs.length === 0) return null;

  if (type === 'single') {
    const single = pbs.find((pb) => pb.type === 'single');
    return single ? single.best : null;
  } else if (type === 'average') {
    const average = pbs.find((pb) => pb.type === 'average');
    return average ? average.best : null;
  } else {
    const average = pbs.find((pb) => pb.type === 'average');
    if (average) return average.best;
    const single = pbs.find((pb) => pb.type === 'single');
    return single ? single.best : null;
  }
}

export function isDistributedEvent(eventId: string): boolean {
  return ['333fm', '333mbf'].includes(eventId);
}

export function psychSheetPosition(
  person: Person,
  eventId: EventId | string,
  type: 'single' | 'average' | 'default',
  allCompetitors: Person[],
): number | null {
  if (
    !person.registration ||
    person.registration.status !== 'accepted' ||
    !person.registration.eventIds.includes(eventId as EventId)
  ) {
    return null;
  }

  const pb = PersonalBest(person, eventId, type);
  const singlePb = PersonalBest(person, eventId, 'single');

  const aheadCount = allCompetitors.filter((otherPerson) => {
    if (
      !otherPerson.registration ||
      otherPerson.registration.status !== 'accepted' ||
      !otherPerson.registration.eventIds.includes(eventId as EventId)
    ) {
      return false;
    }

    const otherPb = PersonalBest(otherPerson, eventId, type);
    if (otherPb === null) {
      return false;
    }
    if (pb === null) {
      return true;
    }

    if (otherPb < pb) {
      return true;
    } else if (otherPb > pb) {
      return false;
    } else {
      const otherSinglePb = PersonalBest(otherPerson, eventId, 'single');
      if (singlePb === null) return true;
      if (otherSinglePb === null) return false;
      return otherSinglePb < singlePb;
    }
  }).length;

  return aheadCount + 1;
}

export function roundPosition(
  person: Person,
  round: Round,
  competition: Competition,
): number | null {
  const wcifRound = getWcifRound(competition, round.id);
  if (!wcifRound) return null;
  const result = wcifRound.results.find(
    (r) => r.personId === person.registrantId,
  );
  return result?.ranking ?? null;
}

export function previousRound(
  round: Round,
  competition: Competition,
): Round | null {
  const parsed = parseWcifRoundId(round.id);
  if (!parsed || parsed.roundNumber <= 1) return null;

  const event = competition.events.find((e) => e.id === parsed.eventId);
  if (!event) return null;

  const prevRoundNumber = parsed.roundNumber - 1;
  return event.rounds[prevRoundNumber - 1] || null;
}

export function numberInRound(round: Round, competition: Competition): number {
  const wcifRound = getWcifRound(competition, round.id);
  if (!wcifRound) return 0;

  if (wcifRound.results.length > 0) {
    return wcifRound.results.length;
  }

  const parsed = parseWcifRoundId(round.id);
  if (!parsed) return 0;

  return competition.persons.filter(
    (p) =>
      p.registration?.status === 'accepted' &&
      p.registration?.eventIds.includes(parsed.eventId as EventId),
  ).length;
}
