import { getLogger } from '@noego/logger';
import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';

const logger = getLogger('kazibee:cmd:tool-env');

export async function toolEnv(
  name: string,
  options: { set?: string[]; delete?: string[]; global?: boolean },
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const db = new DatabaseService();

  try {
    const toolService = new ToolService(db);

    if (options.set) {
      for (const pair of options.set) {
        const eqIndex = pair.indexOf('=');
        if (eqIndex === -1) {
          console.error(`Invalid format: "${pair}". Expected KEY=VALUE`);
          process.exit(1);
        }
        const key = pair.slice(0, eqIndex);
        const value = pair.slice(eqIndex + 1);
        toolService.setEnv(name, key, value, directory);
        console.log(`Set ${key} for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
      }
    }

    if (options.delete) {
      for (const key of options.delete) {
        const deleted = toolService.deleteEnv(name, key, directory);
        if (deleted) {
          console.log(`Deleted ${key} from tool "${name}" in ${directory === '/' ? 'global' : directory}`);
        } else {
          console.error(`Env var ${key} not found for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
        }
      }
    }

    // Show current env if no mutations
    if (!options.set && !options.delete) {
      const env = toolService.getEnvAtDirectory(name, directory);
      const keys = Object.keys(env);
      if (keys.length === 0) {
        console.log(`No env vars for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
      } else {
        console.log(`Env vars for tool "${name}" in ${directory === '/' ? 'global' : directory}:`);
        for (const key of keys) {
          console.log(`  ${key}=${env[key].slice(0, 4)}****`);
        }
      }
    }
  } finally {
    db.close();
  }
}
