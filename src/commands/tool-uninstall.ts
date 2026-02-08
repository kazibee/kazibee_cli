import { rmSync } from 'fs';
import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';

export async function toolUninstall(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const db = new DatabaseService();

  try {
    const linked = db.getLinkedToolAtDirectory(name, directory);
    const installed = db.getInstalledToolAtDirectory(name, directory);
    if (linked) {
      console.error(`Tool "${name}" is linked. Use "kazibee unlink ${name}"`);
      process.exit(1);
    }
    if (!installed) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    const toolService = new ToolService(db);
    const { removed, installPath, orphaned } = toolService.uninstall(name, directory);

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
    db.close();
  }
}
