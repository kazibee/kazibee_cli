import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { createCliInstance } from '../create-instance.js';
import kazibeeLlm from '../../llm.txt';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

export async function toolLlm(toolName?: string, options: JsonOption = {}): Promise<void> {
  const directory = process.cwd();
  if (!toolName) {
    await runCliCommand(
      options,
      () => ({
        directory,
        toolName: null,
        content: kazibeeLlm.endsWith('\n') ? kazibeeLlm : `${kazibeeLlm}\n`,
      }),
      ({ content }) => process.stdout.write(content),
    );
    return;
  }

  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const tool = kazi.db.getToolInstall(toolName, directory);
        if (!tool) {
          throw new CliCommandError('TOOL_NOT_INSTALLED', `Tool "${toolName}" is not installed in this directory`);
        }

        const content = [
          kazibeeLlm.endsWith('\n') ? kazibeeLlm : `${kazibeeLlm}\n`,
          '---\n\n',
          readToolLlmFile(join(tool.install_path, 'llm.txt')),
        ].join('');

        return {
          directory,
          toolName,
          content,
        };
      },
      ({ content }) => process.stdout.write(content),
    );
  } finally {
    kazi.close();
  }
}

function readToolLlmFile(path: string): string {
  if (!existsSync(path)) {
    throw new CliCommandError('LLM_NOT_FOUND', `llm.txt not found at ${path}`, { path });
  }
  const content = readFileSync(path, 'utf-8');
  return content.endsWith('\n') ? content : `${content}\n`;
}
