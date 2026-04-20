import { createCliInstance } from '../create-instance.js';

export async function toolUnlink(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
    const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
    if (!linked && installed) {
      console.error(`Tool "${name}" is installed from GitHub. Use "kazibee uninstall ${name}"`);
      process.exit(1);
    }
    if (!linked) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    const { removed } = kazi.tools.unlink(name, directory);

    if (!removed) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    console.log(`Tool "${name}" unlinked from ${directory === '/' ? 'global' : directory}`);
  } finally {
    kazi.close();
  }
}
