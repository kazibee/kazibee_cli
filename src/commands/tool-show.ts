import { readFileSync, existsSync } from 'fs';
import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

function extractFromDts(dtsContent: string): { supportingTypes: string; methods: string } | null {
  const mainIdx = dtsContent.indexOf('declare function main(');
  if (mainIdx === -1) return null;

  // Everything before `declare function main` is supporting types
  const rawTypes = dtsContent.slice(0, mainIdx);

  // Clean supporting types: remove Env, export keywords, export aliases
  const supportingTypes = rawTypes
    .replace(/export interface Env \{[^}]*\}\n*/g, '')
    .replace(/^export /gm, '')
    .trim();

  // Extract return type body via brace matching
  const openBrace = dtsContent.indexOf('{', dtsContent.indexOf('):', mainIdx));
  if (openBrace === -1) return null;

  let depth = 1;
  let i = openBrace + 1;
  while (i < dtsContent.length && depth > 0) {
    if (dtsContent[i] === '{') depth++;
    if (dtsContent[i] === '}') depth--;
    i++;
  }

  const methods = dtsContent.slice(openBrace + 1, i - 1).trimEnd();

  return { supportingTypes, methods };
}

export async function toolShow(toolName?: string, options: JsonOption = {}): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      () => {
        const tools = kazi.db.listTools(directory);

        if (tools.length === 0) {
          throw new CliCommandError('NO_TOOLS', 'No tools installed for this directory.');
        }

        const selectedTools = toolName
          ? tools.filter(tool => tool.name === toolName)
          : tools;

        if (toolName && selectedTools.length === 0) {
          const available = tools.map(tool => tool.name);
          throw new CliCommandError(
            'TOOL_NOT_INSTALLED',
            `Tool "${toolName}" is not installed in this directory. Available: ${available.join(', ')}`,
            { available },
          );
        }

        const allTypes: string[] = [];
        const toolEntries: string[] = [];
        const missingTypes: Array<{ toolName: string; dtsPath: string }> = [];

        for (const tool of selectedTools) {
          if (!existsSync(tool.dts_path)) {
            missingTypes.push({ toolName: tool.name, dtsPath: tool.dts_path });
            continue;
          }

          const dtsContent = readFileSync(tool.dts_path, 'utf-8');
          const result = extractFromDts(dtsContent);
          if (!result) continue;

          if (result.supportingTypes) {
            allTypes.push(result.supportingTypes);
          }
          toolEntries.push(`  '${tool.name}': {${result.methods}\n  }`);
        }

        if (toolEntries.length === 0) {
          throw new CliCommandError('NO_TOOL_INTERFACES', 'No tool interfaces generated.', { missingTypes });
        }

        const parts: string[] = [];
        if (allTypes.length > 0) {
          parts.push(allTypes.join('\n\n'));
        }
        parts.push(`interface ToolInterface {\n${toolEntries.join('\n')}\n}`);

        return {
          directory,
          toolName: toolName ?? null,
          content: parts.join('\n\n'),
          missingTypes,
        };
      },
      ({ content, missingTypes }) => {
        for (const item of missingTypes) {
          console.error(`No types found for "${item.toolName}" (${item.dtsPath})`);
        }
        console.log(content);
      },
    );
  } finally {
    kazi.close();
  }
}
