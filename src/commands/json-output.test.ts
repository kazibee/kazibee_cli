import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
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

function createCommandToolFixture(name = 'fixture-tool'): string {
  const toolDir = join(rootDir, name);
  const srcDir = join(toolDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(toolDir, 'package.json'),
    JSON.stringify({
      name: `@test/${name}`,
      version: '1.0.0',
      type: 'module',
      main: './src/index.ts',
      command: './src/command.ts',
      kazibee: {
        description: 'Test command fixture',
      },
    }, null, 2),
  );
  writeFileSync(
    join(srcDir, 'index.ts'),
    [
      'export default function main() {',
      '  return {};',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(srcDir, 'command.ts'),
    [
      '/** Sign in and persist credentials. */',
      'export async function login(env: Record<string, string>, ...args: string[]) {',
      '  console.log(`login:${args.join(",")}`);',
      '  return { TOKEN: args[0] ?? env.TOKEN ?? "secret-token" };',
      '}',
      '',
      '/** Print arguments without storing anything. */',
      'export async function echo(env: Record<string, string>, ...args: string[]) {',
      '  console.log(args.join(" "));',
      '}',
      '',
    ].join('\n'),
  );
  return toolDir;
}

function createAstOnlyCommandToolFixture(name = 'ast-only-tool'): string {
  const toolDir = join(rootDir, name);
  const srcDir = join(toolDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(
    join(toolDir, 'package.json'),
    JSON.stringify({
      name: `@test/${name}`,
      version: '1.0.0',
      type: 'module',
      main: './src/index.ts',
      command: './src/command.ts',
      kazibee: {
        description: 'AST-only command fixture',
      },
    }, null, 2),
  );
  writeFileSync(
    join(srcDir, 'index.ts'),
    [
      'export default function main() {',
      '  return {};',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(srcDir, 'command.ts'),
    [
      'throw new Error("command module should not execute during discovery");',
      '',
      '/** Login without importing this module. */',
      'export async function login() {',
      '  return { TOKEN: "secret-token" };',
      '}',
      '',
      '/** Logout without importing this module. */',
      'export const logout = async () => {',
      '  return undefined;',
      '};',
      '',
    ].join('\n'),
  );
  return toolDir;
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
        all: false,
        env: {
          CLIENT_ID: 'abcd****',
        },
        scopes: [],
        changes: [
          { action: 'set', key: 'CLIENT_ID' },
        ],
      },
    });
  });

  it('prints env values across all directory scopes', async () => {
    const globalSet = await runCli(['env', 'gmail', '--global', '--json', 'CLIENT_ID=global']);
    const localSet = await runCli(['env', 'gmail', '--json', 'CLIENT_ID=local', 'TOKEN=secret']);
    const result = await runCli(['env', 'gmail', '--all', '--json']);

    expect(globalSet.exitCode).toBe(0);
    expect(localSet.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: true,
      data: {
        toolName: 'gmail',
        directory: null,
        global: false,
        all: true,
        env: {},
        scopes: [
          {
            directory: '/',
            global: true,
            env: {
              CLIENT_ID: 'glob****',
            },
          },
          {
            directory: cwd,
            global: false,
            env: {
              CLIENT_ID: 'loca****',
              TOKEN: 'secr****',
            },
          },
        ],
        changes: [],
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

  it('lists tool commands as structured JSON', async () => {
    const toolDir = createCommandToolFixture();
    const link = await runCli(['link', 'fixture', toolDir, '--skip-permissions', '--json']);
    const result = await runCli(['commands', 'fixture', '--json']);

    expect(link.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: true,
      data: {
        directory: cwd,
        toolName: 'fixture',
        commandName: null,
        tools: [
          {
            toolName: 'fixture',
            commands: [
              { name: 'echo', description: 'Print arguments without storing anything.' },
              { name: 'login', description: 'Sign in and persist credentials.' },
            ],
          },
        ],
      },
    });
  });

  it('discovers commands by parsing the command module without executing it', async () => {
    const toolDir = createAstOnlyCommandToolFixture();
    const link = await runCli(['link', 'astfixture', toolDir, '--skip-permissions', '--json']);
    const result = await runCli(['commands', 'astfixture', '--json']);

    expect(link.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(parseJson(result.stdout)).toEqual({
      ok: true,
      data: {
        directory: cwd,
        toolName: 'astfixture',
        commandName: null,
        tools: [
          {
            toolName: 'astfixture',
            commands: [
              { name: 'login', description: 'Login without importing this module.' },
              { name: 'logout', description: 'Logout without importing this module.' },
            ],
          },
        ],
      },
    });
  });

  it('treats command and commands as equivalent discovery routes', async () => {
    const toolDir = createCommandToolFixture();
    const link = await runCli(['link', 'fixture', toolDir, '--skip-permissions', '--json']);
    const singular = await runCli(['command', 'fixture', 'login', '--json']);
    const plural = await runCli(['commands', 'fixture', 'login', '--json']);

    expect(link.exitCode).toBe(0);
    expect(singular.exitCode).toBe(0);
    expect(plural.exitCode).toBe(0);
    expect(singular.stderr).toBe('');
    expect(plural.stderr).toBe('');
    expect(parseJson(singular.stdout)).toEqual(parseJson(plural.stdout));
    expect(parseJson(singular.stdout)).toEqual({
      ok: true,
      data: {
        directory: cwd,
        toolName: 'fixture',
        commandName: 'login',
        tools: [
          {
            toolName: 'fixture',
            commands: [
              { name: 'login', description: 'Sign in and persist credentials.' },
            ],
          },
        ],
      },
    });
  });

  it('runs tool commands only through the unprefixed shortcut', async () => {
    const toolDir = createCommandToolFixture();
    const link = await runCli(['link', 'fixture', toolDir, '--skip-permissions', '--json']);
    const result = await runCli(['fixture', 'login', 'secret-token']);
    const env = await runCli(['env', 'fixture', '--json']);

    expect(link.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('login:secret-token');
    expect(result.stdout).toContain('Stored env vars for "fixture": TOKEN');
    expect(parseJson(env.stdout)).toEqual({
      ok: true,
      data: {
        toolName: 'fixture',
        directory: cwd,
        global: false,
        all: false,
        env: {
          TOKEN: 'secr****',
        },
        scopes: [],
        changes: [],
      },
    });
  });

  it('stores direct tool command env globally when --global is passed', async () => {
    const toolDir = createCommandToolFixture();
    const link = await runCli(['link', 'fixture', toolDir, '--skip-permissions', '--json']);
    const result = await runCli(['fixture', 'login', 'global-token', '--global']);
    const localEnv = await runCli(['env', 'fixture', '--json']);
    const globalEnv = await runCli(['env', 'fixture', '--global', '--json']);

    expect(link.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('login:global-token');
    expect(result.stdout).toContain('Stored env vars for "fixture": TOKEN');
    expect(parseJson(localEnv.stdout)).toEqual({
      ok: true,
      data: {
        toolName: 'fixture',
        directory: cwd,
        global: false,
        all: false,
        env: {},
        scopes: [],
        changes: [],
      },
    });
    expect(parseJson(globalEnv.stdout)).toEqual({
      ok: true,
      data: {
        toolName: 'fixture',
        directory: '/',
        global: true,
        all: false,
        env: {
          TOKEN: 'glob****',
        },
        scopes: [],
        changes: [],
      },
    });
  });
});
