declare module 'javascript-lp-solver' {
  interface LPSolverModel {
    opType?: 'max' | 'min';
    optimize: string;
    constraints: Record<string, { min?: number; max?: number; equal?: number }>;
    variables: Record<string, Record<string, number>>;
    ints?: Record<string, number>;
  }

  interface LPSolverSolution {
    feasible: boolean;
    result: number;
    bounded: boolean;
    isIntegral?: boolean;
    [variableName: string]: number | boolean | undefined;
  }

  interface JavaScriptLPSolver {
    Solve: (
      model: LPSolverModel,
      precision?: number,
      full?: boolean,
      validate?: boolean,
    ) => LPSolverSolution;
  }

  const solver: JavaScriptLPSolver;
  export default solver;
}
