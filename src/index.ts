#!/usr/bin/env bun
import { Command } from 'commander';
import { configurePackageCommands } from './commands/package-commands.js';

const program = new Command();

program
  .name('kazibee')
  .description(
    'kazibee - validate Kazibee extension packages\n\n' +
    '  kazibee validate [path]  Check the package the way the desktop app reads it\n' +
    '  kazibee spec [name]      Print the package contract (package) or authoring guide (guide)\n\n' +
    'Extensions are installed from GitHub in the desktop app (Settings → Tools), which\n' +
    'also generates their TypeScript API. Commit only your source.',
  )
  .version('0.3.0');

configurePackageCommands(program);

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
