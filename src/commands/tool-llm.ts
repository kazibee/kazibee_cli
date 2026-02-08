import { join } from 'path';
import { DatabaseService } from '../services/database.service';
import kazibeeLlm from '../../llm.txt';

async function printLlmFile(path: string): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`llm.txt not found at ${path}`);
  }
  const content = await file.text();
  process.stdout.write(content);
  if (!content.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

export async function toolLlm(toolName?: string): Promise<void> {
  let db: DatabaseService | null = null;

  try {
    if (!toolName) {
      process.stdout.write(kazibeeLlm);
      if (!kazibeeLlm.endsWith('\n')) {
        process.stdout.write('\n');
      }
      return;
    }

    db = new DatabaseService();
    const tool = db.getToolInstall(toolName, process.cwd());
    if (!tool) {
      console.error(`Tool "${toolName}" is not installed in this directory`);
      process.exit(1);
    }
    await printLlmFile(join(tool.install_path, 'llm.txt'));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    db?.close();
  }
}
