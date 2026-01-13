import { DateTime } from 'luxon';
import type { ExecutionContext } from '@/engine';
import { constructAssignmentModel } from '../functions/assign-helper';
import { PersonalBest } from '../functions/events';
import {
  deduplicateGroups,
  getAllGroups,
  getGroupsForRound,
  getWcifRound,
  maxActivityId,
} from '../functions/groups-helpers';
import { fisherYatesShuffle } from '../functions/utils';
import type {
  Group,
  Person,
  Scorer,
  StationAssignmentRule,
} from '../types/core';
import solver from '../types/lp-solver';
import type { Activity, Assignment } from '../types/wcif';
import { extractGroupNumber, parseRoundId } from '../utils/activity-utils';
import type { GroupFilter, PersonFilter } from './filters';
import { allGroups, registered } from './filters';
import {
  byFilters,
  byMatchingValue,
  combineScorers,
  differentFirstNames,
  sameCountry,
} from './scorers';

export interface GroupOptions {
  room?: string;
  from?: string;
  to?: string;
}

export interface AssignmentResult {
  assigned: number;
  groups: number;
  warnings: string[];
  roundId: string;
}

interface AssignmentSetConfig {
  name: string;
  personFilter: PersonFilter;
  groupFilter: GroupFilter;
  featured?: boolean;
}

interface StationConfig {
  enabled: boolean;
  order: 'ascending' | 'descending';
  scoreFn: (person: Person) => number;
}

export class GroupByBuilder {
  private scorers: Scorer[] = [];

  constructor(private readonly parent: RoundBuilder) {}

  sameCountry(score: number = 4, limit?: number): this {
    this.scorers.push(sameCountry(score, limit));
    return this;
  }

  differentNames(penalty: number = -5): this {
    this.scorers.push(differentFirstNames(penalty));
    return this;
  }

  matching(
    valueFn: (p: Person) => unknown,
    score: number,
    limit?: number,
  ): this {
    this.scorers.push(byMatchingValue(valueFn, score, limit));
    return this;
  }

  when(
    personFilter: PersonFilter,
    groupFilter: GroupFilter,
    score: number,
  ): this {
    this.scorers.push(byFilters(personFilter, groupFilter, score));
    return this;
  }

  custom(scorer: Scorer): this {
    this.scorers.push(scorer);
    return this;
  }

  getScorer(): Scorer | undefined {
    if (this.scorers.length === 0) return undefined;
    if (this.scorers.length === 1) return this.scorers[0];
    return combineScorers(...this.scorers);
  }

  done(): RoundBuilder {
    return this.parent;
  }
}

export class StationsBuilder {
  private config: StationConfig | null = null;

  constructor(private readonly parent: RoundBuilder) {}

  bySpeed(
    eventId: string,
    type: 'single' | 'average' = 'average',
    order: 'ascending' | 'descending' = 'ascending',
  ): this {
    this.config = {
      enabled: true,
      order,
      scoreFn: (p) => PersonalBest(p, eventId, type) ?? Infinity,
    };
    return this;
  }

  by(
    scoreFn: (p: Person) => number,
    order: 'ascending' | 'descending' = 'ascending',
  ): this {
    this.config = { enabled: true, order, scoreFn };
    return this;
  }

  none(): this {
    this.config = null;
    return this;
  }

  getRule(): StationAssignmentRule | undefined {
    if (!this.config) return undefined;
    const config = this.config;
    return {
      assignStations: true,
      order: config.order,
      scorer: {
        getScore: (person: Person) => config.scoreFn(person),
      },
    };
  }

  done(): RoundBuilder {
    return this.parent;
  }
}

