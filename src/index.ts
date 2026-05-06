#!/usr/bin/env bun
import 'reflect-metadata';
import { Command } from 'commander';
import { getLogger } from '@noego/logger';

import './container.js';
import { toolInstall } from './commands/tool-install.js';
import { toolLink } from './commands/tool-link.js';
import { toolRemove } from './commands/tool-remove.js';
import { toolUnlink } from './commands/tool-unlink.js';
import { toolUninstall } from './commands/tool-uninstall.js';
import { toolList } from './commands/tool-list.js';
import { toolInfo } from './commands/tool-info.js';
import { toolEnv } from './commands/tool-env.js';
import { toolShow } from './commands/tool-show.js';
import { toolLlm } from './commands/tool-llm.js';
import { toolSpec } from './commands/tool-spec.js';
import { exec } from './commands/exec.js';
import { runToolCommand } from './commands/tool-command.js';
import { usage } from './commands/usage.js';
import { log } from './commands/log.js';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('kazibee')
    .description(
      'kazibee - tool management and sandboxed execution CLI\n\n' +
      'IMPORTANT: Before using any tool, read its documentation first:\n' +
      '  kazibee llm              Read the llm.txt for the current project\n' +
      '  kazibee llm <toolName>   Read the llm.txt for a specific tool\n' +
      '  kazibee show             Print the .d.ts interface for all tools\n' +
      '  kazibee show <toolName>  Print the .d.ts interface for a specific tool\n\n' +
      'Always run "kazibee llm <tool>" and "kazibee show <tool>" before working\n' +
      'with a tool to understand its API, types, capabilities, and usage patterns.'
    )
    .version('0.1.0');

  program
    .command('install <name> <source>')
    .description('Install a tool from GitHub (source: github:owner/repo#sha)')
    .option('-g, --global', 'Install globally (available in all directories)')
    .option('--skip-permissions', 'Skip interactive permission prompts and keep existing permission grants unchanged')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolInstall);

  program
    .command('link <name> <path>')
    .description('Link a local tool directory for development')
    .option('-g, --global', 'Link globally (available in all directories)')
    .option('--skip-permissions', 'Skip interactive permission prompts and keep existing permission grants unchanged')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolLink);

  program
    .command('remove <name>')
    .description('Remove a tool registration (keeps files)')
    .option('-g, --global', 'Remove from global scope')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolRemove);

  program
    .command('unlink <name>')
    .description('Unlink a local tool registration')
    .option('-g, --global', 'Unlink from global scope')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolUnlink);

  program
    .command('uninstall <name>')
    .description('Uninstall a GitHub-installed tool (removes registration and files)')
    .option('-g, --global', 'Uninstall from global scope')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolUninstall);

  program
    .command('list')
    .description('List tools available in the current directory')
    .option('-a, --all', 'List all registered tools across all directories')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolList);

  program
    .command('info')
    .description('Show detailed info for all tools in the current directory')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolInfo);

  program
    .command('env <name>')
    .description('Manage environment variables for a tool')
    .option('-g, --global', 'Manage env vars in global scope')
    .option('--json', 'Print machine-readable JSON output')
    .argument('[pairs...]', 'Env entries as KEY=VALUE; use KEY= to delete')
    .action(toolEnv);

  program
    .command('show [toolName]')
    .description('Print the combined .d.ts interface for all tools or a specific tool')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolShow);

  program
    .command('llm [toolName]')
    .description('Print llm.txt from the current repo or from an installed tool')
    .option('--json', 'Print machine-readable JSON output')
    .action(toolLlm);

  program
    .command('spec [specName]')
    .description('List available specs or print a specific spec document')
    .action(toolSpec);

  program
    .command('exec')
    .description(
      'Execute code from stdin in a sandbox with available tools\n\n' +
      'Code must be piped via stdin — file path arguments are not supported.\n\n' +
      'Examples:\n' +
      "  kazibee exec <<'EOF'\n" +
      '  const result = await tools["chrome-browser"].navigate("https://example.com");\n' +
      '  return result;\n' +
      '  EOF\n\n' +
      '  echo \'return await tools["gmail"].send({to: "a@b.com", subject: "hi"})\' | kazibee exec'
    )
    .action(exec);

  program
    .command('log')
    .description('Show the current log file path')
    .option('--file', 'Print the log file path')
    .action(log);

  program
    .command('usage [target]')
    .description('Print tool usage documentation, optionally formatted for an agent platform (claude, codex)')
    .option('--install', 'Write the skill file to the target platform directory')
    .action(usage);

  // Route unknown commands to tool-command handler before Commander parses.
  // Commander's command:* event doesn't fire when registered commands exist —
  // it calls unknownCommand() (which exits) before checking listeners.
  const knownCommands = new Set(program.commands.map(cmd => cmd.name()));
  knownCommands.add('help'); // Commander built-in

  const firstArg = process.argv[2];

  if (firstArg && !firstArg.startsWith('-') && !knownCommands.has(firstArg)) {
    await runToolCommand(firstArg, process.argv[3], process.argv.slice(4), process.cwd());
  } else {
    program.parse();
  }
}

main().catch(error => {
  getLogger('kazibee').error(String(error));
  process.exit(1);
});
