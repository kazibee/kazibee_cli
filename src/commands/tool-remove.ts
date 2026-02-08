import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';

export async function toolRemove(name: string, options: { global?: boolean }): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const db = new DatabaseService();

  try {
    const toolService = new ToolService(db);
    const { removed } = toolService.remove(name, directory);

    if (removed) {
      console.log(`Tool "${name}" removed from ${directory === '/' ? 'global' : directory}`);
    } else {
      console.error(`Tool "${name}" not found in ${directory === '/' ? 'global' : directory}`);
      process.exit(1);
    }
  } finally {
    db.close();
  }
}
