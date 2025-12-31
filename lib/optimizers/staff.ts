import { DateTime } from 'luxon';
import { getActivityById } from '../functions/groups-helpers';
import type { Activity, Assignment, Competition, Person } from '../types/wcif';
import {
  type AssignmentWithPersonId,
  competesInMinutes,
  presenceRate,
} from './availability';

export interface StaffSelectionCriteria {
  taskDistribution?: boolean;
  eventSuitability?: boolean;
  ageRestriction?: number;
  roleConflicts?: string[];
  presenceRate?: boolean;
  competingSoon?: number;

  maxTasksPerEvent?: number;
}

export function selectStaffWithCriteria(
  candidates: Person[],
  activity: Activity,
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
  criteria: StaffSelectionCriteria,
): Person[] {
  const sorted = [...candidates].sort((a, b) => {
    const scoreA = calculateStaffScore(
      a,
      activity,
      competition,
      allAssignments,
      criteria,
    );
    const scoreB = calculateStaffScore(
      b,
      activity,
      competition,
      allAssignments,
      criteria,
    );

    return scoreA - scoreB;
  });

  return sorted;
}

function calculateStaffScore(
  person: Person,
  activity: Activity,
  competition: Competition,
  allAssignments: AssignmentWithPersonId[],
  criteria: StaffSelectionCriteria,
): number {
  let score = 0;

  if (criteria.taskDistribution) {
    const taskCount = allAssignments.filter(
      (a) => a.personId === person.registrantId,
    ).length;

    score = score + taskCount;
  }

  if (criteria.eventSuitability) {
    const eventId = extractEventId(activity);
    const hasPb =
      person.personalBests?.some((pb) => pb.eventId === eventId) || false;

    if (!hasPb) {
      score = score + 10;
    }
  }

  if (criteria.ageRestriction) {
    const age = calculateAge(person);

    if (age < criteria.ageRestriction) {
      score = score + 100;
    }
  }

  if (criteria.roleConflicts) {
    const hasConflictingRole = criteria.roleConflicts.some((role) =>
      (person.roles || []).includes(role),
    );

    if (hasConflictingRole) {
      score = score + 50;
    }
  }

  if (criteria.presenceRate) {
    const pr = presenceRate(
      person,
      DateTime.fromISO(activity.startTime),
      competition,
      allAssignments,
    );

    score = score - pr;
  }

  if (criteria.competingSoon) {
    const competingSoon = competesInMinutes(
      person,
      DateTime.fromISO(activity.endTime),
      criteria.competingSoon,
      competition,
      allAssignments,
    );

    if (competingSoon) {
      score = score + 20;
    }
  }

  if (criteria.maxTasksPerEvent) {
    const eventId = extractEventId(activity);
    const tasksForEvent = allAssignments.filter((a) => {
      return (
        a.personId === person.registrantId &&
        extractEventIdFromAssignment(a, competition) === eventId
      );
    }).length;

    if (tasksForEvent >= criteria.maxTasksPerEvent) {
      score = score + 30;
    }
  }

  return score;
}

function calculateAge(person: Person): number {
  if (!person.birthdate) {
    return 0;
  }
  const birthdate = new Date(person.birthdate);
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const monthDiff = today.getMonth() - birthdate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthdate.getDate())
  ) {
    age--;
  }

  return age;
}

function extractEventId(activity: Activity): string {
  const match = activity.activityCode?.match(/^(\w+)-r\d+/);

  return match?.[1] ? match[1] : '';
}

function extractEventIdFromAssignment(
  assignment: Assignment,
  competition: Competition,
): string {
  const activity = getActivityById(competition, assignment.activityId);

  if (!activity) {
    return '';
  }

  return extractEventId(activity);
}
