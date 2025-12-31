import { DateTime } from 'luxon';
import { getActivityById } from '../functions/groups-helpers';
import type { Activity, Group, Person } from '../types/core';
import type { Competition } from '../types/wcif';
import { activitiesOverlap } from './availability';

export function hasOverlappingAssignment(
  person: Person,
  activity: Activity,
  competition: Competition,
): boolean {
  return (person.assignments || []).some((assignment) => {
    const assignedActivity = getActivityById(
      competition,
      assignment.activityId,
    );

    return assignedActivity
      ? activitiesOverlap(assignedActivity, activity)
      : false;
  });
}

export function resolveGroupConflict(
  groups: Group[],
  _competitor: Person,
  targetGroupId: number,
  competition: Competition,
  options: { allowOverPopulation?: boolean } = {},
): Group[] {
  const { allowOverPopulation = false } = options;
  const targetGroup = groups.find((g) => g.id === targetGroupId);

  if (!targetGroup) {
    return groups;
  }

  const targetGroupCompetitors = competition.persons.filter((p) => {
    const assignment = (p.assignments || []).find(
      (a) =>
        a.activityId === targetGroupId && a.assignmentCode === 'competitor',
    );

    return assignment !== undefined;
  });

  const maxGroupSize = 18;
  const isFull = targetGroupCompetitors.length >= maxGroupSize;

  if (!isFull || allowOverPopulation) {
    return groups;
  }

  const sortedGroups = [...groups].sort((a, b) => {
    const startA = DateTime.fromISO(a.startTime);
    const startB = DateTime.fromISO(b.startTime);

    return startA.toMillis() - startB.toMillis();
  });

  const targetIndex = sortedGroups.findIndex((g) => g.id === targetGroupId);

  if (targetIndex === -1) {
    return groups;
  }

  for (let i = targetIndex + 1; i < sortedGroups.length; i++) {
    const laterGroup = sortedGroups[i];
    const laterGroupCompetitors = competition.persons.filter((p) => {
      const assignment = (p.assignments || []).find(
        (a) =>
          a.activityId === (laterGroup?.id ?? -1) &&
          a.assignmentCode === 'competitor',
      );

      return assignment !== undefined;
    });

    if (laterGroupCompetitors.length < maxGroupSize) {
      return groups;
    }
  }

  for (let i = targetIndex - 1; i >= 0; i--) {
    const earlierGroup = sortedGroups[i];
    const earlierGroupCompetitors = competition.persons.filter((p) => {
      const assignment = (p.assignments || []).find(
        (a) =>
          a.activityId === (earlierGroup?.id ?? -1) &&
          a.assignmentCode === 'competitor',
      );

      return assignment !== undefined;
    });

    if (earlierGroupCompetitors.length < maxGroupSize) {
      return groups;
    }
  }

  return groups;
}

export function overlapsEveryoneWithSameRole(
  competitor: Person,
  activity: Activity,
  role: string,
  allPeople: Person[],
  competition: Competition,
): boolean {
  const others = allPeople.filter((p) => {
    return (
      p.registrantId !== competitor.registrantId &&
      (p.roles || []).includes(role)
    );
  });

  if (others.length === 0) {
    return false;
  }

  return others.every((other) =>
    hasOverlappingAssignment(other, activity, competition),
  );
}
