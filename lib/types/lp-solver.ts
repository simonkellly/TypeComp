export interface LPSolverModel {
  opType: 'max' | 'min';
  optimize: string;
  constraints: Record<string, { min?: number; max?: number; equal?: number }>;
  variables: Record<string, Record<string, number>>;
  ints?: Record<string, number>;
}

export interface LPSolverSolution {
  feasible: boolean;
  result: number;
  bounded: boolean;
  isIntegral?: boolean;
  [variableName: string]: number | boolean | undefined;
}

export interface LPSolver {
  solve: (
    model: LPSolverModel,
    precision?: number,
    full?: boolean,
    validate?: boolean,
  ) => LPSolverSolution;
}

interface JavaScriptLPSolver {
  Solve: (
    model: LPSolverModel,
    precision?: number,
    full?: boolean,
    validate?: boolean,
  ) => LPSolverSolution;
}

import solverModule from 'javascript-lp-solver';

const solverInstance: LPSolver = {
  solve: (model, precision, full, validate) => {
    return (solverModule as unknown as JavaScriptLPSolver).Solve(
      model,
      precision,
      full,
      validate,
    );
  },
};

export default solverInstance;
