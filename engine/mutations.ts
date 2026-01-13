import type { Activity, Competition, Person } from '@/lib/types/wcif';

export interface MutationTracker {
  persons: PersonMutation[];
  schedule: ScheduleMutation[];
  events: EventMutation[];
  extensions: ExtensionMutation[];
}

export interface PersonMutation {
  type: 'create' | 'update' | 'delete';
  person: Person;
  changes?: Partial<Person>;
}

export interface ScheduleMutation {
  type: 'create' | 'update' | 'delete';
  activity: Activity;
  changes?: Partial<Activity>;
}

export interface EventMutation {
  type: 'create' | 'update' | 'delete';
  eventId: string;
  changes?: Record<string, unknown>;
}

export interface ExtensionMutation {
  type: 'create' | 'update' | 'delete';
  extensionId: string;
  data: unknown;
}

export function createMutationTracker(): MutationTracker {
  return {
    persons: [],
    schedule: [],
    events: [],
    extensions: [],
  };
}

export function trackPersonMutation(
  tracker: MutationTracker,
  mutation: PersonMutation,
): void {
  tracker.persons.push(mutation);
}

export function trackScheduleMutation(
  tracker: MutationTracker,
  mutation: ScheduleMutation,
): void {
  tracker.schedule.push(mutation);
}

export function trackEventMutation(
  tracker: MutationTracker,
  mutation: EventMutation,
): void {
  tracker.events.push(mutation);
}

export function trackExtensionMutation(
  tracker: MutationTracker,
  mutation: ExtensionMutation,
): void {
  tracker.extensions.push(mutation);
}

export function applyMutations(
  competition: Competition,
  tracker: MutationTracker,
  dryRun: boolean,
): Competition {
  if (dryRun) {
    return { ...competition };
  }

  const updated = { ...competition };

  for (const mutation of tracker.persons) {
    switch (mutation.type) {
      case 'update': {
        updated.persons = updated.persons.map((p) => {
          return p.registrantId === mutation.person.registrantId
            ? { ...p, ...mutation.changes }
            : p;
        });
        break;
      }
      case 'create': {
        updated.persons = [...updated.persons, mutation.person];
        break;
      }
      case 'delete': {
        updated.persons = updated.persons.filter(
          (p) => p.registrantId !== mutation.person.registrantId,
        );
        break;
      }
    }
  }

  for (const mutation of tracker.schedule) {
    const visitActivities = (
      fn: (activities: Activity[], index: number) => void,
    ) => {
      for (const venue of updated.schedule.venues || []) {
        for (const room of venue.rooms || []) {
          if (!room.activities) {
            continue;
          }

          room.activities.forEach((activity, idx, arr) => {
            if (activity.id === mutation.activity.id) {
              fn(arr, idx);
            }

            if (
              activity.childActivities &&
              activity.childActivities.length > 0
            ) {
              activity.childActivities.forEach((child, cIdx, cArr) => {
                if (child.id === mutation.activity.id) {
                  fn(cArr, cIdx);
                }
              });
            }
          });
        }
      }
    };

    switch (mutation.type) {
      case 'update': {
        visitActivities((activities, index) => {
          const existing = activities[index];
          if (existing) {
            activities[index] = {
              ...existing,
              ...mutation.changes,
            } as Activity;
          }
        });
        break;
      }
      case 'delete': {
        visitActivities((activities, index) => {
          activities.splice(index, 1);
        });
        break;
      }
      case 'create': {
        const venues = updated.schedule.venues || [];
        if (
          venues.length > 0 &&
          venues[0]?.rooms &&
          venues[0].rooms.length > 0
        ) {
          const room = venues[0].rooms[0];
          if (room) {
            if (!room.activities) {
              room.activities = [];
            }

            const activity: Activity = {
              ...mutation.activity,
              id: mutation.activity.id ?? 0,
              name: mutation.activity.name ?? '',
              activityCode: mutation.activity.activityCode ?? '',
              startTime: mutation.activity.startTime ?? '',
              endTime: mutation.activity.endTime ?? '',
              childActivities: mutation.activity.childActivities ?? [],
              extensions: mutation.activity.extensions ?? [],
            };

            room.activities.push(activity);
          }
        }
        break;
      }
    }
  }

  return updated;
}
