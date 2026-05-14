import { join } from 'path';
import { readFileSync } from 'fs';
import * as ts from 'typescript';
import { getLogger } from '@noego/logger';
import { createCliInstance } from '../create-instance.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

const logger = getLogger('kazibee:cmd:tool-command');

export interface ToolCommandSummary {
  name: string;
  description?: string;
}

export interface ToolCommandsOutput {
  directory: string;
  toolName: string | null;
  commandName: string | null;
  tools: Array<{
    toolName: string;
    commands: ToolCommandSummary[];
  }>;
}

export async function runToolCommand(
  toolName: string,
  rawArgs: string[],
  directory: string,
): Promise<void> {
  const kazi = createCliInstance();
  const { subcommand, args, global } = parseToolCommandArgs(rawArgs);

  try {
    // 1. Look up tool
    const tool = kazi.db.getToolInstall(toolName, directory);
    if (!tool) {
      throw new Error(`Tool "${toolName}" is not installed in this directory`);
    }

    // 2. Read package.json -> command field
    const pkgPath = join(tool.install_path, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
    const commandEntry = pkg.command;
    if (!commandEntry) {
      throw new Error(`Tool "${toolName}" does not expose any commands`);
    }

    // 3. Import command module
    const commandPath = join(tool.install_path, commandEntry as string);
    const mod = await import(commandPath);

    // 4. Resolve subcommand
    if (!subcommand) {
      const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
      console.log(`Available commands for "${toolName}": ${available.join(', ')}`);
      return;
    }

    const fn = mod[subcommand];
    if (typeof fn !== 'function') {
      const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
      throw new Error(
        `Unknown command "${subcommand}" for tool "${toolName}". Available: ${available.join(', ')}`,
      );
    }

    // 5. Resolve env (SYSTEM -> GLOBAL -> LOCAL priority) and call command
    const systemEnv = kazi.db.getSetupEnv(toolName, tool.owner, tool.repo);
    const globalEnv = kazi.db.getGlobalEnv(toolName);
    const localEnv = kazi.db.getLocalEnv(toolName, tool.directory);
    const env = { ...systemEnv, ...globalEnv, ...localEnv };

    const result = await fn(env, ...args);

    // 6. Auto-store env vars if result is Record<string, string>
    //    Store against the tool's registered directory so env vars are found
    //    wherever the tool is visible (e.g. "/" for global installs).
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const envDirectory = global ? '/' : tool.directory;
      for (const [key, value] of Object.entries(result)) {
        if (typeof value === 'string') {
          kazi.db.setEnv(toolName, key, value, envDirectory);
        }
      }
      const keys = Object.keys(result).filter(k => typeof result[k] === 'string');
      console.log(`Stored env vars for "${toolName}": ${keys.join(', ')}`);
    }
  } finally {
    kazi.close();
  }
}

function parseToolCommandArgs(rawArgs: string[]): {
  subcommand: string | undefined;
  args: string[];
  global: boolean;
} {
  let subcommand: string | undefined;
  const args: string[] = [];
  let global = false;

  for (const arg of rawArgs) {
    if (arg === '--global' || arg === '-g') {
      global = true;
      continue;
    }

    if (subcommand === undefined) {
      subcommand = arg;
      continue;
    }

    args.push(arg);
  }

  return { subcommand, args, global };
}

export async function toolCommands(
  toolName?: string,
  commandName?: string,
  options: JsonOption = {},
): Promise<void> {
  const directory = process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand<ToolCommandsOutput>(
      options,
      async () => {
        const tools = toolName
          ? [resolveTool(kazi, toolName, directory)]
          : kazi.db.listTools(directory);

        return {
          directory,
          toolName: toolName ?? null,
          commandName: commandName ?? null,
          tools: await Promise.all(tools.map(async (tool) => ({
            toolName: tool.name,
            commands: filterCommands(listToolCommands(tool.install_path), commandName),
          }))),
        };
      },
      ({ tools }) => {
        if (tools.length === 0) {
          console.log('No tools installed for this directory.');
          return;
        }

        for (const tool of tools) {
          const commandNames = tool.commands.map((command) => command.name);
          console.log(`Commands for "${tool.toolName}": ${commandNames.join(', ') || '(none)'}`);
        }
      },
    );
  } finally {
    kazi.close();
  }
}

function resolveTool(
  kazi: ReturnType<typeof createCliInstance>,
  toolName: string,
  directory: string,
) {
  const tool = kazi.db.getToolInstall(toolName, directory);
  if (!tool) {
    throw new CliCommandError(
      'TOOL_NOT_INSTALLED',
      `Tool "${toolName}" is not installed in this directory`,
      { toolName, directory },
    );
  }
  return tool;
}

function readCommandPath(installPath: string): string {
  const pkgPath = join(installPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
  const commandEntry = pkg.command;
  if (typeof commandEntry !== 'string' || commandEntry.length === 0) {
    throw new CliCommandError('NO_TOOL_COMMANDS', 'Tool does not expose any commands');
  }

  return join(installPath, commandEntry);
}

function filterCommands(commands: ToolCommandSummary[], commandName: string | undefined): ToolCommandSummary[] {
  if (!commandName) return commands;
  return commands.filter((command) => command.name === commandName);
}

function listToolCommands(installPath: string): ToolCommandSummary[] {
  const commandPath = readCommandPath(installPath);
  const sourceText = readFileSync(commandPath, 'utf-8');
  const sourceFile = ts.createSourceFile(commandPath, sourceText, ts.ScriptTarget.Latest, true);
  const commands = new Map<string, ToolCommandSummary>();

  for (const statement of sourceFile.statements) {
    const exportedFunctionName = getExportedFunctionDeclarationName(statement);
    if (exportedFunctionName) {
      commands.set(exportedFunctionName, {
        name: exportedFunctionName,
        ...readCommandDescription(sourceText, statement),
      });
      continue;
    }

    for (const exportedVariable of getExportedFunctionVariables(statement)) {
      commands.set(exportedVariable.name, {
        name: exportedVariable.name,
        ...readCommandDescription(sourceText, statement),
      });
    }
  }

  return [...commands.values()]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function getExportedFunctionDeclarationName(statement: ts.Statement): string | null {
  if (!ts.isFunctionDeclaration(statement) || !hasExportModifier(statement)) {
    return null;
  }

  return statement.name?.text ?? null;
}

function getExportedFunctionVariables(statement: ts.Statement): Array<{ name: string }> {
  if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) {
    return [];
  }

  const variables: Array<{ name: string }> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name)) continue;
    if (!declaration.initializer) continue;
    if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) continue;
    variables.push({ name: declaration.name.text });
  }
  return variables;
}

function readCommandDescription(sourceText: string, node: ts.Node): { description?: string } {
  const commentRanges = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const range = commentRanges.at(-1);
  if (!range) return {};

  const raw = sourceText.slice(range.pos, range.end);
  const description = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
    .trim();

  return description.length > 0 ? { description } : {};
}
