import { getLogger } from '@noego/logger';
import { createCliInstance } from '../create-instance.js';

const logger = getLogger('kazibee:cmd:exec');

const EXEC_USAGE = `kazibee exec reads JavaScript from stdin. File path arguments are NOT supported.

Usage:

  kazibee exec <<'EOF'
  const result = await tools["chrome-browser"].navigate("https://example.com");
  return result;
  EOF

  echo 'return await tools["gmail"].send({to: "a@b.com", subject: "hi"})' | kazibee exec`;

export async function exec(): Promise<void> {
  const directory = process.cwd();

  // Read code from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const code = Buffer.concat(chunks).toString('utf-8').trim();

  if (!code) {
    console.error(`No code provided on stdin.\n\n${EXEC_USAGE}`);
    process.exit(1);
  }

  const kazi = createCliInstance();

  try {
    const result = await kazi.exec.execute(code, directory);

    if (result.success) {
      if (result.result !== undefined) {
        console.log(JSON.stringify(result.result, null, 2));
      }
      console.log(`Completed in ${result.duration}ms`);
    } else {
      console.error(`Execution failed: ${result.error}`);
      process.exit(1);
    }
  } finally {
    kazi.close();
  }
}
