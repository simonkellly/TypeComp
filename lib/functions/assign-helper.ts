import type { Group, Person, Scorer } from '../types/core';
import type { LPSolverModel } from '../types/lp-solver';

interface QueueItem {
  person: Person;
  idx: number;
}

interface PreAssignedByPerson {
  [personId: number]: number;
}

interface CurrentByGroup {
  [groupId: number]: Person[];
}

interface AssignmentsByGroup {
  [groupId: number]: { person: Person; set: string }[];
}

export function constructAssignmentModel(
  queue: QueueItem[],
  groupsToUse: Group[],
  scorers: Scorer[],
  assignmentsByGroup: AssignmentsByGroup,
  currentByGroup: CurrentByGroup,
  preAssignedByPerson: PreAssignedByPerson,
  conflictingActivitiesByGroup: { [groupId: number]: number[] },
  groupSizeLimit?: number,
  preAssignedByGroup?: { [groupId: number]: number },
): LPSolverModel {
  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<
    string,
    { min?: number; max?: number; equal?: number }
  > = {};
  const ints: Record<string, number> = {};

  queue.slice(0, 100).forEach((queueItem) => {
    const personKey = queueItem.person.registrantId.toString();

    constraints[personKey] = { min: 0, max: 1 };

    const scores: { [groupId: number]: number } = {};
    let total = 0;

    groupsToUse.forEach((group) => {
      const groupId = group.id;

      if (
        preAssignedByPerson[queueItem.person.registrantId] &&
        preAssignedByPerson[queueItem.person.registrantId] !== groupId
      ) {
        return;
      }

      const hasConflict = (queueItem.person.assignments || []).some(
        (assignment) => {
          if (assignment.assignmentCode !== 'competitor') {
            return false;
          }

          return conflictingActivitiesByGroup[groupId]?.includes(
            assignment.activityId,
          );
        },
      );

      if (hasConflict) {
        return;
      }

      let newScore = 0;
      const otherPeopleInGroup = [
        ...(assignmentsByGroup[groupId]?.map((a) => a.person) || []),
        ...(currentByGroup[groupId] || []),
      ];

      scorers.forEach((scorer) => {
        newScore =
          newScore +
          scorer.getScore(queueItem.person, group, otherPeopleInGroup);
      });

      total = total + newScore;
      scores[groupId] = newScore;
    });

    groupsToUse.forEach((group) => {
      const groupId = group.id;

      if (!(groupId in scores)) {
        return;
      }

      const score = scores[groupId];

      if (score === undefined) {
        return;
      }
      const adjustedScore = score - total / groupsToUse.length - queueItem.idx;
      const groupKey = `g${groupId}`;
      const key = `${personKey}-${groupKey}`;

      variables[key] = {
        score: adjustedScore,
        totalAssigned: 1,
        [personKey]: 1,
        [groupKey]: 1,
        [key]: 1,
      };

      constraints[key] = { min: 0, max: 1 };
      ints[key] = 1;
    });
  });

  groupsToUse.forEach((group) => {
    const groupId = group.id;
    const groupKey = `g${groupId}`;

    if (groupSizeLimit !== undefined) {
      const currentSize =
        (currentByGroup[groupId]?.length || 0) +
        (preAssignedByGroup?.[groupId] || 0);
      const remainingSlots = Math.max(0, groupSizeLimit - currentSize);

      constraints[groupKey] = { min: 0, max: Math.min(1, remainingSlots) };
    } else {
      if (!constraints[groupKey]) {
        constraints[groupKey] = { min: 0, max: 1 };
      }
    }
  });

  const numToAssign = Math.min(queue.length, groupsToUse.length);

  constraints.totalAssigned = { equal: numToAssign };

  return {
    opType: 'max',
    optimize: 'score',
    constraints,
    variables,
    ints,
  };
}
