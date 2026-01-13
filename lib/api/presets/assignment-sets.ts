import { PersonalBest } from '../../functions/events';
import { getStringProperty } from '../../functions/extensions';
import type { RegistrantId } from '../../types/wcif';
import {
  and,
  booleanProperty,
  canScramble,
  type GroupFilter,
  not,
  type PersonFilter,
} from '../filters';
import type { StageManager } from '../stages';

export interface AssignmentSetConfig {
  name: string;
  personFilter: PersonFilter;
  groupFilter: GroupFilter;
  featured?: boolean;
}

export function topCompetitorsSet(
  eventId: string,
  topCount: number,
  groupFilter: GroupFilter,
  featured: boolean = true,
): AssignmentSetConfig {
  return {
    name: `top-${topCount}`,
    personFilter: (person) => {
      const pb = PersonalBest(person, eventId, 'average');
      return pb !== null && pb > 0;
    },
    groupFilter,
    featured,
  };
}

export function getPsychSheetPosition(
  person: {
    registrantId: RegistrantId;
    personalBests?: Array<{ eventId: string; best: number; type: string }>;
  },
  eventId: string,
  rankedPersons?: Array<{ registrantId: RegistrantId; pb: number | null }>,
): number | null {
  if (rankedPersons) {
    const idx = rankedPersons.findIndex(
      (p) => p.registrantId === person.registrantId,
    );
    return idx >= 0 ? idx + 1 : null;
  }

  const pbs = person.personalBests ?? [];
  const pb = pbs.find((p) => p.eventId === eventId && p.type === 'average');
  return pb ? 1 : null;
}

export function stageLeadsSet(
  stages: StageManager,
  date: string,
): AssignmentSetConfig[] {
  return stages.all().map((stage) => ({
    name: `stage-leads-${stage.name}`,
    personFilter: and(
      booleanProperty('stage-lead'),
      stages.personOnStage(stage.name, date),
    ),
    groupFilter: stages.byName(stage.name),
  }));
}

export function scramblersSet(
  eventId: string,
  stages: StageManager,
  date: string,
): AssignmentSetConfig[] {
  return stages.all().map((stage) => ({
    name: `scramblers-${stage.name}`,
    personFilter: and(
      canScramble(eventId),
      stages.personOnStage(stage.name, date),
    ),
    groupFilter: stages.byName(stage.name),
  }));
}

export function dataEntryAssignmentSet(
  room: string,
  stageName: string,
  date: string,
  stages?: StageManager,
): AssignmentSetConfig {
  const personFilter: PersonFilter = (person) => {
    const assignedRoom = getStringProperty(person, `assigned-room-${date}`);
    return assignedRoom === room;
  };

  const groupFilter: GroupFilter = stages
    ? stages.byName(stageName)
    : () => true;

  return {
    name: `data-entry-${stageName}`,
    personFilter,
    groupFilter,
  };
}

export function commentatorsSet(
  stageName: string,
  stages?: StageManager,
): AssignmentSetConfig {
  return {
    name: 'commentators',
    personFilter: booleanProperty('commentator'),
    groupFilter: stages ? stages.byName(stageName) : () => true,
  };
}

export function volunteersOnStageSet(
  stageName: string,
  date: string,
  stages: StageManager,
): AssignmentSetConfig {
  return {
    name: `volunteers-${stageName}`,
    personFilter: stages.personOnStage(stageName, date),
    groupFilter: stages.byName(stageName),
  };
}

export function psychSheetAssignmentSets(
  eventId: string,
  stages: StageManager,
  topCount: number,
  finalsCount: number,
  mainCount: number,
): AssignmentSetConfig[] {
  const psychSheetPosition = (
    person: {
      personalBests?: Array<{ eventId: string; best: number; type: string }>;
    },
    evtId: string,
  ): number | null => {
    const pbs = person.personalBests ?? [];
    const pb = pbs.find((p) => p.eventId === evtId && p.type === 'average');
    return pb ? pb.best : null;
  };

  return [
    {
      name: 'top',
      personFilter: (person) => {
        const pos = psychSheetPosition(person, eventId);
        return pos !== null && pos <= topCount;
      },
      groupFilter: stages.finals(),
      featured: true,
    },
    {
      name: 'finals',
      personFilter: (person) => {
        const pos = psychSheetPosition(person, eventId);
        return pos !== null && pos > topCount && pos <= finalsCount;
      },
      groupFilter: stages.finals(),
    },
    {
      name: 'main',
      personFilter: (person) => {
        const pos = psychSheetPosition(person, eventId);
        return pos !== null && pos > finalsCount && pos <= mainCount;
      },
      groupFilter: and(stages.main(), not(stages.finals())),
    },
    {
      name: 'side',
      personFilter: (person) => {
        const pos = psychSheetPosition(person, eventId);
        return pos === null || pos > mainCount;
      },
      groupFilter: stages.side(),
    },
  ];
}
