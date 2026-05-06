import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

export async function toolRemove(name: string, options: { global?: boolean } & JsonOption): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const result = kazi.tools.remove(name, directory);
        if (!result.removed) {
          throw new CliCommandError('TOOL_NOT_FOUND', `Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
        }
        return { toolName: name, directory, global: options.global === true, ...result };
      },
      () => console.log(`Tool "${name}" removed from ${directory === '/' ? 'global' : directory}`),
    );
  } finally {
    kazi.close();
  }
}
