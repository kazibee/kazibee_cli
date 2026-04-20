import { join } from 'path';
import { readFileSync } from 'fs';
import { getLogger } from '@noego/logger';
import { createCliInstance } from '../create-instance.js';

const logger = getLogger('kazibee:cmd:tool-command');

export async function runToolCommand(
  toolName: string,
  subcommand: string | undefined,
  args: string[],
  directory: string,
): Promise<void> {
  const kazi = createCliInstance();

  try {
    // 1. Look up tool
    const tool = kazi.db.getToolInstall(toolName, directory);
    if (!tool) {
      throw new Error(`Tool "${toolName}" is not installed in this directory`);
    }

    // 2. Read package.json -> command field
    const pkgPath = join(tool.install_path, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const commandEntry = pkg.command;
    if (!commandEntry) {
      throw new Error(`Tool "${toolName}" does not expose any commands`);
    }

    // 3. Import command module
    const commandPath = join(tool.install_path, commandEntry as string);
    const mod = await import(commandPath);

    // 4. Resolve subcommand
    if (!subcommand) {
      const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
      console.log(`Available commands for "${toolName}": ${available.join(', ')}`);
      return;
    }

    const fn = mod[subcommand];
    if (typeof fn !== 'function') {
      const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
      throw new Error(
        `Unknown command "${subcommand}" for tool "${toolName}". Available: ${available.join(', ')}`,
      );
    }

    // 5. Resolve env (SYSTEM -> GLOBAL -> LOCAL priority) and call command
    const systemEnv = kazi.db.getSetupEnv(toolName, tool.owner, tool.repo);
    const globalEnv = kazi.db.getGlobalEnv(toolName);
    const localEnv = kazi.db.getLocalEnv(toolName, tool.directory);
    const env = { ...systemEnv, ...globalEnv, ...localEnv };

    const result = await fn(env, ...args);

    // 6. Auto-store env vars if result is Record<string, string>
    //    Store against the tool's registered directory so env vars are found
    //    wherever the tool is visible (e.g. "/" for global installs).
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string') {
          kazi.db.setEnv(toolName, key, value, tool.directory);
        }
      }
      const keys = Object.keys(result).filter(k => typeof result[k] === 'string');
      console.log(`Stored env vars for "${toolName}": ${keys.join(', ')}`);
    }
  } finally {
    kazi.close();
  }
}
