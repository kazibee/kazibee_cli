import { getLogger } from '@noego/logger';
import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';

const logger = getLogger('kazibee:cmd:tool-list');

export async function toolList(): Promise<void> {
  const directory = process.cwd();
  const db = new DatabaseService();

  try {
    const toolService = new ToolService(db);
    const tools = toolService.list(directory);

    if (tools.length === 0) {
      console.log('No tools installed for this directory.');
      return;
    }

    console.log(`Tools for ${directory}:`);
    for (const tool of tools) {
      const source = tool.sourceType === 'github'
        ? `github:${tool.owner}/${tool.repo}#${tool.sha.slice(0, 8)}`
        : tool.sourceRef;
      console.log(`  ${tool.name} — ${source} (from ${tool.directory})`);
    }
  } finally {
    db.close();
  }
}
