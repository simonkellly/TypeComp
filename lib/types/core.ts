import type {
  Activity,
  Assignment,
  Event,
  Person,
  PersonalBest,
  PersonId,
  Round as WcifRound,
} from './wcif';

export type { Activity, Person, PersonId } from './wcif';

export interface Group extends Activity {
  activityCode: string;
}

export interface Round extends WcifRound {
  id: string;
}

export interface RoundWithGroups extends Round {
  eventId: string;

  roundNumber: number;
}

export interface PersonWithAssignments extends Person {
  assignments: Assignment[];
  personalBests: PersonalBest[];
}

export interface EventWithRounds extends Event {
  rounds: Round[];
}

export type AssignmentCode =
  | 'competitor'
  | 'staff-judge'
  | 'staff-scrambler'
  | 'staff-runner'
  | 'staff-dataentry'
  | 'delegate'
  | 'trainee-delegate'
  | 'organizer'
  | 'staff-other';

export interface PersonAssignment extends Omit<Assignment, 'stationNumber'> {
  activityId: number;
  assignmentCode: AssignmentCode;
  stationNumber?: number | null;
}

export interface GroupAssignmentResult {
  round: RoundWithGroups;
  assignments: Map<PersonId, PersonAssignment>;
  groups: Group[];
}

export interface StaffAssignmentResult {
  activity: Activity | null;
  assignments: Map<PersonId, PersonAssignment>;
  job: AssignmentCode;
  warnings: string[];
}

export interface Scorer {
  getScore: (person: Person, group: Group, otherPeople: Person[]) => number;
}

export type Filter = (person: Person) => boolean;

export interface StationAssignmentRule {
  assignStations: boolean;
  order: 'ascending' | 'descending';
  scorer: Scorer;
}

export interface AssignmentSet {
  name: string;
  filter: Filter;
  groupFilter: boolean | Filter | ((group: Group) => boolean);
}

export interface JobDefinition {
  name: AssignmentCode;
  count: number;
  assignStations?: boolean;
  eligibility?: Filter;
}

export type DateLiteral = string;
export type DateTimeLiteral = string;

export function isGroup(activity: Activity): activity is Group {
  return (
    typeof activity.id === 'number' &&
    typeof activity.activityCode === 'string' &&
    activity.activityCode.includes('-g')
  );
}

export function extractGroupNumber(activityCode: string): number | null {
  const match = activityCode.match(/g(\d+)/);

  if (match?.[1] === undefined) {
    return null;
  }

  return parseInt(match[1], 10);
}

export function extractRoundId(activityCode: string): string | null {
  const match = activityCode.match(/^([a-z0-9]+-r\d+)/);

  if (match?.[1] === undefined) {
    return null;
  }

  return match[1];
}

export function extractEventId(activityCode: string): string | null {
  const match = activityCode.match(/^([a-z0-9]+)-r/);

  if (match?.[1] === undefined) {
    return null;
  }

  return match[1];
}