export class RoundBuilder {
  private assignmentSets: AssignmentSetConfig[] = [];
  private _maxGroupSize?: number;
  private _groupBy: GroupByBuilder;
  private _stations: StationsBuilder;
  private clearExisting: boolean = true;

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly roundId: string,
  ) {
    this._groupBy = new GroupByBuilder(this);
    this._stations = new StationsBuilder(this);
  }

  createGroups(count: number, options: GroupOptions = {}): this {
    const { competition } = this.ctx;
    let { room: roomName, from: startTime, to: endTime } = options;

    const parsed = parseRoundId(this.roundId);
    if (!parsed) throw new Error(`Invalid round ID: ${this.roundId}`);

    const { eventId, roundNumber } = parsed;

    let parentActivity: Activity | undefined;
    let foundRoomName: string | undefined;

    for (const venue of competition.schedule.venues) {
      for (const r of venue.rooms) {
        if (roomName && r.name !== roomName) continue;
        const activity = r.activities.find(
          (a) => a.activityCode === this.roundId,
        );
        if (activity) {
          parentActivity = activity;
          foundRoomName = r.name;
          break;
        }
      }
      if (parentActivity) break;
    }

    roomName = roomName ?? foundRoomName;
    if (!roomName) {
      throw new Error(
        `Room not provided and round ${this.roundId} not found in schedule.`,
      );
    }

    const room = competition.schedule.venues[0]?.rooms.find(
      (r) => r.name === roomName,
    );
    if (!room) throw new Error(`Room "${roomName}" not found`);

    let nextActivityId = maxActivityId(competition);

    if (!parentActivity) {
      parentActivity = room.activities.find(
        (a) => a.activityCode === this.roundId,
      );
    }

    let start: DateTime;
    let end: DateTime;

    if (startTime) {
      start = DateTime.fromISO(
        startTime.includes('T') ? startTime : `2000-01-01T${startTime}`,
      );
    } else if (parentActivity) {
      start = DateTime.fromISO(parentActivity.startTime);
    } else {
      throw new Error(
        `Start time not provided and round ${this.roundId} not found.`,
      );
    }

    if (endTime) {
      end = DateTime.fromISO(
        endTime.includes('T') ? endTime : `2000-01-01T${endTime}`,
      );
    } else if (parentActivity) {
      end = DateTime.fromISO(parentActivity.endTime);
    } else {
      throw new Error(
        `End time not provided and round ${this.roundId} not found.`,
      );
    }

    if (!parentActivity) {
      const startISO = start.toISO();
      const endISO = end.toISO();
      if (!startISO || !endISO) {
        throw new Error(
          `Invalid start or end time for parent activity ${this.roundId}`,
        );
      }
      parentActivity = {
        id: ++nextActivityId,
        activityCode: this.roundId,
        name: `${eventId} Round ${roundNumber}`,
        startTime: startISO,
        endTime: endISO,
        childActivities: [],
        extensions: [],
      };
      room.activities.push(parentActivity);
    }

    const totalDuration = end.diff(start, 'minutes').minutes;
    const groupDuration = totalDuration / count;
    let currentStart = start;

    type ChildActivity = NonNullable<Activity['childActivities']>[number];
    const groups: ChildActivity[] = [];

    for (let i = 0; i < count; i++) {
      const groupNumber = i + 1;
      const groupStart = currentStart;
      const groupEnd = currentStart.plus({ minutes: groupDuration });
      const groupActivityCode = `${this.roundId}-g${groupNumber}`;

      const startISO = groupStart.toISO();
      const endISO = groupEnd.toISO();
      if (!startISO || !endISO) {
        throw new Error(`Invalid time for group ${groupActivityCode}`);
      }

      groups.push({
        id: ++nextActivityId,
        activityCode: groupActivityCode,
        name: `${groupActivityCode} ${roomName}`,
        startTime: startISO,
        endTime: endISO,
        childActivities: [],
        extensions: [],
      });

      currentStart = groupEnd;
    }

    parentActivity.childActivities = groups;
    console.log(`✓ Created ${count} groups for ${this.roundId} in ${roomName}`);

    return this;
  }

  competitors(
    filter: PersonFilter = registered,
    groupFilter: GroupFilter = allGroups,
    name: string = 'competitors',
  ): this {
    this.assignmentSets.push({ name, personFilter: filter, groupFilter });
    return this;
  }

  assignmentSet(
    name: string,
    personFilter: PersonFilter,
    groupFilter: GroupFilter = allGroups,
    featured: boolean = false,
  ): this {
    this.assignmentSets.push({ name, personFilter, groupFilter, featured });
    return this;
  }

  manuallyAssign(
    persons: string[] | number[] | PersonFilter,
    groupNum: number,
    stageName?: string,
  ): this {
    let personFilter: PersonFilter;

    if (typeof persons === 'function') {
      personFilter = persons;
    } else if (persons.length === 0) {
      return this;
    } else if (typeof persons[0] === 'string') {
      const wcaIdSet = new Set(persons as string[]);
      personFilter = (person) =>
        person.wcaId != null && wcaIdSet.has(person.wcaId);
    } else {
      const idSet = new Set(persons as number[]);
      personFilter = (person) => idSet.has(person.registrantId);
    }

    let groupFilter: GroupFilter = (group) =>
      extractGroupNumber(group.activityCode) === groupNum;

    if (stageName) {
      const baseFilter = groupFilter;
      groupFilter = (group) =>
        baseFilter(group) && (group.name ?? '').includes(stageName);
    }

    this.assignmentSets.unshift({
      name: `manual-group-${groupNum}${stageName ? `-${stageName}` : ''}`,
      personFilter,
      groupFilter,
      featured: false,
    });

    return this;
  }

  featured(
    persons: string[] | number[] | PersonFilter,
    groupFilter: GroupFilter = allGroups,
  ): this {
    let personFilter: PersonFilter;

    if (typeof persons === 'function') {
      personFilter = persons;
    } else if (persons.length === 0) {
      return this;
    } else if (typeof persons[0] === 'string') {
      const wcaIdSet = new Set(persons as string[]);
      personFilter = (person) =>
        person.wcaId != null && wcaIdSet.has(person.wcaId);
    } else {
      const idSet = new Set(persons as number[]);
      personFilter = (person) => idSet.has(person.registrantId);
    }

    this.assignmentSets.unshift({
      name: 'featured',
      personFilter,
      groupFilter,
      featured: true,
    });

    return this;
  }

  get groupBy(): GroupByBuilder {
    return this._groupBy;
  }

  get stations(): StationsBuilder {
    return this._stations;
  }

  maxGroupSize(size: number): this {
    this._maxGroupSize = size;
    return this;
  }

  clearExistingAssignments(clear: boolean = true): this {
    this.clearExisting = clear;
    return this;
  }

  scrambleSetCount(count: number): this {
    const round = getWcifRound(this.ctx.competition, this.roundId);
    if (!round) throw new Error(`Round ${this.roundId} not found`);
    round.scrambleSetCount = count;
    return this;
  }

  scrambleSetCountFromUniqueGroups(): this {
    const round = getWcifRound(this.ctx.competition, this.roundId);
    if (!round) throw new Error(`Round ${this.roundId} not found`);

    const groups = deduplicateGroups(
      getGroupsForRound(this.ctx.competition, this.roundId),
    );
    round.scrambleSetCount = groups.length;
    console.log(
      `✓ Set scrambleSetCount to ${groups.length} for ${this.roundId}`,
    );
    return this;
  }

  scrambleSetCountFromTimeSlots(): this {
    const round = getWcifRound(this.ctx.competition, this.roundId);
    if (!round) throw new Error(`Round ${this.roundId} not found`);

    const groups = getGroupsForRound(this.ctx.competition, this.roundId);
    const uniqueTimeframes = new Set<string>();
    for (const group of groups) {
      if (group.startTime && group.endTime) {
        uniqueTimeframes.add(`${group.startTime}+${group.endTime}`);
      }
    }

    round.scrambleSetCount = uniqueTimeframes.size;
    console.log(
      `✓ Set scrambleSetCount to ${uniqueTimeframes.size} for ${this.roundId}`,
    );
    return this;
  }

  scrambleSetCountFromAdvancement(maxGroupSize: number = 18): this {
    const { competition } = this.ctx;
    const round = getWcifRound(competition, this.roundId);
    if (!round) throw new Error(`Round ${this.roundId} not found`);

    const parsed = parseRoundId(this.roundId);
    if (!parsed || parsed.roundNumber <= 1) {
      throw new Error(
        `Cannot calculate advancement for first round ${this.roundId}`,
      );
    }

    const event = competition.events.find((e) => e.id === parsed.eventId);
    if (!event) throw new Error(`Event ${parsed.eventId} not found`);

    const prevRound = event.rounds[parsed.roundNumber - 2];
    if (!prevRound) {
      throw new Error(`Previous round not found for ${this.roundId}`);
    }

    let prevRoundCompetitors: number;
    if (prevRound.results.length > 0) {
      prevRoundCompetitors = prevRound.results.length;
    } else {
      prevRoundCompetitors = competition.persons.filter((p) => {
        const eventIds = p.registration?.eventIds;
        if (!Array.isArray(eventIds)) return false;
        return (
          p.registration?.status === 'accepted' &&
          eventIds.some((id) => id === parsed.eventId)
        );
      }).length;
    }

    let advancingCount: number;
    const condition = round.advancementCondition;
    if (condition) {
      if (condition.type === 'ranking') {
        advancingCount = condition.level ?? 0;
      } else if (condition.type === 'percent') {
        advancingCount = Math.ceil(
          (prevRoundCompetitors * (condition.level ?? 0)) / 100,
        );
      } else {
        advancingCount = Math.ceil(prevRoundCompetitors * 0.5);
      }
    } else {
      advancingCount = Math.ceil(prevRoundCompetitors * 0.5);
    }

    const numGroups = Math.ceil(advancingCount / maxGroupSize);
    const count = Math.max(1, numGroups);

    round.scrambleSetCount = count;
    console.log(
      `✓ Set scrambleSetCount to ${count} for ${this.roundId} (${advancingCount} advancing, ${maxGroupSize} per group)`,
    );
    return this;
  }

  assign(): AssignmentResult {
    return executeAssignment(
      this.ctx,
      this.roundId,
      this.assignmentSets,
      this._groupBy.getScorer(),
      this._stations.getRule(),
      this._maxGroupSize,
      this.clearExisting,
    );
  }
}

