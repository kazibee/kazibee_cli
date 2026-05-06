import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

export async function toolUnlink(name: string, options: { global?: boolean } & JsonOption): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
        const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
        if (!linked && installed) {
          throw new CliCommandError('TOOL_IS_INSTALLED', `Tool "${name}" is installed from GitHub. Use "kazibee uninstall ${name}"`);
        }
        if (!linked) {
          throw new CliCommandError('TOOL_NOT_FOUND', `Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
        }

        const result = kazi.tools.unlink(name, directory);
        if (!result.removed) {
          throw new CliCommandError('TOOL_NOT_FOUND', `Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
        }

        return { toolName: name, directory, global: options.global === true, ...result };
      },
      () => console.log(`Tool "${name}" unlinked from ${directory === '/' ? 'global' : directory}`),
    );
  } finally {
    kazi.close();
  }
}
