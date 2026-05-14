import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, maskValue, runCliCommand } from '../utils/cli-output.js';

interface EnvScopeOutput {
  directory: string;
  global: boolean;
  env: Record<string, string>;
}

interface EnvScopeSource {
  getEnvScopes?: (toolName: string) => Array<{ directory: string; env: Record<string, string> }>;
}

interface EnvOutput {
  toolName: string;
  directory: string | null;
  global: boolean;
  all: boolean;
  env: Record<string, string>;
  scopes: EnvScopeOutput[];
  changes: Array<{ action: 'set' | 'delete'; key: string; deleted?: boolean }>;
}

export async function toolEnv(
  name: string,
  pairs: string[] = [],
  options: { global?: boolean; all?: boolean } & JsonOption = {},
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand<EnvOutput>(
      options,
      async () => {
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

        if (options.all === true) {
          const source = kazi.tools as EnvScopeSource;
          const scopes = source.getEnvScopes
            ? source.getEnvScopes(name).map(toEnvScopeOutput)
            : await getEnvScopesFromRegisteredTools(name);
          return {
            toolName: name,
            directory: null,
            global: false,
            all: true,
            env: {},
            scopes,
            changes,
          } satisfies EnvOutput;
        }

        const env = kazi.tools.getEnvAtDirectory(name, directory);
        return {
          toolName: name,
          directory,
          global: options.global === true,
          all: false,
          env: maskEnv(env),
          scopes: [],
          changes,
        } satisfies EnvOutput;
      },
      ({ env, scopes, changes, all }) => {
        if (all) {
          renderAllScopes(name, scopes);
          return;
        }

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

  async function getEnvScopesFromRegisteredTools(toolName: string): Promise<EnvScopeOutput[]> {
    const tools = await kazi.tools.listAll();
    const directories = ['/', ...tools
      .filter((tool) => tool.name === toolName)
      .map((tool) => tool.directory)];
    return [...new Set(directories)]
      .map((scopeDirectory) => toEnvScopeOutput({
        directory: scopeDirectory,
        env: kazi.tools.getEnvAtDirectory(toolName, scopeDirectory),
      }))
      .filter((scope) => Object.keys(scope.env).length > 0);
  }
}

function maskEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, maskValue(value)]));
}

function toEnvScopeOutput(scope: { directory: string; env: Record<string, string> }): EnvScopeOutput {
  return {
    directory: scope.directory,
    global: scope.directory === '/',
    env: maskEnv(scope.env),
  };
}

function renderAllScopes(name: string, scopes: EnvScopeOutput[]): void {
  if (scopes.length === 0) {
    console.log(`No env vars for tool "${name}" in any scope`);
    return;
  }

  console.log(`Env vars for tool "${name}" across all scopes:`);
  for (const scope of scopes) {
    const label = scope.global ? 'global' : scope.directory;
    console.log(`\n${label}:`);
    for (const [key, value] of Object.entries(scope.env)) {
      console.log(`  ${key}=${value}`);
    }
  }
}
