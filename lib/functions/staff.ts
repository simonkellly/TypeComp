import { DateTime } from 'luxon';
import type { ExecutionContext } from '@/engine';
import type {
  Activity,
  Group,
  JobDefinition,
  Person,
  PersonAssignment,
  Round,
  StaffAssignmentResult,
  StaffScorer,
} from '../types/core';
import solver from '../types/lp-solver';
import type { RegistrantId } from '../types/wcif';
import { parseActivityCode } from './activity-code';
import {
  getActivityById,
  getAllGroups,
  getGroupsForRoundCode,
  getMiscActivityForId,
} from './groups-helpers';
import { fisherYatesShuffle } from './utils';

export type { StaffScorer } from '../types/core';

const _VALID_STAFF_ASSIGNMENT_CODES = [
  'staff-judge',
  'staff-scrambler',
  'staff-runner',
  'staff-dataentry',
  'staff-announcer',
  'staff-other',
] as const;

export function Job(
  name: string,
  count: number,
  assignStations = false,
  eligibility?: (person: Person) => boolean,
): JobDefinition {
  if (name !== 'competitor' && !name.startsWith('staff-')) {
    console.warn(
      `Warning: Job name "${name}" does not follow WCIF assignment code format. ` +
        `Expected format: 'competitor' or 'staff-{role}' (e.g., 'staff-judge', 'staff-scrambler'). ` +
        `WCIF allows custom strings, but standard codes are preferred for compatibility.`,
    );
  }

  return {
    name: name as PersonAssignment['assignmentCode'],
    count,
    assignStations,
    eligibility: eligibility || (() => true),
  };
}

