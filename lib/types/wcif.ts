import type { Competition } from '@wca/helpers';

export type {
  Activity,
  Assignment,
  Competition,
  Event,
  Person,
  PersonalBest,
  Registration,
  Room,
  Round,
  Schedule,
  Venue,
} from '@wca/helpers';

export interface CompetitionContext {
  competition: Competition;
  dryRun: boolean;
}

export type ActivityCode = string;
export type EventId = string;
export type RoundId = string;
export type GroupId = string;
export type PersonId = number;
export type ActivityId = number;
