import { DateTime } from 'luxon';
import { STAFF_JOBS } from '../../constants';
import type { Scorer } from '../../types/core';
import type { Competition } from '../../types/wcif';
import { allGroups } from '../filters';
import {
  byFilters,
  combineScorers,
  combineStaffScorers,
  consecutiveJobScorer,
  delegateDeprioritizer,
  differentFirstNames,
  fastestScrambler,
  followingGroupScorer,
  mismatchedStationScorer,
  preferenceScorer,
  priorAssignmentScorer,
  recentlyCompeted,
  sameCountry,
  sameJobScorer,
} from '../scorers';
import type { StaffScorer } from '../staff-scorers';
import type { StageManager } from '../stages';

export interface DefaultStaffScorersOptions {
  date?: string;
  stages?: StageManager;
  competitionStart?: string;
  eventId?: string;
  respectPreferences?: boolean;
  balanceWorkload?: boolean;
  avoidSameJob?: boolean;
  avoidBeforeCompeting?: boolean;
  deprioritizeDelegates?: boolean;
  keepStationsConsistent?: boolean;
}

export function defaultStaffScorers(
  _competition: Competition,
  options: DefaultStaffScorersOptions = {},
): StaffScorer {
  const {
    date,
    competitionStart,
    eventId,
    respectPreferences = true,
    balanceWorkload = true,
    avoidSameJob = true,
    avoidBeforeCompeting = true,
    deprioritizeDelegates = true,
    keepStationsConsistent = true,
  } = options;

  const scorers: StaffScorer[] = [];

  if (balanceWorkload && date) {
    const dayStart = DateTime.fromISO(`${date}T00:00`);
    scorers.push(priorAssignmentScorer(-5, -1, dayStart));
  }

  if (balanceWorkload && competitionStart) {
    const compStart = DateTime.fromISO(competitionStart);
    scorers.push(priorAssignmentScorer(-2, 0, compStart));
  }

  if (respectPreferences) {
    scorers.push(preferenceScorer(5, 'percent-', 15, STAFF_JOBS));
  }

  if (avoidSameJob) {
    scorers.push(sameJobScorer(60, -5, 4, STAFF_JOBS));
    scorers.push(consecutiveJobScorer(90, -3, 0, STAFF_JOBS));
    scorers.push(consecutiveJobScorer(30, -5, 0, ['scrambler']));
  }

  if (keepStationsConsistent) {
    scorers.push(mismatchedStationScorer(-10));
  }

  if (avoidBeforeCompeting) {
    scorers.push(followingGroupScorer(-50, 10));
  }

  if (eventId) {
    scorers.push(fastestScrambler(eventId));
  }

  if (deprioritizeDelegates) {
    scorers.push(delegateDeprioritizer(-1000));
  }

  return combineStaffScorers(...scorers);
}

export interface DefaultGroupScorersOptions {
  stages?: StageManager;
  date?: string;
  sameCountryWeight?: number;
  sameCountryLimit?: number;
  differentNamesWeight?: number;
}

export function enhancedGroupScorers(
  competition: Competition,
  options: DefaultGroupScorersOptions = {},
): Scorer {
  const {
    stages,
    date,
    sameCountryWeight = 4,
    sameCountryLimit = 2,
    differentNamesWeight = -5,
  } = options;

  const scorers: Scorer[] = [];

  scorers.push(sameCountry(sameCountryWeight, sameCountryLimit));
  scorers.push(sameCountry(-1));
  scorers.push(differentFirstNames(differentNamesWeight));

  const everyone = () => true;
  scorers.push(
    byFilters(
      everyone,
      (g) => {
        const match = g.activityCode.match(/g(\d+)/);
        if (!match?.[1]) return false;
        return parseInt(match[1], 10) % 2 === 1;
      },
      1,
    ),
  );
  scorers.push(
    byFilters(
      everyone,
      (g) => {
        const match = g.activityCode.match(/g(\d+)/);
        if (!match?.[1]) return false;
        return parseInt(match[1], 10) % 4 === 1;
      },
      1,
    ),
  );

  scorers.push(
    recentlyCompeted(competition, allGroups, allGroups, (minutes) =>
      Math.min((minutes - 30) / 10, 0),
    ),
  );

  if (stages && date) {
    for (const stage of stages.all()) {
      scorers.push(
        byFilters(
          stages.personOnStage(stage.name, date),
          stages.byName(stage.name),
          10,
        ),
      );
    }
  }

  return combineScorers(...scorers);
}

export function simpleGroupScorers(): Scorer {
  return combineScorers(
    sameCountry(4, 2),
    sameCountry(-1),
    differentFirstNames(-5),
  );
}

export function simpleStaffScorers(eventId?: string): StaffScorer {
  const scorers: StaffScorer[] = [
    followingGroupScorer(-50, 10),
    delegateDeprioritizer(-1000),
  ];

  if (eventId) {
    scorers.push(fastestScrambler(eventId));
  }

  return combineStaffScorers(...scorers);
}

export function defaultGroupScorers(): Scorer {
  return simpleGroupScorers();
}
