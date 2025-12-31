import type { Scorer } from '../types/core';
import type { TypeComp } from './context';
import type { PersonFilter } from './filters';
import {
  and,
  canScramble,
  competingIn,
  groupNumber,
  not,
  registered,
} from './filters';
import { combineScorers, differentFirstNames, sameCountry } from './scorers';

export interface SmallCompetitionOptions {
  maxGroupSize?: number;

  judgesPerGroup?: number;

  scramblersPerGroup?: number;

  runnersPerGroup?: number;
}

export interface WaveCompetitionOptions {
  parallelEvents: string[];

  waveCount?: number;

  maxWaveSize?: number;

  room: string;

  startTime: string;

  endTime: string;
}

export interface StandardStaffOptions {
  judges?: number;

  scramblers?: number;

  runners?: number;

  overwrite?: boolean;
}

export function defaultGroupScorers(): Scorer {
  return combineScorers(
    sameCountry(4, 2),
    sameCountry(-1),
    differentFirstNames(-5),
  );
}

export function assignRound(
  tc: TypeComp,
  roundId: string,
  options: SmallCompetitionOptions = {},
): void {
  const {
    maxGroupSize = 20,
    judgesPerGroup = Math.ceil(maxGroupSize * 0.4),
    scramblersPerGroup = 2,
    runnersPerGroup = 2,
  } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  const round = tc
    .round(roundId)
    .competitors(competingIn(eventId))
    .maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4, 2).differentNames(-5);

  round.stations.bySpeed(eventId, 'average');

  round.assign();

  tc.staff(roundId)
    .from(registered)
    .judges(judgesPerGroup)
    .scramblers(scramblersPerGroup, canScramble(eventId))
    .runners(runnersPerGroup)
    .preferFastScramblers()
    .overwrite(true)
    .assign();
}

export function assignStaff(
  tc: TypeComp,
  roundId: string,
  options: StandardStaffOptions = {},
): void {
  const { judges = 8, scramblers = 2, runners = 2, overwrite = true } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  tc.staff(roundId)
    .from(registered)
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(overwrite)
    .assign();
}

export function assignWaveStaff(
  tc: TypeComp,
  roundId: string,
  waveNumber: number,
  staffPool: PersonFilter,
  options: StandardStaffOptions = {},
): void {
  const { judges = 6, scramblers = 2, runners = 2, overwrite = true } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  tc.staff(roundId)
    .from(staffPool)
    .groups(groupNumber(waveNumber))
    .judges(judges)
    .scramblers(scramblers, canScramble(eventId))
    .runners(runners)
    .preferFastScramblers()
    .overwrite(overwrite)
    .assign();
}

export function assignLaterRound(
  tc: TypeComp,
  roundId: string,
  options: SmallCompetitionOptions = {},
): void {
  const { maxGroupSize = 16 } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  const round = tc.round(roundId).competitors().maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4, 2).differentNames(-5);

  round.stations.bySpeed(eventId, 'average');

  round.assign();
}

export function assignBlindfolded(
  tc: TypeComp,
  roundId: string,
  options: SmallCompetitionOptions = {},
): void {
  const {
    maxGroupSize = 12,
    judgesPerGroup = Math.ceil(maxGroupSize * 0.5),
    scramblersPerGroup = 2,
    runnersPerGroup = 2,
  } = options;

  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  const round = tc
    .round(roundId)
    .competitors(competingIn(eventId))
    .maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4, 2).differentNames(-5);

  round.stations.bySpeed(eventId, 'single');

  round.assign();

  tc.staff(roundId)
    .from(and(registered, not(competingIn(eventId))))
    .judges(judgesPerGroup)
    .scramblers(scramblersPerGroup, canScramble(eventId))
    .runners(runnersPerGroup)
    .preferFastScramblers()
    .overwrite(true)
    .assign();
}

export function quickAssign(
  tc: TypeComp,
  roundId: string,
  maxGroupSize: number,
): void {
  const eventId = roundId.split('-')[0];
  if (!eventId) {
    throw new Error(`Invalid round ID: ${roundId}`);
  }

  const round = tc
    .round(roundId)
    .competitors(competingIn(eventId))
    .maxGroupSize(maxGroupSize);

  round.groupBy.sameCountry(4).differentNames(-5);
  round.stations.bySpeed(eventId, 'average');

  round.assign();
}
