import { competingIn, createTypeComp } from '@/lib/api';
import { PersonalBest } from '@/lib/functions/events';
import { COMPETITION_ID, classifyRounds, STAFF_REQUIREMENTS } from './config';

const tc = await createTypeComp(COMPETITION_ID);

const { normalRounds } = classifyRounds(tc);

const subsequentRounds = normalRounds.filter((roundId) => {
  const parts = roundId.split('-r');
  const roundNum = parseInt(parts[1] || '0', 10);
  return roundNum > 1;
});

for (const roundId of subsequentRounds) {
  const parts = roundId.split('-r');
  const eventId = parts[0];

  const round = tc.round(roundId);

  if (!eventId) {
    console.warn(`Invalid round ID: ${roundId}`);
    continue;
  }

  const competitors = tc.persons.filter(competingIn(eventId));

  if (competitors.length === 0) {
    console.warn(`No competitors found for ${roundId}, skipping.`);
    continue;
  }

  const numGroups = Math.ceil(competitors.length / 18);

  const sortedCompetitors = competitors.sort((a, b) => {
    const pb1 = PersonalBest(a, eventId, 'average') || 999999;
    const pb2 = PersonalBest(b, eventId, 'average') || 999999;
    return pb2 - pb1;
  });

  round.createGroups(numGroups);

  const chunkSize = 18;

  for (let i = 0; i < numGroups; i++) {
    const groupNum = i + 1;
    const groupCode = `g${groupNum}`;

    const startIndex = i * chunkSize;
    const chunk = sortedCompetitors.slice(startIndex, startIndex + chunkSize);
    const chunkIds = new Set(chunk.map((p) => p.registrantId));

    round.assignmentSet(
      `group-${groupNum}-seeded`,
      (p) => chunkIds.has(p.registrantId),
      (g) => g.activityCode.endsWith(groupCode),
    );
  }

  round.maxGroupSize(18);
  round.scrambleSetCountFromAdvancement(18);
  round.assign();

  let judgesCount = STAFF_REQUIREMENTS.judges;
  let assigned = false;

  const groups = tc.groups(roundId);
  if (groups.length === 0) continue;

  const staffPool = tc.persons.registered();

  while (judgesCount >= 6 && !assigned) {
    try {
      const attempt = tc
        .staff(roundId)
        .from((p) => staffPool.includes(p))
        .scramblers(STAFF_REQUIREMENTS.scramblers, competingIn(eventId))
        .runners(STAFF_REQUIREMENTS.runners)
        .judges(judgesCount)
        .preferFastScramblers(eventId)
        .avoidConflicts(true);

      const result = attempt.assign();

      if (result.warnings.length === 0 && result.assigned > 0) {
        assigned = true;
      } else {
        judgesCount -= 2;
      }
    } catch (e) {
      console.error(`  Error staffing: ${e}`);
      judgesCount -= 2;
    }
  }

  if (!assigned) {
    console.warn(`  Satisfactory staffing not found for ${roundId}.`);
  }
}

await tc.commit();
