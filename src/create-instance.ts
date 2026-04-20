import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { spawn } from 'child_process';
import { createKazibee, type KazibeeInstance } from '@kazibee/core';
import { createBunSqliteDriver } from './drivers/bun-sqlite.driver.js';
import { createClackPermissionPrompter } from './prompters/clack-permission.prompter.js';
import { createCoreLoggerAdapter } from './utils/core-logger-adapter.js';

const DB_DIR = join(homedir(), '.kazibee');
const DB_PATH = join(DB_DIR, 'db.sqlite');

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export function createCliInstance(): KazibeeInstance {
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  const driver = createBunSqliteDriver(DB_PATH);
  const logger = createCoreLoggerAdapter('kazibee:core');

  return createKazibee(
    {
      database: driver,
      logger,
      permissionPrompter: createClackPermissionPrompter(),
      fs: {
        async readFile(path: string): Promise<string> {
          return readFileSync(path, 'utf-8');
        },
        async writeFile(path: string, content: string): Promise<void> {
          writeFileSync(path, content, 'utf-8');
        },
        async exists(path: string): Promise<boolean> {
          return existsSync(path);
        },
        async mkdir(path: string): Promise<void> {
          mkdirSync(path, { recursive: true });
        },
        async remove(path: string): Promise<void> {
          rmSync(path, { recursive: true, force: true });
        },
      },
      runCommand,
      getEnvVar(key: string): string | undefined {
        return process.env[key];
      },
      importModule(path: string): Promise<unknown> {
        return import(path);
      },
    },
    {
      dbPath: DB_PATH,
    },
  );
}
