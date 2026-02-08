import { join } from 'path';
import { getLogger } from '@noego/logger';
import { DatabaseService } from '../services/database.service.js';

const logger = getLogger('kazibee:cmd:tool-command');

export async function runToolCommand(
  toolName: string,
  subcommand: string | undefined,
  args: string[],
  directory: string,
): Promise<void> {
  const db = new DatabaseService();

  try {
    // 1. Look up tool
    const tool = db.getToolInstall(toolName, directory);
    if (!tool) {
      throw new Error(`Tool "${toolName}" is not installed in this directory`);
    }

    // 2. Read package.json → command field
    const pkgPath = join(tool.install_path, 'package.json');
    const pkg = await Bun.file(pkgPath).json();
    const commandEntry = pkg.command;
    if (!commandEntry) {
      throw new Error(`Tool "${toolName}" does not expose any commands`);
    }

    // 3. Import command module
    const commandPath = join(tool.install_path, commandEntry);
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

    // 5. Call it with all trailing CLI args
    // Existing zero-arg commands remain compatible because extra JS args are ignored.
    const result = await fn(...args);

    // 6. Auto-store env vars if result is Record<string, string>
    //    Store against the tool's registered directory so env vars are found
    //    wherever the tool is visible (e.g. "/" for global installs).
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string') {
          db.setEnv(toolName, key, value, tool.directory);
        }
      }
      const keys = Object.keys(result).filter(k => typeof result[k] === 'string');
      console.log(`Stored env vars for "${toolName}": ${keys.join(', ')}`);
    }
  } finally {
    db.close();
  }
}
