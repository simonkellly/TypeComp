import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';

export interface CPModel {
  optimize: string;

  constraints: Record<string, { min?: number; max?: number; equal?: number }>;

  variables: Record<string, Record<string, number>>;

  integers: string[];
}

export interface CPSolution {
  feasible: boolean;

  status: string;

  result: number | null;

  error?: string;

  [varName: string]: unknown;
}

const SOLVER_SCRIPT = 'solve_waves.py';

export async function solveCP(
  model: CPModel,
  scriptPath?: string,
): Promise<CPSolution> {
  const pythonScript = scriptPath ?? join(resolve(__dirname), SOLVER_SCRIPT);

  const pythonExec = join(process.cwd(), 'venv', 'bin', 'python3');

  return new Promise<CPSolution>((resolve, reject) => {
    const pythonProcess = spawn(pythonExec, [pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout = stdout + data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr = stderr + data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));

        return;
      }

      try {
        const result = JSON.parse(stdout) as CPSolution;

        resolve(result);
      } catch (_error) {
        reject(new Error(`Failed to parse solution: ${stdout}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });

    pythonProcess.stdin.write(JSON.stringify(model));
    pythonProcess.stdin.end();
  });
}

export async function isORToolsAvailable(): Promise<boolean> {
  const pythonExec = join(process.cwd(), 'venv', 'bin', 'python3');

  return new Promise<boolean>((resolve) => {
    const pythonProcess = spawn(pythonExec, ['-c', 'import ortools'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    pythonProcess.on('close', (code) => {
      resolve(code === 0);
    });

    pythonProcess.on('error', () => {
      resolve(false);
    });
  });
}
