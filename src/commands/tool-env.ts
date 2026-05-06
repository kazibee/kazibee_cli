import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, maskValue, runCliCommand } from '../utils/cli-output.js';

export async function toolEnv(
  name: string,
  pairs: string[] = [],
  options: { global?: boolean } & JsonOption = {},
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const changes: Array<{ action: 'set' | 'delete'; key: string; deleted?: boolean }> = [];
        for (const pair of pairs) {
          const eqIndex = pair.indexOf('=');
          if (eqIndex === -1) {
            throw new CliCommandError('INVALID_ENV_PAIR', `Invalid format: "${pair}". Expected KEY=VALUE or KEY=`);
          }

          const key = pair.slice(0, eqIndex);
          const value = pair.slice(eqIndex + 1);

          if (value === '') {
            const deleted = kazi.tools.deleteEnv(name, key, directory);
            changes.push({ action: 'delete', key, deleted });
            continue;
          }

          kazi.tools.setEnv(name, key, value, directory);
          changes.push({ action: 'set', key });
        }

        const env = kazi.tools.getEnvAtDirectory(name, directory);
        return {
          toolName: name,
          directory,
          global: options.global === true,
          env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, maskValue(value)])),
          changes,
        };
      },
      ({ env, changes }) => {
        const scope = directory === '/' ? 'global' : directory;
        if (changes.length === 0) {
          const keys = Object.keys(env);
          if (keys.length === 0) {
            console.log(`No env vars for tool "${name}" in ${scope}`);
          } else {
            console.log(`Env vars for tool "${name}" in ${scope}:`);
            for (const key of keys) {
              console.log(`  ${key}=${env[key]}`);
            }
          }
          return;
        }

        for (const change of changes) {
          if (change.action === 'delete') {
            if (change.deleted) {
              console.log(`Deleted ${change.key} from tool "${name}" in ${scope}`);
            } else {
              console.error(`Env var ${change.key} not found for tool "${name}" in ${scope}`);
              process.exitCode = 1;
            }
          } else {
            console.log(`Set ${change.key} for tool "${name}" in ${scope}`);
          }
        }
      },
    );
  } finally {
    kazi.close();
  }
}
