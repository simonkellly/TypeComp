import type { RegistrantId } from '@wca/helpers';
import type { ExecutionContext } from '@/engine';
import { competingIn, isDelegate, registered } from '../api/filters';
import { PersonalBest } from '../functions/events';
import { fisherYatesShuffle } from '../functions/utils';
import type { Person } from '../types/core';
import { type CPModel, type CPSolution, solveCP } from './ortools-bridge';

export interface ParallelAssignmentResult {
  assignments: Map<RegistrantId, number>;

  groupSizes: number[];

  eventsPerGroup: number[];

  totalAssigned: number;
}

export interface ParallelAssignmentOptions {
  maxGroupSize: number;

  groupCount: number;

  solverScript?: string;

  verbose?: boolean;

  waveExclusions?: Map<RegistrantId, number[]>;
}

export async function assignParallelEvents(
  ctx: ExecutionContext,
  eventIds: string[],
  options: ParallelAssignmentOptions,
): Promise<ParallelAssignmentResult> {
  const {
    maxGroupSize,
    groupCount,
    solverScript,
    verbose = false,
    waveExclusions,
  } = options;

  if (verbose) {
    console.log('Starting parallel event assignment optimization...');
    console.log(`Events: ${eventIds.join(', ')}`);
    console.log(`Groups: ${groupCount}, Max size: ${maxGroupSize}`);
  }

  const allCompetitors = ctx.competition.persons.filter(registered);

  const competitors = fisherYatesShuffle(
    allCompetitors.filter((comp) =>
      eventIds.some((eventId) => competingIn(eventId)(comp)),
    ),
  );

  if (verbose) {
    console.log(`Total competitors: ${allCompetitors.length}`);
    console.log(`Competitors in parallel events: ${competitors.length}`);
  }

  const { targetSizes, totalCapacity } = calculateGroupSizes(
    competitors.length,
    groupCount,
    maxGroupSize,
  );

  if (totalCapacity < competitors.length) {
    throw new Error(
      `Cannot assign ${competitors.length} competitors to ${groupCount} groups ` +
        `with max size ${maxGroupSize}. Maximum capacity: ${totalCapacity}`,
    );
  }

  if (verbose) {
    console.log(`Target group sizes: ${targetSizes.join(', ')}`);
  }

  const competitorEvents = new Map<RegistrantId, string[]>();

  competitors.forEach((comp) => {
    const events = eventIds.filter((eventId) => competingIn(eventId)(comp));

    competitorEvents.set(comp.registrantId, events);
  });

  const delegates = competitors.filter((c) => isDelegate(c));
  const model = buildAssignmentModel(
    competitors,
    competitorEvents,
    eventIds,
    groupCount,
    targetSizes,
    maxGroupSize,
    delegates,
    waveExclusions,
  );

  if (verbose) {
    console.log(
      `Model: ${Object.keys(model.variables).length} variables, ${Object.keys(model.constraints).length} constraints`,
    );
    console.log('Solving...');
  }

  const solution = await solveCP(model, solverScript);

  if (verbose) {
    console.log(`Status: ${solution.status}, Feasible: ${solution.feasible}`);
    if (solution.result !== null) {
      console.log(`Objective: ${solution.result}`);
    }
  }

  if (!solution.feasible) {
    throw new Error(
      `Model is infeasible (status: ${solution.status}). ` +
        `Cannot distribute ${competitors.length} competitors into ${groupCount} groups.`,
    );
  }

  const assignments = extractAssignments(competitors, groupCount, solution);

  const groupSizes = new Array(groupCount).fill(0);
  const eventsPerGroup = new Array(groupCount)
    .fill(0)
    .map(() => new Set<string>());

  for (const [personId, groupNum] of assignments) {
    const idx = groupNum - 1;
    const groupSize = groupSizes[idx];
    const groupEvents = eventsPerGroup[idx];

    if (groupSize !== undefined && groupEvents) {
      groupSizes[idx] = groupSize + 1;
      const events = competitorEvents.get(personId) || [];

      events.forEach((e) => {
        groupEvents.add(e);
      });
    }
  }

  if (verbose) {
    console.log('Assignment complete:');
    for (let i = 0; i < groupCount; i++) {
      const size = groupSizes[i] ?? 0;
      const eventCount = eventsPerGroup[i]?.size ?? 0;

      console.log(
        `  Group ${i + 1}: ${size} competitors, ${eventCount} events`,
      );
    }
  }

  return {
    assignments,
    groupSizes,
    eventsPerGroup: eventsPerGroup.map((s) => s.size),
    totalAssigned: assignments.size,
  };
}

