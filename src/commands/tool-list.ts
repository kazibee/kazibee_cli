import { createCliInstance } from '../create-instance.js';

interface ToolListOptions {
  all?: boolean;
}

export async function toolList(options: ToolListOptions = {}): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    const tools = options.all
      ? await kazi.tools.listAll()
      : await kazi.tools.list(directory);

    if (tools.length === 0) {
      if (options.all) {
        console.log('No tools registered.');
      } else {
        console.log('No tools installed for this directory.');
      }
      return;
    }

    if (options.all) {
      console.log('All registered tools:');
    } else {
      console.log(`Tools for ${directory}:`);
    }
    for (const tool of tools) {
      const source = tool.sourceType === 'github'
        ? `github:${tool.owner}/${tool.repo}#${tool.sha.slice(0, 8)}`
        : tool.sourceRef;
      const description = tool.description ?? '(no package description)';
      console.log(`  ${tool.name} — ${description}`);
      console.log(`    Source: ${source} (from ${tool.directory})`);
    }
  } finally {
    kazi.close();
  }
}