function executeAssignment(
  ctx: ExecutionContext,
  roundId: string,
  assignmentSets: AssignmentSetConfig[],
  groupByScorer: Scorer | undefined,
  stationRule: StationAssignmentRule | undefined,
  maxGroupSize: number | undefined,
  clearExisting: boolean,
): AssignmentResult {
  const { competition } = ctx;
  const parsed = parseRoundId(roundId);

  const groupsForRound = getGroupsForRound(competition, roundId);
  const groups = fisherYatesShuffle(deduplicateGroups(groupsForRound));

  if (groups.length === 0) {
    console.warn(`⚠️  No groups found for ${roundId}`);
    return {
      assigned: 0,
      groups: 0,
      warnings: [`No groups found for ${roundId}`],
      roundId,
    };
  }

  const activityIds = groups.map((g) => g.id);
  if (clearExisting) {
    competition.persons.forEach((person) => {
      person.assignments = (person.assignments ?? []).filter(
        (a) =>
          !activityIds.includes(a.activityId) ||
          a.assignmentCode !== 'competitor',
      );
    });
  }

  if (assignmentSets.length === 0) {
    assignmentSets = [
      { name: 'competitors', personFilter: registered, groupFilter: allGroups },
    ];
  }

  const roundData = getWcifRound(competition, roundId);
  let people: Person[];

  if (!roundData || roundData.results.length === 0) {
    people = competition.persons.filter(
      (p) => p.registration?.status === 'accepted',
    );
  } else {
    const personIds = roundData.results.map((r) => r.personId);
    people = competition.persons.filter((p) =>
      personIds.includes(p.registrantId),
    );
  }

  people = fisherYatesShuffle(people);

  if (parsed) {
    people = people.sort((p1, p2) => {
      const pb1 = PersonalBest(p1, parsed.eventId, 'average');
      const pb2 = PersonalBest(p2, parsed.eventId, 'average');
      if (pb1 === null) return 1;
      if (pb2 === null) return -1;
      const diff = (pb1 ?? Infinity) - (pb2 ?? Infinity);
      if (diff === 0) {
        return Math.random() - 0.5;
      }
      return diff;
    });
  }

  const scorers: Scorer[] = groupByScorer ? [groupByScorer] : [];
  const stationRules: StationAssignmentRule[] = stationRule
    ? [stationRule]
    : [];

  const warnings: string[] = [];
  const assignmentsByPerson = new Map<
    number,
    { group: Group; set: string; stationNumber?: number }
  >();
  const assignmentsByGroup = new Map<
    number,
    { person: Person; set: string; stationNumber?: number }[]
  >();
  const conflictingActivitiesByGroup = new Map<number, number[]>();

  const allGroupsInComp = getAllGroups(competition);

  for (const group of groups) {
    assignmentsByGroup.set(group.id, []);
    const conflicts: number[] = [];
    const groupStart = DateTime.fromISO(group.startTime);
    const groupEnd = DateTime.fromISO(group.endTime);

    for (const otherGroup of allGroupsInComp) {
      const otherStart = DateTime.fromISO(otherGroup.startTime);
      const otherEnd = DateTime.fromISO(otherGroup.endTime);
      if (groupStart < otherEnd && otherStart < groupEnd) {
        conflicts.push(otherGroup.id);
      }
    }
    conflictingActivitiesByGroup.set(group.id, conflicts);
  }

  let groupSizeLimit = people.length / groups.length;
  if (maxGroupSize !== undefined) {
    groupSizeLimit = Math.min(groupSizeLimit, maxGroupSize);
  }

  for (const set of assignmentSets) {
    const eligibleGroups = fisherYatesShuffle(groups.filter(set.groupFilter));
    const eligiblePeople = people.filter(set.personFilter);

    if (eligibleGroups.length === 0) {
      warnings.push(`NO_ELIGIBLE_GROUPS for ${set.name}`);
      continue;
    }

    const queue: { person: Person; idx: number }[] = [];
    const preAssignedByPerson: { [personId: number]: number } = {};
    const preAssignedByGroup: { [groupId: number]: number } = {};
    let preAssignedTotal = 0;
    const currentByGroup: { [groupId: number]: Person[] } = {};

    eligibleGroups.forEach((group) => {
      currentByGroup[group.id] = [];
      preAssignedByGroup[group.id] = 0;
    });

    eligiblePeople.forEach((person) => {
      const existing = assignmentsByPerson.get(person.registrantId);
      if (existing?.group && existing.group.id in currentByGroup) {
        queue.push({ person, idx: queue.length });
        preAssignedByPerson[person.registrantId] = existing.group.id;
        preAssignedByGroup[existing.group.id] =
          (preAssignedByGroup[existing.group.id] ?? 0) + 1;
        preAssignedTotal++;
      } else {
        queue.push({ person, idx: queue.length });
      }
    });

    const shuffledQueue = fisherYatesShuffle(queue);
    queue.length = 0;
    queue.push(...shuffledQueue);

    let previousLength = -1;
    let iterationCount = 0;
    const maxIterations = 10000;

    while (queue.length > preAssignedTotal && iterationCount < maxIterations) {
      iterationCount++;
      const potentialInfinite = queue.length === previousLength;
      previousLength = queue.length;

      const effectiveLimit =
        maxGroupSize !== undefined
          ? Math.min(groupSizeLimit, maxGroupSize)
          : groupSizeLimit;

      const groupsToUse = eligibleGroups.filter((group) => {
        const current = currentByGroup[group.id];
        if (!current) return false;
        const currentSize =
          current.length + (preAssignedByGroup[group.id] ?? 0);
        return currentSize < effectiveLimit;
      });

      if (groupsToUse.length === 0) {
        if (maxGroupSize === undefined || groupSizeLimit < maxGroupSize) {
          groupSizeLimit++;
          if (maxGroupSize !== undefined) {
            groupSizeLimit = Math.min(groupSizeLimit, maxGroupSize);
          }
          continue;
        } else {
          warnings.push(
            `Cannot assign all people in '${set.name}': groups full at limit ${maxGroupSize}`,
          );
          break;
        }
      }

      const filteredQueue = fisherYatesShuffle(
        queue.filter((queueItem) => {
          const preAssigned =
            preAssignedByPerson[queueItem.person.registrantId];
          if (preAssigned === undefined) return true;
          const toKeep = groupsToUse.some((g) => g.id === preAssigned);
          if (!toKeep) preAssignedTotal--;
          return toKeep;
        }),
      );

      const lpGroupSizeLimit = maxGroupSize ?? groupSizeLimit;

      const model = constructAssignmentModel(
        filteredQueue,
        groupsToUse,
        scorers,
        Object.fromEntries(assignmentsByGroup),
        currentByGroup,
        preAssignedByPerson,
        Object.fromEntries(conflictingActivitiesByGroup),
        lpGroupSizeLimit,
        preAssignedByGroup,
      );

      const solution = solver.solve(model);

      if (!solution.feasible) {
        if (potentialInfinite) {
          warnings.push(
            `Assignment '${set.name}' is not feasible, breaking loop.`,
          );
          break;
        }
        continue;
      }

      const variableMap = new Map<string, number>();
      for (const [key, value] of Object.entries(solution)) {
        if (
          !['feasible', 'result', 'bounded', 'isIntegral'].includes(key) &&
          typeof value === 'number'
        ) {
          variableMap.set(key, value);
        }
      }

      const newlyAssigned: { person: Person; group: Group }[] = [];
      const indicesToErase: number[] = [];

      filteredQueue.forEach((queueItem, idx) => {
        groupsToUse.forEach((group) => {
          const key = `${queueItem.person.registrantId}-g${group.id}`;
          const value = variableMap.get(key);
          if (value !== undefined && Math.round(value) === 1) {
            newlyAssigned.push({ person: queueItem.person, group });
            indicesToErase.push(idx);
          }
        });
      });

      const remainingQueue = filteredQueue.filter(
        (_, idx) => !indicesToErase.includes(idx),
      );
      queue.length = 0;
      queue.push(...remainingQueue);

      newlyAssigned.forEach((assn) => {
        const currentGroup = currentByGroup[assn.group.id];
        if (!currentGroup) return;

        const currentSize =
          currentGroup.length + (preAssignedByGroup[assn.group.id] ?? 0);
        const hardLimit = maxGroupSize ?? Infinity;

        if (currentSize < hardLimit) {
          currentGroup.push(assn.person);
          if (preAssignedByPerson[assn.person.registrantId]) {
            delete preAssignedByPerson[assn.person.registrantId];
            preAssignedByGroup[assn.group.id] =
              (preAssignedByGroup[assn.group.id] ?? 0) - 1;
            preAssignedTotal--;
          }
        } else {
          queue.push({ person: assn.person, idx: queue.length });
        }
      });
    }

    const finalEffectiveLimit = maxGroupSize ?? groupSizeLimit;

    for (const [groupIdStr, persons] of Object.entries(currentByGroup)) {
      const groupId = Number(groupIdStr);
      const preAssignedCount = preAssignedByGroup[groupId] ?? 0;
      const maxNewAssignments = Math.max(
        0,
        finalEffectiveLimit - preAssignedCount,
      );
      const personsToAssign = persons.slice(0, maxNewAssignments);

      personsToAssign.forEach((person) => {
        const group = eligibleGroups.find((g) => g.id === groupId);
        if (group) {
          assignmentsByPerson.set(person.registrantId, {
            group,
            set: set.name,
          });
          const groupAssignments = assignmentsByGroup.get(groupId) ?? [];
          if (
            !groupAssignments.some(
              (a) => a.person.registrantId === person.registrantId,
            )
          ) {
            groupAssignments.push({ person, set: set.name });
            assignmentsByGroup.set(groupId, groupAssignments);
          }
        }
      });
    }
  }

  for (const rule of stationRules) {
    if (!rule.assignStations) continue;

    for (const group of groups) {
      const groupAssignments = assignmentsByGroup.get(group.id) ?? [];

      groupAssignments.sort((a1, a2) => {
        const score1 = rule.scorer.getScore(a1.person, group, []);
        const score2 = rule.scorer.getScore(a2.person, group, []);
        if (rule.order === 'ascending') {
          if (score1 === score2) {
            return Math.random() - 0.5;
          }
          return score1 - score2;
        }
        if (score1 === score2) {
          return Math.random() - 0.5;
        }
        return score2 - score1;
      });

      groupAssignments.forEach((assignment, idx) => {
        const personAssignment = assignmentsByPerson.get(
          assignment.person.registrantId,
        );
        if (personAssignment) personAssignment.stationNumber = idx + 1;
        assignment.stationNumber = idx + 1;
      });
    }
  }

  const groupCounts = new Map<number, number>();

  for (const [personId, assignment] of assignmentsByPerson) {
    const groupId = assignment.group.id;
    const currentCount = groupCounts.get(groupId) ?? 0;
    const effectiveLimit = maxGroupSize ?? Infinity;

    if (currentCount < effectiveLimit) {
      groupCounts.set(groupId, currentCount + 1);

      const person = competition.persons.find(
        (p) => p.registrantId === personId,
      );
      if (person) {
        const wcifAssignment: Assignment = {
          activityId: groupId,
          assignmentCode: 'competitor',
          stationNumber: assignment.stationNumber ?? null,
        };

        if (!person.assignments) person.assignments = [];
        person.assignments.push(wcifAssignment);
      }
    }
  }

  const totalAssigned = assignmentsByPerson.size;
  console.log(
    `✓ Assigned ${totalAssigned} competitors to ${groups.length} groups for ${roundId}`,
  );

  return { assigned: totalAssigned, groups: groups.length, warnings, roundId };
}
