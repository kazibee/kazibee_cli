import { getLogger } from '@noego/logger';
import { DatabaseService } from '../services/database.service.js';
import { ExecService } from '../services/exec.service.js';

const logger = getLogger('kazibee:cmd:exec');

export async function exec(): Promise<void> {
  const directory = process.cwd();

  // Read code from stdin
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const code = Buffer.concat(chunks).toString('utf-8').trim();

  if (!code) {
    console.error('No code provided on stdin');
    process.exit(1);
  }

  const db = new DatabaseService();

  try {
    const execService = new ExecService(db);
    const result = await execService.execute(code, directory);

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
    db.close();
  }
}
