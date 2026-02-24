import { DatabaseService } from '../services/database.service.js';

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

function extractMethodNames(methods: string): string[] {
  const names: string[] = [];
  const re = /^\s+(\w+)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(methods)) !== null) {
    names.push(match[1]);
  }
  return names;
}

export async function toolShow(toolName?: string, options?: { brief?: boolean }): Promise<void> {
  const directory = process.cwd();
  const db = new DatabaseService();
  const brief = options?.brief ?? false;

  try {
    const tools = db.listTools(directory);

    if (tools.length === 0) {
      console.error('No tools installed for this directory.');
      process.exit(1);
    }

    const selectedTools = toolName
      ? tools.filter(tool => tool.name === toolName)
      : tools;

    if (toolName && selectedTools.length === 0) {
      const available = tools.map(tool => tool.name).join(', ');
      console.error(`Tool "${toolName}" is not installed in this directory. Available: ${available}`);
      process.exit(1);
    }

    const allTypes: string[] = [];
    const toolEntries: string[] = [];

    for (const tool of selectedTools) {
      const dtsFile = Bun.file(tool.dts_path);
      if (!(await dtsFile.exists())) {
        console.error(`No types found for "${tool.name}" (${tool.dts_path})`);
        continue;
      }

      const dtsContent = await dtsFile.text();
      const result = extractFromDts(dtsContent);
      if (!result) continue;

      if (brief) {
        const methodNames = extractMethodNames(result.methods);
        toolEntries.push(`  ${tool.name}: ${methodNames.join(', ')}`);
      } else {
        if (result.supportingTypes) {
          allTypes.push(result.supportingTypes);
        }
        toolEntries.push(`  '${tool.name}': {${result.methods}\n  }`);
      }
    }

    if (toolEntries.length === 0) {
      console.error('No tool interfaces generated.');
      process.exit(1);
    }

    if (brief) {
      console.log(toolEntries.join('\n'));
    } else {
      const parts: string[] = [];
      if (allTypes.length > 0) {
        parts.push(allTypes.join('\n\n'));
      }
      parts.push(`interface ToolInterface {\n${toolEntries.join('\n')}\n}`);
      console.log(parts.join('\n\n'));
    }
  } finally {
    db.close();
  }
}