function calculateGroupSizes(
  totalCompetitors: number,
  groupCount: number,
  maxGroupSize: number,
): { targetSizes: number[]; totalCapacity: number } {
  const baseSize = Math.floor(totalCompetitors / groupCount);
  const remainder = totalCompetitors % groupCount;

  const targetSizes: number[] = [];

  for (let i = 0; i < groupCount; i++) {
    const idealSize = baseSize + (i < remainder ? 1 : 0);

    targetSizes.push(Math.min(idealSize, maxGroupSize));
  }

  const totalCapacity = targetSizes.reduce((sum, size) => sum + size, 0);

  return { targetSizes, totalCapacity };
}

function buildAssignmentModel(
  competitors: Person[],
  competitorEvents: Map<RegistrantId, string[]>,
  eventIds: string[],
  groupCount: number,
  targetSizes: number[],
  _maxGroupSize: number,
  delegates: Person[] = [],
  waveExclusions?: Map<RegistrantId, number[]>,
): CPModel {
  const shuffledCompetitors = fisherYatesShuffle(competitors);
  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<
    string,
    { min?: number; max?: number; equal?: number }
  > = {};
  const integers: string[] = [];

  for (const competitor of shuffledCompetitors) {
    for (let group = 1; group <= groupCount; group++) {
      const varName = `p${competitor.registrantId}_w${group}`;
      const personConstraint = `person_${competitor.registrantId}`;
      const groupConstraint = `group_${group}`;

      variables[varName] = {
        [personConstraint]: 1,
        [groupConstraint]: 1,
      };
      integers.push(varName);
    }
  }

  const eventCompetitorCounts = new Map<string, number>();

  for (const eventId of eventIds) {
    const count = shuffledCompetitors.filter((c) => {
      const events = competitorEvents.get(c.registrantId) || [];

      return events.includes(eventId);
    }).length;

    eventCompetitorCounts.set(eventId, count);
  }

  for (let group = 1; group <= groupCount; group++) {
    for (const eventId of eventIds) {
      const hasEventVar = `hasEvent_w${group}_e${eventId}`;
      const boundConstraint = `hasEvent_bound_w${group}_e${eventId}`;

      variables[hasEventVar] = {
        events: 1,
        [boundConstraint]: 1,
      };

      constraints[boundConstraint] = { min: 0, max: 1 };
      integers.push(hasEventVar);
    }
  }

  for (const competitor of shuffledCompetitors) {
    constraints[`person_${competitor.registrantId}`] = { equal: 1 };
  }

  if (waveExclusions) {
    for (const [registrantId, excludedWaves] of waveExclusions) {
      for (const wave of excludedWaves) {
        if (wave >= 1 && wave <= groupCount) {
          const varName = `p${registrantId}_w${wave}`;
          if (variables[varName]) {
            const exclusionConstraint = `exclude_${registrantId}_w${wave}`;
            const varObj = variables[varName];
            if (varObj) {
              varObj[exclusionConstraint] = 1;
            }
            constraints[exclusionConstraint] = { equal: 0 };
          }
        }
      }
    }
  }

  for (let group = 1; group <= groupCount; group++) {
    const targetSize = targetSizes[group - 1];

    constraints[`group_${group}`] = {
      equal: targetSize,
    };
  }

  for (let group = 1; group <= groupCount; group++) {
    for (const eventId of eventIds) {
      const hasEventVar = `hasEvent_w${group}_e${eventId}`;
      const M = eventCompetitorCounts.get(eventId) || 1;

      const linkConstraint1 = `link1_w${group}_e${eventId}`;

      constraints[linkConstraint1] = { min: 0 };

      if (!variables[hasEventVar]) {
        variables[hasEventVar] = {};
      }
      const hasEventVarObj = variables[hasEventVar];
      if (hasEventVarObj) {
        hasEventVarObj[linkConstraint1] = M;
      }

      const linkConstraint2 = `link2_w${group}_e${eventId}`;

      constraints[linkConstraint2] = { max: 0 };

      if (hasEventVarObj) {
        hasEventVarObj[linkConstraint2] = 1;
      }

      for (const competitor of shuffledCompetitors) {
        const events = competitorEvents.get(competitor.registrantId) || [];

        if (!events.includes(eventId)) {
          continue;
        }

        const personVarName = `p${competitor.registrantId}_w${group}`;

        if (!variables[personVarName]) {
          variables[personVarName] = {};
        }
        const personVarObj = variables[personVarName];
        if (personVarObj) {
          personVarObj[linkConstraint1] = -1;
          personVarObj[linkConstraint2] = -1;
        }
      }
    }
  }

  for (let group = 1; group <= groupCount; group++) {
    for (let i = 0; i < delegates.length; i++) {
      for (let j = i + 1; j < delegates.length; j++) {
        const d1 = delegates[i];
        const d2 = delegates[j];
        if (!d1 || !d2) continue;
        const pairVar = `delegatePair_${d1.registrantId}_${d2.registrantId}_w${group}`;
        const d1Var = `p${d1.registrantId}_w${group}`;
        const d2Var = `p${d2.registrantId}_w${group}`;
        const pairConstraint = `pair_${d1.registrantId}_${d2.registrantId}_w${group}`;

        variables[pairVar] = {
          events: 0.0001,
          [pairConstraint]: 1,
        };
        const d1VarObj = variables[d1Var];
        const d2VarObj = variables[d2Var];
        if (d1VarObj) d1VarObj[pairConstraint] = -1;
        if (d2VarObj) d2VarObj[pairConstraint] = -1;
        constraints[pairConstraint] = { min: -1 };
        integers.push(pairVar);
      }
    }
  }

  return {
    optimize: 'events',
    constraints,
    variables,
    integers,
  };
}