function AssignImpl(
  ctx: ExecutionContext,
  activities: Activity[],
  persons: Person[],
  jobs: JobDefinition[],
  scorers: StaffScorer[],
  overwrite: boolean,
  name: string,
  avoidConflicts: boolean,
  unavailable: (person: Person) => ((activity: Activity) => boolean)[],
): StaffAssignmentResult {
  const { competition } = ctx;

  if (activities.length === 0) {
    console.warn(
      `⚠️  AssignImpl(${name}): No activities provided, cannot assign staff`,
    );

    return {
      activity: null,
      assignments: new Map(),
      job: jobs[0]?.name || 'staff-judge',
      warnings: [`No activities provided for ${name}`],
    };
  }

  const allGroups = getAllGroups(competition);
  const activityIds = activities.map((a) => a.id);

  const peopleAlreadyAssigned = competition.persons.filter((person) => {
    return (person.assignments || []).some((assignment) => {
      return (
        assignment.assignmentCode !== 'competitor' &&
        activityIds.includes(assignment.activityId)
      );
    });
  });

  if (peopleAlreadyAssigned.length > 0) {
    if (overwrite) {
      console.log(
        `  Removing ${peopleAlreadyAssigned.length} existing staff assignments (overwrite=true)`,
      );
      peopleAlreadyAssigned.forEach((person) => {
        person.assignments = (person.assignments || []).filter((assignment) => {
          return (
            assignment.assignmentCode === 'competitor' ||
            !activityIds.includes(assignment.activityId)
          );
        });
      });
    } else {
      console.warn(
        `⚠️  AssignImpl(${name}): ${peopleAlreadyAssigned.length} people already have staff assignments. Not overwriting (use overwrite=true to replace)`,
      );

      return {
        activity: activities[0] || null,
        assignments: new Map(),
        job: 'staff-judge',
        warnings: [
          'Jobs are already saved. Not overwriting unless overwrite=true is added.',
        ],
      };
    }
  }

  const warnings: string[] = [];

  const assignmentMap = new Map<RegistrantId, PersonAssignment>();
  const jobAssignments: Record<
    string,
    Record<number, { person: Person; score: number }[]>
  > = {};

  jobs.forEach((job) => {
    if (job.assignStations) {
      for (let num = 0; num < job.count; num++) {
        const jobKey = `${job.name}-${num + 1}`;

        jobAssignments[jobKey] = {};
      }
    } else {
      jobAssignments[job.name] = {};
    }
  });

  const unavailableByPerson: Record<
    RegistrantId,
    ((activity: Activity) => boolean)[]
  > = {};

  persons.forEach((person) => {
    unavailableByPerson[person.registrantId] = unavailable(person) || [];
  });

  const assignmentsThisCall = new Map<RegistrantId, Set<number>>();

  activities.forEach((activity) => {
    console.log(
      `  Processing activity: ${activity.name || activity.activityCode || activity.id}`,
    );
    const activityStart = DateTime.fromISO(activity.startTime);
    const activityEnd = DateTime.fromISO(activity.endTime);

    const conflictingGroupIds = allGroups
      .filter((otherGroup) => {
        const otherStart = DateTime.fromISO(otherGroup.startTime);
        const otherEnd = DateTime.fromISO(otherGroup.endTime);

        return activityStart < otherEnd && otherStart < activityEnd;
      })
      .map((g) => g.id);

    if (conflictingGroupIds.length > 1) {
      console.log(
        `    ${activity.name}: ${conflictingGroupIds.length} conflicting groups (including self)`,
      );
    }

    const getRoundIdFromActivity = (activityId: number): string | null => {
      const activity = getActivityById(competition, activityId);

      if (!activity) {
        return null;
      }
      const activityCode = activity.activityCode || '';
      const parsed = parseActivityCode(activityCode);

      if (!parsed || parsed.roundNumber === null) {
        return null;
      }

      return `${parsed.eventId}-r${parsed.roundNumber}`;
    };

    const currentRoundId = getRoundIdFromActivity(activity.id);

    const eligiblePeople = persons.filter((person) => {
      if (avoidConflicts) {
        const isCompetingInThisActivity = (person.assignments || []).some(
          (assignment) => {
            return (
              assignment.activityId === activity.id &&
              assignment.assignmentCode === 'competitor'
            );
          },
        );

        if (isCompetingInThisActivity) {
          return false;
        }

        const hasTimeConflict = (person.assignments || []).some(
          (assignment) => {
            return (
              assignment.assignmentCode !== 'competitor' &&
              conflictingGroupIds.includes(assignment.activityId) &&
              assignment.activityId !== activity.id
            );
          },
        );

        if (hasTimeConflict) {
          return false;
        }

        const previousAssignments = assignmentsThisCall.get(
          person.registrantId,
        );

        if (previousAssignments) {
          const hasConflictThisCall = conflictingGroupIds.some((conflictId) => {
            return (
              conflictId !== activity.id && previousAssignments.has(conflictId)
            );
          });

          if (hasConflictThisCall) {
            return false;
          }
        }

        if (currentRoundId) {
          const hasOverlappingRoundStaffAssignment = (
            person.assignments || []
          ).some((assignment) => {
            if (assignment.assignmentCode === 'competitor') {
              return false;
            }
            const existingRoundId = getRoundIdFromActivity(
              assignment.activityId,
            );

            if (
              existingRoundId === null ||
              existingRoundId === currentRoundId
            ) {
              return false;
            }

            const existingActivity = getActivityById(
              competition,
              assignment.activityId,
            );

            if (!existingActivity) {
              return false;
            }

            const existingStart = DateTime.fromISO(existingActivity.startTime);
            const existingEnd = DateTime.fromISO(existingActivity.endTime);

            return activityStart < existingEnd && existingStart < activityEnd;
          });

          if (hasOverlappingRoundStaffAssignment) {
            return false;
          }
        }
      }
      const unavailFns = unavailableByPerson[person.registrantId] || [];

      return !unavailFns.some((unavailFn) => unavailFn(activity));
    });

    if (eligiblePeople.length < persons.length) {
      const filteredOut = persons.length - eligiblePeople.length;

      let competingInThis = 0;
      let timeConflict = 0;
      let differentRound = 0;
      let unavailable = 0;

      persons.forEach((person) => {
        if (!eligiblePeople.includes(person)) {
          const isCompetingInThisActivity = (person.assignments || []).some(
            (assignment) => {
              return (
                assignment.activityId === activity.id &&
                assignment.assignmentCode === 'competitor'
              );
            },
          );

          if (isCompetingInThisActivity) {
            competingInThis++;

            return;
          }

          const hasTimeConflict = (person.assignments || []).some(
            (assignment) => {
              return (
                assignment.assignmentCode !== 'competitor' &&
                conflictingGroupIds.includes(assignment.activityId) &&
                assignment.activityId !== activity.id
              );
            },
          );

          if (hasTimeConflict) {
            timeConflict++;

            return;
          }

          if (currentRoundId) {
            const hasDifferentRoundStaffAssignment = (
              person.assignments || []
            ).some((assignment) => {
              if (assignment.assignmentCode === 'competitor') {
                return false;
              }
              const existingRoundId = getRoundIdFromActivity(
                assignment.activityId,
              );

              return (
                existingRoundId !== null && existingRoundId !== currentRoundId
              );
            });

            if (hasDifferentRoundStaffAssignment) {
              differentRound++;

              return;
            }
          }

          const unavailFns = unavailableByPerson[person.registrantId] || [];

          if (unavailFns.some((unavailFn) => unavailFn(activity))) {
            unavailable++;
          }
        }
      });

      const isSingleEvent =
        currentRoundId &&
        (currentRoundId.startsWith('333-r') ||
          currentRoundId.startsWith('333bf-r'));
      const isWave = currentRoundId?.startsWith('222-r1');

      if (isSingleEvent || isWave || activities.length <= 3) {
        console.log(
          `  ${activity.name}: ${eligiblePeople.length} eligible after filtering (${filteredOut} filtered: ${competingInThis} competing here, ${timeConflict} time conflict, ${differentRound} different round, ${unavailable} unavailable)`,
        );
      }
    }

    const neededPeople = jobs.reduce((sum, job) => sum + job.count, 0);

    if (eligiblePeople.length < neededPeople) {
      const warning = `Not enough people for activity ${activity.name} (needed ${neededPeople}, got ${eligiblePeople.length})`;

      warnings.push(warning);
      console.warn(`⚠️  ${warning}`);

      return;
    }

    const variables: Record<string, Record<string, number>> = {};
    const constraints: Record<
      string,
      { min?: number; max?: number; equal?: number }
    > = {};
    const ints: Record<string, number> = {};

    jobs.forEach((job) => {
      if (job.assignStations) {
        for (let num = 0; num < job.count; num++) {
          constraints[`job-${job.name}-${num + 1}`] = { equal: 1 };
        }
      } else {
        constraints[`job-${job.name}`] = { equal: job.count };
      }
    });

    const shuffledPeople = fisherYatesShuffle(eligiblePeople);

    shuffledPeople.forEach((person, idx) => {
      constraints[`person-${idx}`] = { min: 0, max: 1 };

      let personScore = 0;

      scorers.forEach((scorer) => {
        if (!scorer.caresAboutJobs) {
          personScore =
            personScore + scorer.score(competition, person, activity);
        }
      });

      jobs.forEach((job) => {
        if (job.eligibility && !job.eligibility(person)) {
          return;
        }

        let jobScore = personScore;

        scorers.forEach((scorer) => {
          if (scorer.caresAboutJobs && !scorer.caresAboutStations) {
            jobScore =
              jobScore + scorer.score(competition, person, activity, job.name);
          }
        });

        const stations = job.assignStations
          ? Array.from({ length: job.count }, (_, i) => i)
          : [null];

        stations.forEach((stationNum) => {
          let score = jobScore;

          scorers.forEach((scorer) => {
            if (scorer.caresAboutStations && stationNum !== null) {
              score =
                score +
                scorer.score(
                  competition,
                  person,
                  activity,
                  job.name,
                  stationNum + 1,
                );
            }
          });

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
      warnings.push(`Failed to find a solution for activity ${activity.name}`);
      jobs.forEach((job) => {
        const jobEligiblePeople = eligiblePeople
          .filter((person) => !job.eligibility || job.eligibility(person))
          .map((person) => person.name);

        warnings.push(
          `Eligible people for ${job.name}: ${jobEligiblePeople.join(', ')}`,
        );
      });

      return;
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

    jobs.forEach((job) => {
      shuffledPeople.forEach((_person, idx) => {
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
      if (!key.startsWith('assignment-') || Math.round(value) !== 1) {
        return;
      }

      const jobInfo = keyToJobMap.get(key);

      if (!jobInfo) {
        return;
      }

      const { job, stationNumber } = jobInfo;

      const parts = key.split('-');
      const personIdx = parseInt(parts[1] || '0', 10);
      const person = shuffledPeople[personIdx];

      if (!person) {
        return;
      }

      let totalScore = 0;

      scorers.forEach((scorer) => {
        totalScore =
          totalScore +
          scorer.score(
            competition,
            person,
            activity,
            job.name,
            stationNumber !== null ? stationNumber + 1 : undefined,
          );
      });

      const jobKey =
        stationNumber !== null ? `${job.name}-${stationNumber + 1}` : job.name;
      const activityId = activity?.id;

      if (activityId === undefined) {
        return;
      }

      if (!(jobKey in jobAssignments)) {
        jobAssignments[jobKey] = {};
      }

      const jobAssignment = jobAssignments[jobKey];
      if (!jobAssignment) {
        return;
      }

      if (!(activityId in jobAssignment)) {
        jobAssignment[activityId] = [];
      }

      const activityAssignments = jobAssignment[activityId];
      if (!activityAssignments) {
        return;
      }

      activityAssignments.push({
        person,
        score: totalScore,
      });

      if (!person.assignments) {
        person.assignments = [];
      }
      const newAssignment: PersonAssignment = {
        activityId: activity.id,
        assignmentCode: job.name,

        stationNumber: stationNumber !== null ? stationNumber + 1 : null,
      };

      person.assignments.push({
        activityId: newAssignment.activityId,
        assignmentCode: newAssignment.assignmentCode,
        stationNumber: newAssignment.stationNumber ?? null,
      });

      assignmentMap.set(person.registrantId, newAssignment);

      if (!assignmentsThisCall.has(person.registrantId)) {
        assignmentsThisCall.set(person.registrantId, new Set());
      }
      assignmentsThisCall.get(person.registrantId)?.add(activity.id);
    });
  });

  if (assignmentMap.size > 0) {
    console.log(
      `✓ AssignImpl(${name}): Assigned ${assignmentMap.size} staff members across ${activities.length} activities`,
    );
  } else if (activities.length > 0) {
    console.warn(
      `⚠️  AssignImpl(${name}): No staff assigned despite ${activities.length} activities and ${persons.length} candidates`,
    );
  }

  return {
    activity: activities[0] || null,
    assignments: assignmentMap,
    job: jobs[0]?.name || 'staff-judge',
    warnings,
  };
}

export function AssignStaff(
  ctx: ExecutionContext,
  round: Round,
  groupFilter: boolean | ((group: Group) => boolean),
  persons: Person[],
  jobs: JobDefinition[],
  scorers: StaffScorer[] = [],
  overwrite = false,
  avoidConflicts = true,
  unavailable: (
    person: Person,
  ) => ((activity: Activity) => boolean)[] = () => [],
): StaffAssignmentResult {
  const { competition } = ctx;
  const roundId = round.id;
  const allGroups = getGroupsForRoundCode(competition, roundId);

  if (allGroups.length === 0) {
    console.warn(`⚠️  AssignStaff(${roundId}): No groups found for round`);
  } else {
    console.log(`✓ AssignStaff(${roundId}): Found ${allGroups.length} groups`);
  }

  const uniqueGroupsByNumber = new Map<number, Group>();

  const getGroupRoom = (
    group: Group,
  ): { venueIndex: number; roomIndex: number } | null => {
    for (
      let venueIdx = 0;
      venueIdx < competition.schedule.venues.length;
      venueIdx++
    ) {
      const venue = competition.schedule.venues[venueIdx];

      if (!venue) {
        continue;
      }
      for (let roomIdx = 0; roomIdx < venue.rooms.length; roomIdx++) {
        const room = venue.rooms[roomIdx];

        if (!room) {
          continue;
        }
        for (const activity of room.activities) {
          if (activity.id === group.id) {
            return { venueIndex: venueIdx, roomIndex: roomIdx };
          }
          if (activity.childActivities) {
            for (const child of activity.childActivities) {
              if (child.id === group.id) {
                return { venueIndex: venueIdx, roomIndex: roomIdx };
              }
            }
          }
        }
      }
    }

    return null;
  };

  for (const group of allGroups) {
    const groupNum = parseInt(
      group.activityCode.match(/g(\d+)/)?.[1] || '0',
      10,
    );

    if (groupNum <= 0) {
      continue;
    }

    if (!uniqueGroupsByNumber.has(groupNum)) {
      uniqueGroupsByNumber.set(groupNum, group);
    } else {
      const existingGroup = uniqueGroupsByNumber.get(groupNum);
      if (!existingGroup) continue;
      const existingRoom = getGroupRoom(existingGroup);
      const newRoom = getGroupRoom(group);

      if (newRoom && existingRoom) {
        if (
          newRoom.venueIndex < existingRoom.venueIndex ||
          (newRoom.venueIndex === existingRoom.venueIndex &&
            newRoom.roomIndex < existingRoom.roomIndex)
        ) {
          uniqueGroupsByNumber.set(groupNum, group);
        }
      } else if (newRoom && !existingRoom) {
        uniqueGroupsByNumber.set(groupNum, group);
      }
    }
  }

  const deduplicatedGroups = [...uniqueGroupsByNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([_, group]) => group);

  if (deduplicatedGroups.length === 0) {
    console.warn(
      `⚠️  AssignStaff(${roundId}): No groups found after deduplication (${allGroups.length} total groups found)`,
    );
  } else if (deduplicatedGroups.length < allGroups.length) {
    console.log(
      `✓ AssignStaff(${roundId}): Using ${deduplicatedGroups.length} unique groups (from ${allGroups.length} total groups)`,
    );
  }

  const filteredGroups = deduplicatedGroups.filter((group) => {
    if (typeof groupFilter === 'boolean') {
      return groupFilter;
    }

    return groupFilter(group);
  });

  if (filteredGroups.length === 0) {
    console.warn(
      `⚠️  AssignStaff(${roundId}): No groups remain after filtering (${deduplicatedGroups.length} groups before filter)`,
    );
  } else if (filteredGroups.length < deduplicatedGroups.length) {
    console.log(
      `✓ AssignStaff(${roundId}): ${filteredGroups.length} groups remain after filtering (from ${deduplicatedGroups.length} groups)`,
    );
  }

  const activities = filteredGroups.map((g) => g as Activity);

  if (activities.length === 0) {
    console.warn(
      `⚠️  AssignStaff(${roundId}): No activities after conversion (${filteredGroups.length} filtered groups)`,
    );
  } else {
    console.log(
      `✓ AssignStaff(${roundId}): Converting ${filteredGroups.length} groups to ${activities.length} activities`,
    );
  }

  return AssignImpl(
    ctx,
    activities,
    persons,
    jobs,
    scorers,
    overwrite,
    roundId,
    avoidConflicts,
    unavailable,
  );
}

export function AssignMisc(
  ctx: ExecutionContext,
  activityId: number,
  persons: Person[],
  jobs: JobDefinition[],
  scorers: StaffScorer[] = [],
  overwrite = false,
  avoidConflicts = true,
): StaffAssignmentResult {
  const activity = getMiscActivityForId(ctx.competition, activityId);

  if (!activity) {
    return {
      activity: null,
      assignments: new Map(),
      job: 'staff-judge',
      warnings: ['No activity found.'],
    };
  }

  return AssignImpl(
    ctx,
    [activity],
    persons,
    jobs,
    scorers,
    overwrite,
    activity.name || `activity-${activityId}`,
    avoidConflicts,
    () => [],
  );
}
