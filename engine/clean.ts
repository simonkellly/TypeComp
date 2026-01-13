import {
  GROUPIFIER_EXTENSION_PREFIX,
  PERSON_EXTENSION_PREFIX,
} from '@/lib/functions/extensions';
import type { Competition } from '@/lib/types/wcif';

const CUSTOM_EXTENSION_PREFIXES = [
  GROUPIFIER_EXTENSION_PREFIX,
  PERSON_EXTENSION_PREFIX,
] as const;

function removeCustomExtensions(entity: {
  extensions?: Array<{ id: string }>;
}): void {
  if (!entity.extensions) return;

  entity.extensions = entity.extensions.filter(
    (ext) =>
      !CUSTOM_EXTENSION_PREFIXES.some((prefix) => ext.id.startsWith(prefix)),
  );
}

export function cleanWcif(competition: Competition): void {
  for (const person of competition.persons) {
    person.assignments = [];
    removeCustomExtensions(person);
  }

  for (const venue of competition.schedule.venues) {
    removeCustomExtensions(venue);

    for (const room of venue.rooms) {
      removeCustomExtensions(room);

      if (!room.activities) {
        room.activities = [];
        continue;
      }

      room.activities = room.activities.filter(
        (activity) => activity.activityCode !== 'other-misc',
      );

      for (const activity of room.activities) {
        activity.childActivities = [];
        removeCustomExtensions(activity);
      }
    }
  }

  removeCustomExtensions(competition);
}