function extractAssignments(
  competitors: Person[],
  groupCount: number,
  solution: CPSolution,
): Map<RegistrantId, number> {
  const assignments = new Map<RegistrantId, number>();

  for (const competitor of competitors) {
    for (let group = 1; group <= groupCount; group++) {
      const varName = `p${competitor.registrantId}_w${group}`;
      const value = solution[varName];

      if (value !== undefined && Math.round(value as number) === 1) {
        assignments.set(competitor.registrantId, group);
        break;
      }
    }
  }

  return assignments;
}

export function assignStationsBySpeed(
  persons: Person[],
  eventIds: string[],
): Map<number, number> {
  const rankings = new Map<string, Map<number, number>>();

  for (const eventId of eventIds) {
    const pbType = eventId.includes('bf') ? 'single' : 'average';

    const eventScores = persons
      .filter((p) => competingIn(eventId)(p))
      .map((p) => {
        const pb = PersonalBest(p, eventId, pbType);
        return {
          id: p.registrantId,
          score: pb === null || pb <= 0 ? Infinity : pb,
        };
      })
      .sort((a, b) => a.score - b.score);

    const eventRankMap = new Map<RegistrantId, number>();
    eventScores.forEach((item, index) => {
      const rank = item.score === Infinity ? persons.length + 1 : index + 1;
      eventRankMap.set(item.id, rank);
    });

    rankings.set(eventId, eventRankMap);
  }

  const scored = persons.map((person) => {
    let bestRank = Infinity;
    let eventsWithBestRank = 0;
    let sumWorldRanks = 0;
    let worldRankCount = 0;
    let hasAnyRank = false;

    for (const eventId of eventIds) {
      if (!competingIn(eventId)(person)) continue;

      const rank = rankings.get(eventId)?.get(person.registrantId);
      if (rank === undefined) continue;

      hasAnyRank = true;
      if (rank < bestRank) {
        bestRank = rank;
        eventsWithBestRank = 1;
      } else if (rank === bestRank) {
        eventsWithBestRank++;
      }

      const pbType = eventId.includes('bf') ? 'single' : 'average';
      const pb = person.personalBests?.find(
        (p) => p.eventId === eventId && p.type === pbType,
      );
      if (pb?.worldRanking) {
        sumWorldRanks += pb.worldRanking;
        worldRankCount++;
      }
    }

    return {
      person,
      bestRank: hasAnyRank ? bestRank : Infinity,
      eventsWithBestRank,
      avgWorldRank:
        worldRankCount > 0 ? sumWorldRanks / worldRankCount : Infinity,
    };
  });

  scored.sort((a, b) => {
    if (a.bestRank !== b.bestRank) {
      return a.bestRank - b.bestRank;
    }
    if (a.eventsWithBestRank !== b.eventsWithBestRank) {
      return b.eventsWithBestRank - a.eventsWithBestRank;
    }
    if (a.avgWorldRank !== b.avgWorldRank) {
      return a.avgWorldRank - b.avgWorldRank;
    }
    return Math.random() - 0.5;
  });

  const stations = new Map<RegistrantId, number>();
  scored.forEach((item, idx) => {
    stations.set(item.person.registrantId, idx + 1);
  });

  return stations;
}
