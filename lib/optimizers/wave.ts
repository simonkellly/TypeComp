import solver from '../types/lp-solver';
import type { Event, Person } from '../types/wcif';

export interface WaveOptimizationOptions {
  waves: number;
  waveSize: number;
  minimizeEvents: boolean;
  considerAvailability?: boolean;
  resolveConflicts?: boolean;
}

export interface WaveAssignment {
  person: Person;
  wave: number;
  events: Event[];
}

export function minimizeWaveEvents(
  competitors: Person[],
  events: Event[],
  options: WaveOptimizationOptions,
): WaveAssignment[] {
  const { waves, waveSize, minimizeEvents: _minimizeEvents } = options;

  const variables: Record<string, Record<string, number>> = {};
  const constraints: Record<
    string,
    { min?: number; max?: number; equal?: number }
  > = {};
  const ints: Record<string, number> = {};

  for (const competitor of competitors) {
    for (let wave = 1; wave <= waves; wave++) {
      const varName = `person_${competitor.registrantId}_wave_${wave}`;
      const personConstraint = `person_${competitor.registrantId}`;
      const waveConstraint = `wave_${wave}_size`;

      variables[varName] = {
        [personConstraint]: 1,
        [waveConstraint]: 1,
        events: countEventsInWave(competitor, events, wave),
      };

      ints[varName] = 1;
    }
  }

  for (const competitor of competitors) {
    constraints[`person_${competitor.registrantId}`] = {
      equal: 1,
    };
  }

  for (let wave = 1; wave <= waves; wave++) {
    constraints[`wave_${wave}_size`] = {
      min: waveSize - 2,
      max: waveSize + 2,
    };
  }

  const model = {
    opType: 'min' as const,
    optimize: 'events',
    constraints,
    variables,
    ints,
  };

  const solution = solver.solve(model);

  if (!solution.feasible) {
    throw new Error(
      `No feasible solution found for wave assignment. Feasible: ${solution.feasible}`,
    );
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

  const assignments: WaveAssignment[] = [];

  for (const competitor of competitors) {
    for (let wave = 1; wave <= waves; wave++) {
      const varName = `person_${competitor.registrantId}_wave_${wave}`;
      const value = variableMap.get(varName);

      if (value !== undefined && Math.round(value) === 1) {
        assignments.push({
          person: competitor,
          wave,
          events: events.filter((e) =>
            competitor.registration?.eventIds.includes(e.id),
          ),
        });
        break;
      }
    }
  }

  return assignments;
}

function countEventsInWave(
  competitor: Person,
  events: Event[],
  _wave: number,
): number {
  return events.filter((e) => competitor.registration?.eventIds.includes(e.id))
    .length;
}
