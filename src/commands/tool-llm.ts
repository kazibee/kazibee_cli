import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createCliInstance } from '../create-instance.js';
import kazibeeLlm from '../../llm.txt';

function printLlmFile(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`llm.txt not found at ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  process.stdout.write(content);
  if (!content.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

export async function toolLlm(toolName?: string): Promise<void> {
  if (!toolName) {
    process.stdout.write(kazibeeLlm);
    if (!kazibeeLlm.endsWith('\n')) {
      process.stdout.write('\n');
    }
    return;
  }

  // Always print global guide first so critical rules (heredoc, incremental
  // calls, API accuracy) are seen even when the LLM only reads tool-specific docs.
  process.stdout.write(kazibeeLlm);
  if (!kazibeeLlm.endsWith('\n')) {
    process.stdout.write('\n');
  }
  process.stdout.write('\n---\n\n');

  const kazi = createCliInstance();

  try {
    const tool = kazi.db.getToolInstall(toolName, process.cwd());
    if (!tool) {
      console.error(`Tool "${toolName}" is not installed in this directory`);
      process.exit(1);
    }
    printLlmFile(join(tool.install_path, 'llm.txt'));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    kazi.close();
  }
}
