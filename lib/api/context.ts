import {
  createContext as createEngineContext,
  type ExecutionContext,
  type TypeCompOptions,
} from '@/engine';
import {
  deduplicateGroups,
  getGroupsForRound,
} from '../functions/groups-helpers';
import type { Group, Person } from '../types/core';
import type { Competition, RegistrantId } from '../types/wcif';
import type { PersonFilter } from './filters';
import { registered } from './filters';
import { RoundBuilder } from './round-builder';
import { StaffBuilder } from './staff-builder';

export interface TypeComp {
  readonly competition: Competition;

  readonly id: string;

  readonly dryRun: boolean;

  readonly ctx: ExecutionContext;

  round(roundId: string): RoundBuilder;

  staff(roundId: string): StaffBuilder;

  readonly persons: PersonQuery;

  groups(roundId: string, deduplicate?: boolean): Group[];

  save(): Promise<void>;

  commit(): Promise<void>;
}

export interface PersonQuery {
  filter(predicate: PersonFilter): Person[];

  registered(): Person[];

  all(): Person[];

  byWcaId(wcaId: string): Person | undefined;

  byId(registrantId: RegistrantId): Person | undefined;

  count(predicate?: PersonFilter): number;
}

class PersonQueryImpl implements PersonQuery {
  constructor(private readonly competition: Competition) {}

  filter(predicate: PersonFilter): Person[] {
    return this.competition.persons.filter(predicate);
  }

  registered(): Person[] {
    return this.filter(registered);
  }

  all(): Person[] {
    return this.competition.persons;
  }

  byWcaId(wcaId: string): Person | undefined {
    return this.competition.persons.find((p: Person) => p.wcaId === wcaId);
  }

  byId(registrantId: RegistrantId): Person | undefined {
    return this.competition.persons.find(
      (p: Person) => p.registrantId === registrantId,
    );
  }

  count(predicate?: PersonFilter): number {
    if (!predicate) return this.competition.persons.length;
    return this.filter(predicate).length;
  }
}

class TypeCompImpl implements TypeComp {
  private readonly _persons: PersonQuery;

  constructor(public readonly ctx: ExecutionContext) {
    this._persons = new PersonQueryImpl(ctx.competition);
  }

  get competition(): Competition {
    return this.ctx.competition;
  }

  get id(): string {
    return this.ctx.competitionId;
  }

  get dryRun(): boolean {
    return this.ctx.dryRun;
  }

  get persons(): PersonQuery {
    return this._persons;
  }

  round(roundId: string): RoundBuilder {
    return new RoundBuilder(this.ctx, roundId);
  }

  staff(roundId: string): StaffBuilder {
    return new StaffBuilder(this.ctx, roundId);
  }

  groups(roundId: string, deduplicate: boolean = true): Group[] {
    const groups = getGroupsForRound(this.competition, roundId);
    return deduplicate ? deduplicateGroups(groups) : groups;
  }

  async save(): Promise<void> {
    const { saveWcif } = await import('@/engine');
    await saveWcif(this.competition, this.id, false);
    console.log(`✓ Saved WCIF locally for ${this.id}`);
  }

  async commit(): Promise<void> {
    await this.ctx.finish();
  }
}

export async function createTypeComp(
  competitionId: string,
  options?: Partial<TypeCompOptions>,
): Promise<TypeComp> {
  const ctx = await createEngineContext(competitionId, options);
  return new TypeCompImpl(ctx);
}

export function fromContext(ctx: ExecutionContext): TypeComp {
  return new TypeCompImpl(ctx);
}
