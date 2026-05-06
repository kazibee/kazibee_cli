import { rmSync } from 'fs';
import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

export async function toolUninstall(name: string, options: { global?: boolean } & JsonOption): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
        const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
        if (linked) {
          throw new CliCommandError('TOOL_IS_LINKED', `Tool "${name}" is linked. Use "kazibee unlink ${name}"`);
        }
        if (!installed) {
          throw new CliCommandError('TOOL_NOT_FOUND', `Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
        }

        const result = kazi.tools.uninstall(name, directory);
        if (!result.removed) {
          throw new CliCommandError('TOOL_NOT_FOUND', `Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
        }

        if (result.orphaned && result.installPath) {
          rmSync(result.installPath, { recursive: true, force: true });
        }

        return {
          toolName: name,
          directory,
          global: options.global === true,
          filesRemoved: result.orphaned && !!result.installPath,
          ...result,
        };
      },
      ({ filesRemoved }) => {
        if (filesRemoved) {
          console.log(`Tool "${name}" uninstalled and files removed`);
        } else {
          console.log(`Tool "${name}" uninstalled from ${directory === '/' ? 'global' : directory}`);
        }
      },
    );
  } finally {
    kazi.close();
  }
}
