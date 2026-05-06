import { createCliInstance } from '../create-instance.js';
import { type JsonOption, runCliCommand } from '../utils/cli-output.js';

interface ToolListOptions extends JsonOption {
  all?: boolean;
}

export async function toolList(options: ToolListOptions = {}): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      async () => ({
        directory,
        all: options.all === true,
        tools: options.all
          ? await kazi.tools.listAll()
          : await kazi.tools.list(directory),
      }),
      ({ all, tools }) => {
        if (tools.length === 0) {
          console.log(all ? 'No tools registered.' : 'No tools installed for this directory.');
          return;
        }

        console.log(all ? 'All registered tools:' : `Tools for ${directory}:`);
        for (const tool of tools) {
          const source = tool.sourceType === 'github'
            ? `github:${tool.owner}/${tool.repo}#${tool.sha.slice(0, 8)}`
            : tool.sourceRef;
          const description = tool.description ?? '(no package description)';
          console.log(`  ${tool.name} — ${description}`);
          console.log(`    Source: ${source} (from ${tool.directory})`);
        }
      },
    );
  } finally {
    kazi.close();
  }
}
