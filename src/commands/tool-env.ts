import { createCliInstance } from '../create-instance.js';

export async function toolEnv(
  name: string,
  pairs: string[] = [],
  options: { global?: boolean } = {},
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    if (pairs.length === 0) {
      const env = kazi.tools.getEnvAtDirectory(name, directory);
      const keys = Object.keys(env);
      if (keys.length === 0) {
        console.log(`No env vars for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
      } else {
        console.log(`Env vars for tool "${name}" in ${directory === '/' ? 'global' : directory}:`);
        for (const key of keys) {
          console.log(`  ${key}=${env[key].slice(0, 4)}****`);
        }
      }
      return;
    }

    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        console.error(`Invalid format: "${pair}". Expected KEY=VALUE or KEY=`);
        process.exit(1);
      }

      const key = pair.slice(0, eqIndex);
      const value = pair.slice(eqIndex + 1);

      if (value === '') {
        const deleted = kazi.tools.deleteEnv(name, key, directory);
        if (deleted) {
          console.log(`Deleted ${key} from tool "${name}" in ${directory === '/' ? 'global' : directory}`);
        } else {
          console.error(`Env var ${key} not found for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
        }
        continue;
      }

      kazi.tools.setEnv(name, key, value, directory);
      console.log(`Set ${key} for tool "${name}" in ${directory === '/' ? 'global' : directory}`);
    }
  } finally {
    kazi.close();
  }
}
