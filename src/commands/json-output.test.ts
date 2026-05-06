import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

let homeDir: string;
let cwd: string;
let rootDir: string;
const projectRoot = process.cwd();

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'kazibee-json-test-'));
  homeDir = join(rootDir, 'home');
  cwd = join(rootDir, 'workspace');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  homeDir = realpathSync(homeDir);
  cwd = realpathSync(cwd);
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<CliRunResult> {
  const proc = Bun.spawn({
    cmd: ['bun', 'run', join(projectRoot, 'src/index.ts'), ...args],
    cwd,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout);
}

describe('kazibee --json output', () => {
  it('prints an empty tool list as a success object', async () => {
    const result = await runCli(['list', '--json']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: true,
      data: {
        directory: cwd,
        all: false,
        tools: [],
      },
    });
  });

  it('prints masked env values as structured data', async () => {
    const result = await runCli(['env', 'gmail', '--json', 'CLIENT_ID=abcdef']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: true,
      data: {
        toolName: 'gmail',
        directory: cwd,
        global: false,
        env: {
          CLIENT_ID: 'abcd****',
        },
        changes: [
          { action: 'set', key: 'CLIENT_ID' },
        ],
      },
    });
  });

  it('prints JSON errors without stderr noise', async () => {
    const result = await runCli(['show', '--json']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'NO_TOOLS',
        message: 'No tools installed for this directory.',
      },
    });
  });
});
