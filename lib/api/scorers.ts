export type { Scorer } from '../types/core';

export {
  byFilters,
  byMatchingValue,
  combineScorers,
  differentFirstNames,
  disperseDelegates,
  recentlyCompeted,
  sameCountry,
  sameWcaIdYear,
  spreadOut,
} from './group-scorers';

export {
  balancedScramblerScorer,
  combineStaffScorers,
  conditionalScorer,
  consecutiveJobScorer,
  delegateDeprioritizer,
  fastestScrambler,
  followingGroupScorer,
  mismatchedStationScorer,
  preferenceScorer,
  priorAssignmentScorer,
  type StaffScorer,
  sameJobScorer,
  staffScorer,
} from './staff-scorers';
