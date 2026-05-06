import { createCliInstance } from '../create-instance.js';
import { type JsonOption, maskValue, runCliCommand } from '../utils/cli-output.js';

interface ToolInfoOptions extends JsonOption {}

export async function toolInfo(options: ToolInfoOptions = {}): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => ({
        directory,
        tools: kazi.tools.info(directory).map(tool => ({
          name: tool.name,
          source: tool.source,
          sourceType: tool.sourceType,
          env: Object.fromEntries(Object.entries(tool.env).map(([key, value]) => [key, maskValue(value)])),
          dtsPath: tool.dtsPath,
        })),
      }),
      ({ tools }) => {
        if (tools.length === 0) {
          console.log('No tools installed for this directory.');
          return;
        }

        for (const tool of tools) {
          console.log(`Tool: ${tool.name}`);
          console.log(`  Source: ${tool.source}`);
          console.log(`  Types:  ${tool.dtsPath}`);

          const envKeys = Object.keys(tool.env);
          if (envKeys.length > 0) {
            console.log('  Env:');
            for (const key of envKeys) {
              console.log(`    ${key}=${tool.env[key]}`);
            }
          } else {
            console.log('  Env:    (none)');
          }
        }
      },
    );
  } finally {
    kazi.close();
  }
}
