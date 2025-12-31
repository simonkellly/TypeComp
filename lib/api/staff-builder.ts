import { DateTime } from 'luxon';
import type { ExecutionContext } from '@/engine';
import { parseActivityCode } from '../functions/activity-code';
import {
  getActivityById,
  getAllGroups,
  getGroupsForRoundCode,
} from '../functions/groups-helpers';
import type { StaffScorer } from '../functions/staff';
import type {
  Activity,
  Group,
  JobDefinition,
  Person,
  PersonAssignment,
} from '../types/core';
import solver from '../types/lp-solver';
import type { Assignment } from '../types/wcif';
import type { GroupFilter, PersonFilter } from './filters';
import { allGroups, registered } from './filters';
import { combineStaffScorers, fastestScrambler } from './scorers';

export interface StaffResult {
  assigned: number;

  activities: number;

  warnings: string[];

  roundId: string;
}

interface JobConfig {
  name: string;
  count: number;
  assignStations: boolean;
  eligibility?: PersonFilter;
}

export class StaffBuilder {
  private personFilter: PersonFilter = registered;
  private groupFilter: GroupFilter = allGroups;
  private jobs: JobConfig[] = [];
  private scorers: StaffScorer[] = [];
  private _overwrite: boolean = false;
  private _avoidConflicts: boolean = true;
  private unavailableFn: (
    person: Person,
  ) => ((activity: Activity) => boolean)[] = () => [];

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly roundId: string,
  ) {}

  from(filter: PersonFilter): this {
    this.personFilter = filter;
    return this;
  }

  groups(filter: GroupFilter): this {
    this.groupFilter = filter;
    return this;
  }

  judges(
    count: number,
    options?: { assignStations?: boolean; eligibility?: PersonFilter },
  ): this {
    this.jobs.push({
      name: 'staff-judge',
      count,
      assignStations: options?.assignStations ?? false,
      eligibility: options?.eligibility,
    });
    return this;
  }

  scramblers(count: number, eligibility?: PersonFilter): this {
    this.jobs.push({
      name: 'staff-scrambler',
      count,
      assignStations: false,
      eligibility,
    });
    return this;
  }

  runners(count: number): this {
    this.jobs.push({
      name: 'staff-runner',
      count,
      assignStations: false,
    });
    return this;
  }

  dataEntry(count: number): this {
    this.jobs.push({
      name: 'staff-dataentry',
      count,
      assignStations: false,
    });
    return this;
  }

  job(
    name: string,
    count: number,
    options?: { assignStations?: boolean; eligibility?: PersonFilter },
  ): this {
    if (!name.startsWith('staff-') && name !== 'competitor') {
      console.warn(
        `Warning: Job name "${name}" should start with 'staff-' for WCIF compatibility`,
      );
    }
    this.jobs.push({
      name,
      count,
      assignStations: options?.assignStations ?? false,
      eligibility: options?.eligibility,
    });
    return this;
  }

  preferFastScramblers(eventId?: string): this {
    this.scorers.push(fastestScrambler(eventId || this.roundId));
    return this;
  }

  scorer(scorer: StaffScorer): this {
    this.scorers.push(scorer);
    return this;
  }

  overwrite(value: boolean = true): this {
    this._overwrite = value;
    return this;
  }

  avoidConflicts(value: boolean = true): this {
    this._avoidConflicts = value;
    return this;
  }

  unavailable(
    fn: (person: Person) => ((activity: Activity) => boolean)[],
  ): this {
    this.unavailableFn = fn;
    return this;
  }

  assign(): StaffResult {
    const { competition } = this.ctx;

    const allGroups = getGroupsForRoundCode(competition, this.roundId);

    if (allGroups.length === 0) {
      console.warn(`⚠️  No groups found for ${this.roundId}`);
      return {
        assigned: 0,
        activities: 0,
        warnings: [`No groups found for ${this.roundId}`],
        roundId: this.roundId,
      };
    }

    const uniqueGroupsByNumber = new Map<number, Group>();

    for (const group of allGroups) {
      const groupNum = parseInt(
        group.activityCode.match(/g(\d+)/)?.[1] || '0',
        10,
      );
      if (groupNum > 0 && !uniqueGroupsByNumber.has(groupNum)) {
        uniqueGroupsByNumber.set(groupNum, group);
      }
    }

    const groups = [...uniqueGroupsByNumber.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([_, group]) => group);

    const filteredGroups = groups.filter(this.groupFilter);

    if (filteredGroups.length === 0) {
      console.warn(`⚠️  No groups remain after filtering for ${this.roundId}`);
      return {
        assigned: 0,
        activities: 0,
        warnings: [`No groups after filtering for ${this.roundId}`],
        roundId: this.roundId,
      };
    }

    const activities = filteredGroups as Activity[];
    const activityIds = activities.map((a) => a.id);

    const persons = competition.persons.filter(this.personFilter);

    const peopleAlreadyAssigned = competition.persons.filter((person) => {
      return (person.assignments || []).some((assignment) => {
        return (
          assignment.assignmentCode !== 'competitor' &&
          activityIds.includes(assignment.activityId)
        );
      });
    });

    if (peopleAlreadyAssigned.length > 0) {
      if (this._overwrite) {
        console.log(
          `  Removing ${peopleAlreadyAssigned.length} existing staff assignments (overwrite=true)`,
        );
        peopleAlreadyAssigned.forEach((person) => {
          person.assignments = (person.assignments || []).filter(
            (assignment) => {
              return (
                assignment.assignmentCode === 'competitor' ||
                !activityIds.includes(assignment.activityId)
              );
            },
          );
        });
      } else {
        console.warn(
          `⚠️  ${peopleAlreadyAssigned.length} people already have staff assignments. Use overwrite(true) to replace.`,
        );
        return {
          assigned: 0,
          activities: activities.length,
          warnings: [
            'Existing assignments found. Use overwrite(true) to replace.',
          ],
          roundId: this.roundId,
        };
      }
    }

    const jobDefinitions: JobDefinition[] = this.jobs.map((job) => ({
      name: job.name as PersonAssignment['assignmentCode'],
      count: job.count,
      assignStations: job.assignStations,
      eligibility: job.eligibility || (() => true),
    }));

    if (jobDefinitions.length === 0) {
      console.warn(`⚠️  No jobs defined for ${this.roundId}`);
      return {
        assigned: 0,
        activities: activities.length,
        warnings: ['No jobs defined'],
        roundId: this.roundId,
      };
    }

    const combinedScorer =
      this.scorers.length > 0 ? combineStaffScorers(...this.scorers) : null;

    const warnings: string[] = [];
    const assignmentMap = new Map<number, PersonAssignment>();
    const allGroupsInComp = getAllGroups(competition);

    const assignmentsThisCall = new Map<number, Set<number>>();

    const unavailableByPerson: Record<
      number,
      ((activity: Activity) => boolean)[]
    > = {};

    persons.forEach((person) => {
      unavailableByPerson[person.registrantId] =
        this.unavailableFn(person) || [];
    });

    for (const activity of activities) {
      const activityStart = DateTime.fromISO(activity.startTime);
      const activityEnd = DateTime.fromISO(activity.endTime);

      const conflictingGroupIds = allGroupsInComp
        .filter((otherGroup) => {
          const otherStart = DateTime.fromISO(otherGroup.startTime);
          const otherEnd = DateTime.fromISO(otherGroup.endTime);
          return activityStart < otherEnd && otherStart < activityEnd;
        })
        .map((g) => g.id);

      const getRoundIdFromActivity = (activityId: number): string | null => {
        const act = getActivityById(competition, activityId);
        if (!act) return null;
        const activityCode = act.activityCode || '';
        const parsed = parseActivityCode(activityCode);
        if (!parsed || parsed.roundNumber === null) return null;
        return `${parsed.eventId}-r${parsed.roundNumber}`;
      };

      const _currentRoundId = getRoundIdFromActivity(activity.id);

      const eligiblePeople = persons.filter((person) => {
        if (this._avoidConflicts) {
          const isCompetingInThisActivity = (person.assignments || []).some(
            (assignment) =>
              assignment.activityId === activity.id &&
              assignment.assignmentCode === 'competitor',
          );
          if (isCompetingInThisActivity) return false;

          const hasTimeConflict = (person.assignments || []).some(
            (assignment) =>
              assignment.assignmentCode !== 'competitor' &&
              conflictingGroupIds.includes(assignment.activityId) &&
              assignment.activityId !== activity.id,
          );
          if (hasTimeConflict) return false;

          const previousAssignments = assignmentsThisCall.get(
            person.registrantId,
          );
          if (previousAssignments) {
            const hasConflictThisCall = conflictingGroupIds.some(
              (conflictId) =>
                conflictId !== activity.id &&
                previousAssignments.has(conflictId),
            );
            if (hasConflictThisCall) return false;
          }
        }

        const unavailFns = unavailableByPerson[person.registrantId] || [];
        return !unavailFns.some((unavailFn) => unavailFn(activity));
      });

      const neededPeople = jobDefinitions.reduce(
        (sum, job) => sum + job.count,
        0,
      );

      if (eligiblePeople.length < neededPeople) {
        const warning = `Not enough people for ${activity.name || activity.activityCode} (needed ${neededPeople}, got ${eligiblePeople.length})`;
        warnings.push(warning);
        console.warn(`⚠️  ${warning}`);
        continue;
      }

      const variables: Record<string, Record<string, number>> = {};
      const constraints: Record<
        string,
        { min?: number; max?: number; equal?: number }
      > = {};
      const ints: Record<string, number> = {};

      jobDefinitions.forEach((job) => {
        if (job.assignStations) {
          for (let num = 0; num < job.count; num++) {
            constraints[`job-${job.name}-${num + 1}`] = { equal: 1 };
          }
        } else {
          constraints[`job-${job.name}`] = { equal: job.count };
        }
      });

      const shuffled = [...eligiblePeople].sort(() => Math.random() - 0.5);

      shuffled.forEach((person, idx) => {
        constraints[`person-${idx}`] = { min: 0, max: 1 };

        let personScore = 0;

        if (combinedScorer && !combinedScorer.caresAboutJobs) {
          personScore += combinedScorer.Score(competition, person, activity);
        }

        jobDefinitions.forEach((job) => {
          if (job.eligibility && !job.eligibility(person)) return;

          let jobScore = personScore;

          if (
            combinedScorer?.caresAboutJobs &&
            !combinedScorer.caresAboutStations
          ) {
            jobScore += combinedScorer.Score(
              competition,
              person,
              activity,
              job.name,
            );
          }

          const stations = job.assignStations
            ? Array.from({ length: job.count }, (_, i) => i)
            : [null];

          stations.forEach((stationNum) => {
            let score = jobScore;

            if (combinedScorer?.caresAboutStations && stationNum !== null) {
              score += combinedScorer.Score(
                competition,
                person,
                activity,
                job.name,
                stationNum + 1,
              );
            }

            const numStr = stationNum === null ? '' : `-${stationNum + 1}`;
            const key = `assignment-${idx}-${job.name}${numStr}`;

            variables[key] = {
              score,
              [`person-${idx}`]: 1,
              [`job-${job.name}${numStr}`]: 1,
              [key]: 1,
            };

            constraints[key] = { min: 0, max: 1 };
            ints[key] = 1;
          });
        });
      });

      const model = {
        opType: 'max' as const,
        optimize: 'score',
        constraints,
        variables,
        ints,
      };

      const solution = solver.solve(model);

      if (!solution.feasible) {
        warnings.push(
          `Failed to find a solution for ${activity.name || activity.activityCode}`,
        );
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

      const keyToJobMap = new Map<
        string,
        { job: JobDefinition; stationNumber: number | null }
      >();

      jobDefinitions.forEach((job) => {
        shuffled.forEach((_person, idx) => {
          const stations = job.assignStations
            ? Array.from({ length: job.count }, (_, i) => i)
            : [null];

          stations.forEach((stationNum) => {
            const numStr = stationNum === null ? '' : `-${stationNum + 1}`;
            const key = `assignment-${idx}-${job.name}${numStr}`;
            keyToJobMap.set(key, { job, stationNumber: stationNum });
          });
        });
      });

      variableMap.forEach((value, key) => {
        if (!key.startsWith('assignment-') || Math.round(value) !== 1) return;

        const jobInfo = keyToJobMap.get(key);
        if (!jobInfo) return;

        const { job, stationNumber } = jobInfo;
        const parts = key.split('-');
        const personIdx = parseInt(parts[1] || '0', 10);
        const person = shuffled[personIdx];

        if (!person) return;

        if (!person.assignments) {
          person.assignments = [];
        }

        const newAssignment: Assignment = {
          activityId: activity.id,
          assignmentCode: job.name,
          stationNumber: stationNumber !== null ? stationNumber + 1 : null,
        };

        person.assignments.push(newAssignment);
        assignmentMap.set(
          person.registrantId,
          newAssignment as PersonAssignment,
        );

        if (!assignmentsThisCall.has(person.registrantId)) {
          assignmentsThisCall.set(person.registrantId, new Set());
        }
        assignmentsThisCall.get(person.registrantId)?.add(activity.id);
      });
    }

    const totalAssigned = assignmentMap.size;
    console.log(
      `✓ Assigned ${totalAssigned} staff to ${activities.length} groups for ${this.roundId}`,
    );

    return {
      assigned: totalAssigned,
      activities: activities.length,
      warnings,
      roundId: this.roundId,
    };
  }
}
