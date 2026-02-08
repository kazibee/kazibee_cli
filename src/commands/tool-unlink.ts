import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';

export async function toolUnlink(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const db = new DatabaseService();

  try {
    const linked = db.getLinkedToolAtDirectory(name, directory);
    const installed = db.getInstalledToolAtDirectory(name, directory);
    if (!linked && installed) {
      console.error(`Tool "${name}" is installed from GitHub. Use "kazibee uninstall ${name}"`);
      process.exit(1);
    }
    if (!linked) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    const toolService = new ToolService(db);
    const { removed } = toolService.unlink(name, directory);

    if (!removed) {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }

    console.log(`Tool "${name}" unlinked from ${directory === '/' ? 'global' : directory}`);
  } finally {
    db.close();
  }
}
