import { DateTime } from 'luxon';
import type { ExecutionContext } from '@/engine';
import { constructAssignmentModel } from '../functions/assign-helper';
import { PersonalBest } from '../functions/events';
import {
  deduplicateGroups,
  getAllGroups,
  getGroupsForRound,
  getWcifRound,
} from '../functions/groups-helpers';
import type {
  Group,
  Person,
  Scorer,
  StationAssignmentRule,
} from '../types/core';
import solver from '../types/lp-solver';
import type { Activity, Assignment } from '../types/wcif';
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
    this.config = {
      enabled: true,
      order,
      scoreFn,
    };
    return this;
  }

  none(): this {
    this.config = null;
    return this;
  }

  getRule(): StationAssignmentRule | undefined {
    const config = this.config;
    if (!config) return undefined;
    return {
      assignStations: true,
      order: config.order,
      scorer: {
        getScore: (person: Person, _group: Group, _otherPeople: Person[]) =>
          config.scoreFn(person),
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

    const parsed = this.parseRoundId();
    if (!parsed) {
      throw new Error(`Invalid round ID: ${this.roundId}`);
    }

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

    if (!roomName) {
      if (foundRoomName) {
        roomName = foundRoomName;
      } else {
        throw new Error(
          `Room not provided and round ${this.roundId} not found in schedule.`,
        );
      }
    }

    const room = competition.schedule.venues[0]?.rooms.find(
      (r) => r.name === roomName,
    );

    if (!room) {
      throw new Error(`Room "${roomName}" not found`);
    }

    let maxActivityId = 0;
    for (const venue of competition.schedule.venues) {
      for (const r of venue.rooms) {
        for (const activity of r.activities) {
          maxActivityId = Math.max(maxActivityId, activity.id);
          if (activity.childActivities) {
            for (const child of activity.childActivities) {
              maxActivityId = Math.max(maxActivityId, child.id);
            }
          }
        }
      }
    }

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
        `Start time not provided and round ${this.roundId} not found in schedule.`,
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
        `End time not provided and round ${this.roundId} not found in schedule.`,
      );
    }

    if (!parentActivity) {
      const startTime = start.toISO();
      const endTime = end.toISO();
      if (!startTime || !endTime) {
        throw new Error(
          `Invalid start or end time for parent activity ${this.roundId}`,
        );
      }

      parentActivity = {
        id: ++maxActivityId,
        activityCode: this.roundId,
        name: `${eventId} Round ${roundNumber}`,
        startTime,
        endTime,
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

      const startTime = groupStart.toISO();
      const endTime = groupEnd.toISO();
      if (!startTime || !endTime) {
        throw new Error(
          `Invalid start or end time for group ${groupActivityCode}`,
        );
      }

      groups.push({
        id: ++maxActivityId,
        activityCode: groupActivityCode,
        name: `${groupActivityCode} ${roomName}`,
        startTime,
        endTime,
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
    this.assignmentSets.push({
      name,
      personFilter: filter,
      groupFilter,
    });
    return this;
  }

  assignmentSet(
    name: string,
    personFilter: PersonFilter,
    groupFilter: GroupFilter = allGroups,
    featured: boolean = false,
  ): this {
    this.assignmentSets.push({
      name,
      personFilter,
      groupFilter,
      featured,
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

  assign(): AssignmentResult {
    const { competition } = this.ctx;

    const groupsForRound = getGroupsForRound(competition, this.roundId);
    const groups = deduplicateGroups(groupsForRound);

    if (groups.length === 0) {
      console.warn(`⚠️  No groups found for ${this.roundId}`);
      return {
        assigned: 0,
        groups: 0,
        warnings: [`No groups found for ${this.roundId}`],
        roundId: this.roundId,
      };
    }

    const activityIds = groups.map((g) => g.id);
    if (this.clearExisting) {
      competition.persons.forEach((person) => {
        person.assignments = (person.assignments || []).filter((assignment) => {
          return (
            !activityIds.includes(assignment.activityId) ||
            assignment.assignmentCode !== 'competitor'
          );
        });
      });
    }

    if (this.assignmentSets.length === 0) {
      this.competitors();
    }

    const roundData = getWcifRound(competition, this.roundId);
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

    const parsed = this.parseRoundId();
    if (parsed) {
      people = people.sort((p1, p2) => {
        const pb1 = PersonalBest(p1, parsed.eventId, 'average');
        const pb2 = PersonalBest(p2, parsed.eventId, 'average');
        if (pb1 === null) return 1;
        if (pb2 === null) return -1;
        return (pb1 || Infinity) - (pb2 || Infinity);
      });
    }

    const scorers: Scorer[] = [];
    const groupByScorer = this._groupBy.getScorer();
    if (groupByScorer) {
      scorers.push(groupByScorer);
    }

    const stationRules: StationAssignmentRule[] = [];
    const stationRule = this._stations.getRule();
    if (stationRule) {
      stationRules.push(stationRule);
    }

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
    if (this._maxGroupSize !== undefined) {
      groupSizeLimit = Math.min(groupSizeLimit, this._maxGroupSize);
    }

    for (const set of this.assignmentSets) {
      const eligibleGroups = groups.filter(set.groupFilter);
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
        const existingAssignment = assignmentsByPerson.get(person.registrantId);

        if (existingAssignment?.group) {
          const existingGroupId = existingAssignment.group.id;
          if (existingGroupId in currentByGroup) {
            queue.push({ person, idx: queue.length });
            preAssignedByPerson[person.registrantId] = existingGroupId;
            preAssignedByGroup[existingGroupId] =
              (preAssignedByGroup[existingGroupId] || 0) + 1;
            preAssignedTotal++;
          }
        } else {
          queue.push({ person, idx: queue.length });
        }
      });

      let previousLength = -1;
      let iterationCount = 0;
      const maxIterations = 10000;

      while (
        queue.length > preAssignedTotal &&
        iterationCount < maxIterations
      ) {
        iterationCount++;
        const potentialInfinite = queue.length === previousLength;
        previousLength = queue.length;

        const effectiveLimit =
          this._maxGroupSize !== undefined
            ? Math.min(groupSizeLimit, this._maxGroupSize)
            : groupSizeLimit;

        const groupsToUse = eligibleGroups.filter((group) => {
          const currentGroup = currentByGroup[group.id];
          if (!currentGroup) return false;
          const currentSize =
            currentGroup.length + (preAssignedByGroup[group.id] || 0);
          return currentSize < effectiveLimit;
        });

        if (groupsToUse.length === 0) {
          if (
            this._maxGroupSize === undefined ||
            groupSizeLimit < this._maxGroupSize
          ) {
            groupSizeLimit++;
            if (this._maxGroupSize !== undefined) {
              groupSizeLimit = Math.min(groupSizeLimit, this._maxGroupSize);
            }
            continue;
          } else {
            warnings.push(
              `Cannot assign all people in '${set.name}': groups are full at hard limit ${this._maxGroupSize}`,
            );
            break;
          }
        }

        const filteredQueue = queue.filter((queueItem) => {
          const preAssigned =
            preAssignedByPerson[queueItem.person.registrantId];
          if (preAssigned === undefined) return true;
          const toKeep = groupsToUse.some((g) => g.id === preAssigned);
          if (!toKeep) preAssignedTotal--;
          return toKeep;
        });

        const lpGroupSizeLimit =
          this._maxGroupSize !== undefined
            ? this._maxGroupSize
            : groupSizeLimit;

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
              `The group assignment '${set.name}' is not feasible, breaking to prevent infinite loop.`,
            );
            break;
          }
          continue;
        }

        const variableMap = new Map<string, number>();
        for (const [key, value] of Object.entries(solution)) {
          if (
            key !== 'feasible' &&
            key !== 'result' &&
            key !== 'bounded' &&
            key !== 'isIntegral' &&
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
            currentGroup.length + (preAssignedByGroup[assn.group.id] || 0);
          const hardLimit =
            this._maxGroupSize !== undefined ? this._maxGroupSize : Infinity;

          if (currentSize < hardLimit) {
            currentGroup.push(assn.person);
            if (preAssignedByPerson[assn.person.registrantId]) {
              delete preAssignedByPerson[assn.person.registrantId];
              preAssignedByGroup[assn.group.id] =
                (preAssignedByGroup[assn.group.id] || 0) - 1;
              preAssignedTotal--;
            }
          } else {
            queue.push({ person: assn.person, idx: queue.length });
          }
        });
      }

      const finalEffectiveLimit =
        this._maxGroupSize !== undefined ? this._maxGroupSize : groupSizeLimit;

      for (const [groupIdStr, persons] of Object.entries(currentByGroup)) {
        const groupId = Number(groupIdStr);
        const preAssignedCount = preAssignedByGroup[groupId] || 0;
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
            const groupAssignments = assignmentsByGroup.get(groupId) || [];
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
        const groupAssignments = assignmentsByGroup.get(group.id) || [];

        groupAssignments.sort((a1, a2) => {
          const score1 = rule.scorer.getScore(a1.person, group, []);
          const score2 = rule.scorer.getScore(a2.person, group, []);

          if (rule.order === 'ascending') {
            return score1 === score2
              ? a1.person.registrantId - a2.person.registrantId
              : score1 - score2;
          }
          return score1 === score2
            ? a2.person.registrantId - a1.person.registrantId
            : score2 - score1;
        });

        groupAssignments.forEach((assignment, idx) => {
          const personAssignment = assignmentsByPerson.get(
            assignment.person.registrantId,
          );
          if (personAssignment) {
            personAssignment.stationNumber = idx + 1;
          }
          assignment.stationNumber = idx + 1;
        });
      }
    }

    const groupCounts = new Map<number, number>();

    for (const [personId, assignment] of assignmentsByPerson) {
      const groupId = assignment.group.id;
      const currentCount = groupCounts.get(groupId) || 0;
      const effectiveLimit =
        this._maxGroupSize !== undefined ? this._maxGroupSize : Infinity;

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

          if (!person.assignments) {
            person.assignments = [];
          }
          person.assignments.push(wcifAssignment);
        }
      }
    }

    const totalAssigned = assignmentsByPerson.size;
    console.log(
      `✓ Assigned ${totalAssigned} competitors to ${groups.length} groups for ${this.roundId}`,
    );

    return {
      assigned: totalAssigned,
      groups: groups.length,
      warnings,
      roundId: this.roundId,
    };
  }

  private parseRoundId(): { eventId: string; roundNumber: number } | null {
    const match = this.roundId.match(/^(\w+)-r(\d+)$/);
    if (!match?.[1] || !match[2]) return null;
    return {
      eventId: match[1],
      roundNumber: parseInt(match[2], 10),
    };
  }
}
