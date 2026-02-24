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
import { toolLlm } from './commands/tool-llm';
import { toolSpec } from './commands/tool-spec';
import { exec } from './commands/exec.js';
import { runToolCommand } from './commands/tool-command.js';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('kazibee')
    .description('kazibee - tool management and sandboxed execution CLI')
    .version('0.1.0');

  program
    .command('install <name> <source>')
    .description('Install a tool from GitHub (source: github:owner/repo#sha)')
    .option('-g, --global', 'Install globally (available in all directories)')
    .action(toolInstall);

  program
    .command('link <name> <path>')
    .description('Link a local tool directory for development')
    .option('-g, --global', 'Link globally (available in all directories)')
    .action(toolLink);

  program
    .command('remove <name>')
    .description('Remove a tool registration (keeps files)')
    .option('-g, --global', 'Remove from global scope')
    .action(toolRemove);

  program
    .command('unlink <name>')
    .description('Unlink a local tool registration')
    .option('-g, --global', 'Unlink from global scope')
    .action(toolUnlink);

  program
    .command('uninstall <name>')
    .description('Uninstall a GitHub-installed tool (removes registration and files)')
    .option('-g, --global', 'Uninstall from global scope')
    .action(toolUninstall);

  program
    .command('list')
    .description('List tools available in the current directory')
    .action(toolList);

  program
    .command('info')
    .description('Show detailed info for all tools in the current directory')
    .action(toolInfo);

  program
    .command('env <name>')
    .description('Manage environment variables for a tool')
    .option('--set <pairs...>', 'Set env vars (KEY=VALUE)')
    .option('--delete <keys...>', 'Delete env vars')
    .option('-g, --global', 'Manage env vars in global scope')
    .action(toolEnv);

  program
    .command('show [toolName]')
    .description('Print the combined .d.ts interface for all tools or a specific tool')
    .option('-b, --brief', 'Show only method names (no full signatures or types)')
    .action(toolShow);

  program
    .command('llm [toolName]')
    .description('Print llm.txt from the current repo or from an installed tool')
    .action(toolLlm);

  program
    .command('spec [specName]')
    .description('List available specs or print a specific spec document')
    .action(toolSpec);

  program
    .command('exec')
    .description('Execute code from stdin in a sandbox with available tools')
    .action(exec);

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
