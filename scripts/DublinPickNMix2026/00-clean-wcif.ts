import { createTypeComp } from '@/lib/api';
import { COMPETITION_ID } from './config';

const tc = await createTypeComp(COMPETITION_ID);

console.log('Clearing all assignments and groups...');

let clearedAssignments = 0;
for (const person of tc.persons.all()) {
  if (person.assignments && person.assignments.length > 0) {
    clearedAssignments += person.assignments.length;
    person.assignments = [];
  }
}

let clearedGroups = 0;
for (const venue of tc.competition.schedule.venues) {
  for (const room of venue.rooms) {
    for (const activity of room.activities) {
      if (activity.childActivities && activity.childActivities.length > 0) {
        clearedGroups += activity.childActivities.length;
        activity.childActivities = [];
      }
    }
  }
}

console.log(
  `✅ Cleared ${clearedAssignments} assignments from ${tc.persons.all().length} persons`,
);
console.log(`✅ Cleared ${clearedGroups} groups from schedule`);

await tc.commit();
