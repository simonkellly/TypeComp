import { competingIn, competingInAny, createTypeComp } from '@/lib/api';
import type { Person } from '@/lib/types/core';
import { COMPETITION_ID } from './config';
import { classifyRounds } from './util';

const EVENT_POINTS: Record<string, number> = {
  '333': 0,
  '222': 5,
  '444': 6,
  '555': 8,
  '666': 7,
  '777': 9,
  '333oh': 6,
  clock: 7,
  minx: 9,
  pyram: 5,
  skewb: 5,
  sq1: 6,
  '333bf': 0,
};

const MAX_POINTS = 20;

const tc = await createTypeComp(COMPETITION_ID);

console.log('='.repeat(80));
console.log('REGISTRATION VALIDATION');
console.log('='.repeat(80));

const validationResults: Array<{
  person: { name: string; registrantId: number; wcaId?: string };
  totalPoints: number;
  events: Array<{ eventId: string; points: number }>;
  isValid: boolean;
  error?: string;
}> = [];
let validCount = 0;
let invalidCount = 0;

for (const person of tc.competition.persons) {
  const registration = person.registration;

  if (
    !registration ||
    !registration.isCompeting ||
    registration.status !== 'accepted'
  ) {
    continue;
  }

  let total = 0;
  const events: Array<{ eventId: string; points: number }> = [];
  const unknownEvents: string[] = [];

  for (const eventId of registration.eventIds) {
    const points = EVENT_POINTS[eventId];
    if (points === undefined) {
      unknownEvents.push(eventId);
      events.push({ eventId, points: 0 });
    } else {
      total += points;
      events.push({ eventId, points });
    }
  }

  const isValid = total <= MAX_POINTS && unknownEvents.length === 0;
  let error: string | undefined;
  if (!isValid) {
    if (total > MAX_POINTS) {
      error = `Exceeds limit: ${total} points (max ${MAX_POINTS})`;
    }
    if (unknownEvents.length > 0) {
      error = `${error ? `${error}; ` : ''}Unknown events: ${unknownEvents.join(', ')}`;
    }
  }

  validationResults.push({
    person: {
      name: person.name,
      registrantId: person.registrantId,
      wcaId: person.wcaId ?? undefined,
    },
    totalPoints: total,
    events,
    isValid,
    error,
  });

  if (isValid) {
    validCount++;
  } else {
    invalidCount++;
  }
}

validationResults.sort((a, b) => {
  if (a.isValid !== b.isValid) {
    return a.isValid ? 1 : -1;
  }
  return b.totalPoints - a.totalPoints;
});

console.log(`Total competitors: ${validationResults.length}`);
console.log(`✅ Valid registrations: ${validCount}`);
console.log(`❌ Invalid registrations: ${invalidCount}`);
console.log('');

if (invalidCount > 0) {
  console.log('INVALID REGISTRATIONS:');
  for (const result of validationResults) {
    if (!result.isValid) {
      console.log(
        `  ❌ ${result.person.name} (ID: ${result.person.registrantId}${result.person.wcaId ? `, WCA ID: ${result.person.wcaId}` : ''})`,
      );
      console.log(
        `     ${result.totalPoints} / ${MAX_POINTS} points - ${result.error}`,
      );
    }
  }
  console.log('');
}

const pointDistribution = new Map<number, number>();
for (const result of validationResults) {
  const count = pointDistribution.get(result.totalPoints) || 0;
  pointDistribution.set(result.totalPoints, count + 1);
}

console.log('Point Distribution:');
const sortedPoints = Array.from(pointDistribution.entries()).sort(
  (a, b) => a[0] - b[0],
);
for (const [points, count] of sortedPoints) {
  const bar = '█'.repeat(Math.floor((count / validationResults.length) * 30));
  console.log(
    `  ${points.toString().padStart(2)} points: ${count.toString().padStart(3)} ${bar}`,
  );
}
console.log('\n');

console.log('='.repeat(80));
console.log('STAFF-CCOMPETITOR CONFLICT VALIDATION');
console.log('='.repeat(80));

const conflicts: Array<{
  person: Person;
  roundId: string;
  groupId: number;
  groupCode: string;
  staffRole: string;
}> = [];

