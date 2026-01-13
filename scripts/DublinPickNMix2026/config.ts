import type { RegistrantId } from '@wca/helpers';
import type { GroupifierOptions } from '@/lib/api';

export const COMPETITION_ID = 'DublinPickNMix2026';

export const ASSIGNMENT_OPTIONS = {
  maxGroupSize: 18,
  scramblers: 4,
  runners: 2,
  judges: 18,
  printStations: true,
  balanceStaffWorkload: true,
  deprioritizeDelegates: true,
  avoidBeforeCompeting: true,
  createGroups: true,
  competitorsSortingRule: 'balanced',
} satisfies GroupifierOptions;

export const WAVE_EXCLUSIONS: Map<RegistrantId, number[]> = new Map([
  [7, [1]], // Wojciech Szatanowski
]);
