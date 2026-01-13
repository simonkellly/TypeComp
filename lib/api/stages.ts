import { getStringProperty } from '../functions/extensions';
import { getRoomByActivity } from '../functions/groups-helpers';
import type { Group, Person } from '../types/core';
import type { Competition, Room } from '../types/wcif';
import type { GroupFilter, PersonFilter } from './filters';

export interface StageConfig {
  name: string;

  room: string;

  isFinals?: boolean;

  isMain?: boolean;
}

export const COMMON_STAGE_LAYOUTS = {
  single: (roomName: string): StageConfig[] => [
    { name: roomName, room: roomName, isFinals: true, isMain: true },
  ],

  twoStage: (mainRoom: string, sideRoom: string): StageConfig[] => [
    { name: mainRoom, room: mainRoom, isFinals: true, isMain: true },
    { name: sideRoom, room: sideRoom, isFinals: false, isMain: false },
  ],

  nationals: (mainHall: string, sideHall: string): StageConfig[] => [
    { name: 'Main Red', room: mainHall, isFinals: true, isMain: true },
    { name: 'Main Blue', room: mainHall, isFinals: true, isMain: true },
    { name: 'Main Green', room: mainHall, isFinals: false, isMain: true },
    { name: 'Main Orange', room: mainHall, isFinals: false, isMain: true },
    { name: 'Main Yellow', room: mainHall, isFinals: false, isMain: true },
    { name: 'Main White', room: mainHall, isFinals: false, isMain: true },
    { name: 'Side Red', room: sideHall, isFinals: false, isMain: false },
    { name: 'Side Blue', room: sideHall, isFinals: false, isMain: false },
    { name: 'Side Green', room: sideHall, isFinals: false, isMain: false },
    { name: 'Side Orange', room: sideHall, isFinals: false, isMain: false },
  ],
};

export class StageManager {
  private stagesByName: Map<string, StageConfig>;
  private stagesByRoom: Map<string, StageConfig[]>;
  private allStages: StageConfig[];

  constructor(
    stages: StageConfig[],
    private competition?: Competition,
  ) {
    this.allStages = stages;
    this.stagesByName = new Map();
    this.stagesByRoom = new Map();

    for (const stage of stages) {
      this.stagesByName.set(stage.name, stage);

      const roomStages = this.stagesByRoom.get(stage.room) || [];
      roomStages.push(stage);
      this.stagesByRoom.set(stage.room, roomStages);
    }
  }

  all(): StageConfig[] {
    return [...this.allStages];
  }

  names(): string[] {
    return this.allStages.map((s) => s.name);
  }

  get(name: string): StageConfig | undefined {
    return this.stagesByName.get(name);
  }

  finalsStages(): StageConfig[] {
    return this.allStages.filter((s) => s.isFinals);
  }

  mainStages(): StageConfig[] {
    return this.allStages.filter((s) => s.isMain);
  }

  sideStages(): StageConfig[] {
    return this.allStages.filter((s) => !s.isMain);
  }

  nonFinalsStages(): StageConfig[] {
    return this.allStages.filter((s) => !s.isFinals);
  }

  inRoom(roomName: string): StageConfig[] {
    return this.stagesByRoom.get(roomName) || [];
  }

  finals(): GroupFilter {
    const finalsNames = new Set(this.finalsStages().map((s) => s.name));
    return (group) => {
      const stageName = this.getStageForGroup(group);
      return stageName !== null && finalsNames.has(stageName);
    };
  }

  main(): GroupFilter {
    const mainNames = new Set(this.mainStages().map((s) => s.name));
    return (group) => {
      const stageName = this.getStageForGroup(group);
      return stageName !== null && mainNames.has(stageName);
    };
  }

  side(): GroupFilter {
    const sideNames = new Set(this.sideStages().map((s) => s.name));
    return (group) => {
      const stageName = this.getStageForGroup(group);
      return stageName !== null && sideNames.has(stageName);
    };
  }

  byName(stageName: string): GroupFilter {
    return (group) => {
      const groupStage = this.getStageForGroup(group);
      return groupStage === stageName;
    };
  }

  byNames(...stageNames: string[]): GroupFilter {
    const nameSet = new Set(stageNames);
    return (group) => {
      const stageName = this.getStageForGroup(group);
      return stageName !== null && nameSet.has(stageName);
    };
  }

  byRoom(roomName: string): GroupFilter {
    const stagesInRoom = this.inRoom(roomName);
    const stageNames = new Set(stagesInRoom.map((s) => s.name));
    return (group) => {
      const stageName = this.getStageForGroup(group);
      return stageName !== null && stageNames.has(stageName);
    };
  }

  assignedTo(person: Person, date: string): string | null {
    return getStringProperty(person, `assigned-stage-${date}`);
  }

  personOnStage(stageName: string, date: string): PersonFilter {
    return (person) => this.assignedTo(person, date) === stageName;
  }

  personOnFinals(date: string): PersonFilter {
    const finalsNames = new Set(this.finalsStages().map((s) => s.name));
    return (person) => {
      const assigned = this.assignedTo(person, date);
      return assigned !== null && finalsNames.has(assigned);
    };
  }

  personOnMain(date: string): PersonFilter {
    const mainNames = new Set(this.mainStages().map((s) => s.name));
    return (person) => {
      const assigned = this.assignedTo(person, date);
      return assigned !== null && mainNames.has(assigned);
    };
  }

  personOnSide(date: string): PersonFilter {
    const sideNames = new Set(this.sideStages().map((s) => s.name));
    return (person) => {
      const assigned = this.assignedTo(person, date);
      return assigned !== null && sideNames.has(assigned);
    };
  }

  private getStageForGroup(group: Group): string | null {
    const activityName = group.name || '';
    for (const stage of this.allStages) {
      if (activityName.includes(stage.name)) {
        return stage.name;
      }
    }

    if (this.competition) {
      const room = this.findRoomForGroup(group);
      if (room) {
        const stages = this.stagesByRoom.get(room.name);
        if (stages && stages.length === 1) {
          return stages[0]?.name ?? null;
        }
      }
    }

    return null;
  }

  private findRoomForGroup(group: Group): Room | null {
    if (!this.competition) return null;
    return getRoomByActivity(this.competition, group.id);
  }
}

export function defineStages(
  stages: StageConfig[],
  competition?: Competition,
): StageManager {
  return new StageManager(stages, competition);
}

export function singleStage(roomName: string): StageManager {
  return defineStages(COMMON_STAGE_LAYOUTS.single(roomName));
}

export function twoStages(mainRoom: string, sideRoom: string): StageManager {
  return defineStages(COMMON_STAGE_LAYOUTS.twoStage(mainRoom, sideRoom));
}