for (const venue of tc.competition.schedule.venues) {
  for (const room of venue.rooms) {
    for (const activity of room.activities) {
      if (!activity.childActivities) continue;

      const roundIdMatch = activity.activityCode.match(/^(.+-r\d+)$/);
      if (!roundIdMatch) continue;
      const roundId = roundIdMatch[1];

      for (const group of activity.childActivities) {
        const competitors = tc.persons.filter((p: Person) =>
          (p.assignments ?? []).some(
            (a) =>
              a.activityId === group.id && a.assignmentCode === 'competitor',
          ),
        );

        const staff = tc.persons.filter((p: Person) =>
          (p.assignments ?? []).some(
            (a) =>
              a.activityId === group.id &&
              a.assignmentCode !== 'competitor' &&
              a.assignmentCode.startsWith('staff-'),
          ),
        );

        for (const person of staff) {
          const isCompetitor = competitors.some(
            (c) => c.registrantId === person.registrantId,
          );
          if (isCompetitor) {
            const staffAssignment = person.assignments?.find(
              (a) =>
                a.activityId === group.id &&
                a.assignmentCode.startsWith('staff-'),
            );
            if (staffAssignment) {
              conflicts.push({
                person,
                roundId: roundId || '',
                groupId: group.id,
                groupCode: group.activityCode,
                staffRole: staffAssignment.assignmentCode,
              });
            }
          }
        }
      }
    }
  }
}

if (conflicts.length === 0) {
  console.log('✅ No conflicts found - all staff assignments are valid');
} else {
  console.log(`❌ Found ${conflicts.length} conflict(s):`);
  for (const conflict of conflicts) {
    console.log(
      `  ❌ ${conflict.person.name} (ID: ${conflict.person.registrantId})`,
    );
    console.log(
      `     Competing AND ${conflict.staffRole} in ${conflict.roundId} ${conflict.groupCode}`,
    );
  }
}
console.log('\n');

const { parallelEventGroups } = classifyRounds(tc);

