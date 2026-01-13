import { getAllGroups } from '../functions/groups-helpers';
import type { Group } from '../types/core';
import type { Competition } from '../types/wcif';

export class GroupLookupCache {
  private cache: Map<number, Group> | null = null;

  constructor(private competition: Competition) {}

  private buildCache(): Map<number, Group> {
    if (this.cache) return this.cache;
    this.cache = new Map(getAllGroups(this.competition).map((g) => [g.id, g]));
    return this.cache;
  }

  get(activityId: number): Group | undefined {
    return this.buildCache().get(activityId);
  }

  getTimezone(): string {
    return this.competition.schedule.venues[0]?.timezone ?? 'UTC';
  }
}
