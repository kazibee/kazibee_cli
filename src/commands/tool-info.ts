import { createCliInstance } from '../create-instance.js';

export async function toolInfo(): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    const tools = kazi.tools.info(directory);

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
          console.log(`    ${key}=${tool.env[key].slice(0, 4)}****`);
        }
      } else {
        console.log('  Env:    (none)');
      }
    }
  } finally {
    kazi.close();
  }
}