for (const eventGroup of parallelEventGroups) {
  if (eventGroup.length === 0) continue;

  const competitors = tc.persons.filter(competingInAny(...eventGroup));
  if (competitors.length === 0) continue;

  const numWaves = Math.ceil(competitors.length / 18);
  const waveAnchorGroups = new Map<number, number>();

  for (let waveNum = 1; waveNum <= numWaves; waveNum++) {
    for (const eid of eventGroup) {
      const gid = tc
        .groups(`${eid}-r1`)
        .find((g) => g.activityCode.endsWith(`g${waveNum}`))?.id;
      if (gid) {
        waveAnchorGroups.set(waveNum, gid);
        break;
      }
    }
  }

  const assignments = new Map<number, number>();
  for (const eventId of eventGroup) {
    const groups = tc.groups(`${eventId}-r1`);
    for (const group of groups) {
      const match = group.activityCode.match(/g(\d+)/);
      if (!match?.[1]) continue;
      const waveNum = parseInt(match[1], 10);
      const groupCompetitors = tc.persons.filter((p: Person) =>
        (p.assignments ?? []).some(
          (a) => a.activityId === group.id && a.assignmentCode === 'competitor',
        ),
      );
      for (const comp of groupCompetitors) {
        assignments.set(comp.registrantId, waveNum);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PARALLEL WAVE REPORT: ${eventGroup.join(', ')}`);
  console.log(`${'='.repeat(60)}`);

  const actualWaves = new Set(assignments.values());
  const sortedWaves = Array.from(actualWaves).sort((a, b) => a - b);

  const waveReport: Array<Record<string, number | string>> = [];

  for (const waveNum of sortedWaves) {
    const waveCompetitors = Array.from(assignments.entries())
      .filter(([_, wave]) => wave === waveNum)
      .map(([personId]) => tc.persons.byId(personId))
      .filter((p): p is Person => p !== undefined);

    const row: Record<string, number | string> = {
      Wave: waveNum,
    };

    for (const eventId of eventGroup) {
      const eventCompetitors = waveCompetitors.filter((c) =>
        competingIn(eventId)(c),
      );
      row[eventId] = eventCompetitors.length > 0 ? eventCompetitors.length : '';
    }

    row.Competitors = waveCompetitors.length;
    waveReport.push(row);
  }

  console.log('\nWave Summary:');
  console.table(waveReport);

  for (const waveNum of sortedWaves) {
    console.log(`\n--- Wave ${waveNum} ---`);

    const anchorGroupId = waveAnchorGroups.get(waveNum);

    const waveGroupIds: number[] = [];
    if (anchorGroupId) {
      waveGroupIds.push(anchorGroupId);
    }
    for (const eventId of eventGroup) {
      for (const group of tc.groups(`${eventId}-r1`)) {
        const match = group.activityCode.match(/g(\d+)/);
        if (match?.[1] && parseInt(match[1], 10) === waveNum) {
          if (!waveGroupIds.includes(group.id)) {
            waveGroupIds.push(group.id);
          }
        }
      }
    }

    let waveActivityId: number | null = null;
    for (const venue of tc.competition.schedule.venues) {
      for (const room of venue.rooms) {
        const waveActivity = room.activities.find(
          (a) =>
            a.activityCode === 'other-misc' && a.name === `Wave ${waveNum}`,
        );
        if (waveActivity) {
          waveActivityId = waveActivity.id;
          break;
        }
      }
      if (waveActivityId) break;
    }

    const waveCompetitors: {
      person: Person;
      station: number;
      events: string[];
    }[] = [];
    for (const [personId, assignedWave] of assignments) {
      if (assignedWave !== waveNum) continue;
      const person = tc.persons.byId(personId);
      if (!person) continue;

      let station = 0;
      if (waveActivityId) {
        const waveAssignment = person.assignments?.find(
          (a) =>
            a.activityId === waveActivityId &&
            a.assignmentCode === 'competitor',
        );
        station = waveAssignment?.stationNumber ?? 0;
      }

      if (station === 0 || station === null) {
        const groupAssignment = person.assignments?.find(
          (a) =>
            waveGroupIds.includes(a.activityId ?? 0) &&
            a.assignmentCode === 'competitor',
        );
        station = groupAssignment?.stationNumber ?? 0;
      }

      const events = eventGroup.filter((eid) => competingIn(eid)(person));
      waveCompetitors.push({ person, station, events });
    }

    waveCompetitors.sort((a, b) => a.station - b.station);

    console.log(`\nCompetitors (${waveCompetitors.length}):`);
    for (const { person, station, events } of waveCompetitors) {
      console.log(
        `  Station ${String(station).padStart(2)}: ${person.name} [${events.join(', ')}]`,
      );
    }

    if (waveActivityId) {
      const staff = tc.persons.filter((p) =>
        (p.assignments ?? []).some(
          (a) =>
            a.activityId === waveActivityId &&
            a.assignmentCode !== 'competitor',
        ),
      );

      const scramblers = staff.filter((p) =>
        (p.assignments ?? []).some(
          (a) =>
            a.activityId === waveActivityId &&
            a.assignmentCode === 'staff-scrambler',
        ),
      );
      const runners = staff.filter((p) =>
        (p.assignments ?? []).some(
          (a) =>
            a.activityId === waveActivityId &&
            a.assignmentCode === 'staff-runner',
        ),
      );
      const judges = staff.filter((p) =>
        (p.assignments ?? []).some(
          (a) =>
            a.activityId === waveActivityId &&
            a.assignmentCode === 'staff-judge',
        ),
      );

      console.log(`\nStaff:`);
      if (scramblers.length > 0)
        console.log(
          `  Scramblers: ${scramblers.map((p) => p.name).join(', ')}`,
        );
      if (runners.length > 0)
        console.log(`  Runners: ${runners.map((p) => p.name).join(', ')}`);
      if (judges.length > 0)
        console.log(`  Judges: ${judges.map((p) => p.name).join(', ')}`);
      if (staff.length === 0) console.log(`  (No staff assigned)`);
    } else {
      console.log(`\nStaff: (Wave activity not found)`);
    }
  }

  console.log(`\n${'='.repeat(60)}\n`);
}
