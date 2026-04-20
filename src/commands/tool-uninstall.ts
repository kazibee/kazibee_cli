import { rmSync } from 'fs';
import { createCliInstance } from '../create-instance.js';

export async function toolUninstall(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
    const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
    if (linked) {
      console.error(`Tool "${name}" is linked. Use "kazibee unlink ${name}"`);
      process.exit(1);
    }
    if (!installed) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    const { removed, installPath, orphaned } = kazi.tools.uninstall(name, directory);

    if (!removed) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    if (orphaned && installPath) {
      rmSync(installPath, { recursive: true, force: true });
      console.log(`Tool "${name}" uninstalled and files removed`);
    } else {
      console.log(`Tool "${name}" uninstalled from ${directory === '/' ? 'global' : directory}`);
    }
  } finally {
    kazi.close();
  }
}
