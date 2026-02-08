# Spec: Tool Command Routing

## Overview

Tools can ship CLI commands (like `login`) alongside their sandbox API. The kazibee CLI needs to route these so the user can run:

```
kazibee <tool-name> <subcommand> [args...]
```

For example:

```
kazibee google-sheets login
```

This opens a browser, the user authorizes, and the resulting credentials are automatically stored as tool env vars. No flags, no manual copy-paste.

## CLI Structure

All commands are top-level — there is no `tool` subcommand group.

```
kazibee install <name> <source>       # install a tool
kazibee remove <name>                 # remove a tool
kazibee list                          # list installed tools
kazibee info                          # show detailed tool info
kazibee env <name> [--set K=V] [--delete K]   # manage env vars
kazibee exec                          # execute sandboxed code from stdin
kazibee <tool-name> <subcommand> [args...]  # run a tool's own command
```

## How It Works

### Tool-side contract

A tool's `package.json` has two entry points:

| Field | Purpose | Consumer |
|-------|---------|----------|
| `main` | Sandbox API — named exports called by LLM-generated code | `sandbox-worker.ts` |
| `command` | CLI commands — named exports invoked by the user | kazibee CLI (this feature) |

The `command` module exports async functions. Each named export becomes a subcommand and receives trailing CLI args:

```typescript
// src/command.ts
export async function login(...args: string[]): Promise<Record<string, string>> { ... }
export async function logout(...args: string[]): Promise<void> { ... }
```

### Return value convention

If a command function returns a `Record<string, string>`, the CLI auto-stores each key/value pair as a tool env var via `DatabaseService.setEnv()`. This is what makes `kazibee google-sheets login` a single-step setup — the function returns `{ CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN }` and the CLI persists all three.

If the function returns `void` / `undefined`, nothing is stored.

## Implementation

### Routing logic

When kazibee receives an unknown command (not `install`, `remove`, `list`, `info`, `env`, or `exec`), treat the first arg as a tool name, the second as a subcommand, and pass all remaining args through:

```
kazibee <tool-name> <subcommand> [args...]
        ^^^^^^^^^^^  ^^^^^^^^^^  ^^^^^^^^
        arg[0]       arg[1]      arg[2+]
```

Steps:

1. **Look up the tool** — `db.getToolInstall(toolName, cwd)` to get `install_path`. If not found, error: `Tool "<name>" is not installed in this directory`.

2. **Read its package.json** — `<install_path>/package.json`. Read the `command` field. If missing, error: `Tool "<name>" does not expose any commands`.

3. **Import the command module** — `await import(<install_path>/<command_field>)`. This gives you the module with named exports.

4. **Resolve the subcommand** — Look up `module[subcommand]`. If it's not a function, list available commands and exit.

5. **Call the function** — `const result = await module[subcommand](...args)`. All trailing CLI args are forwarded as strings.

6. **Auto-store env vars** — If `result` is a non-null object with string values, iterate its entries and call `db.setEnv(toolName, key, value, cwd)` for each one. Log what was stored.

### Changes to `src/index.ts`

Flatten the existing `tool` subcommand group so `install`, `remove`, `list`, `info`, and `env` are top-level commands. Then add a `command:*` catch-all for tool commands:

```typescript
program
  .command('install <name> <source>')
  .description('Install a tool (source: github:owner/repo#sha)')
  .action(toolInstall);

program
  .command('remove <name>')
  .description('Remove a tool from the current directory')
  .action(toolRemove);

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
  .action(toolEnv);

program
  .command('exec')
  .description('Execute code from stdin in a sandbox with available tools')
  .action(exec);

// Catch-all: route to tool commands
program.on('command:*', async (operands: string[]) => {
  const [toolName, subcommand, ...args] = operands;
  await runToolCommand(toolName, subcommand, args, process.cwd());
});
```

### New file: `src/commands/tool-command.ts`

```typescript
import { join } from 'path';
import { getLogger } from '@noego/logger';
import { DatabaseService } from '../services/database.service.js';

const logger = getLogger('kazibee:command');

export async function runToolCommand(
  toolName: string,
  subcommand: string,
  args: string[],
  directory: string,
): Promise<void> {
  const db = new DatabaseService();

  // 1. Look up tool
  const tool = db.getToolInstall(toolName, directory);
  if (!tool) {
    throw new Error(`Tool "${toolName}" is not installed in this directory`);
  }

  // 2. Read package.json → command field
  const pkgPath = join(tool.install_path, 'package.json');
  const pkg = await Bun.file(pkgPath).json();
  const commandEntry = pkg.command;
  if (!commandEntry) {
    throw new Error(`Tool "${toolName}" does not expose any commands`);
  }

  // 3. Import command module
  const commandPath = join(tool.install_path, commandEntry);
  const mod = await import(commandPath);

  // 4. Resolve subcommand
  if (!subcommand) {
    const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
    logger.info(`Available commands for "${toolName}": ${available.join(', ')}`);
    return;
  }

  const fn = mod[subcommand];
  if (typeof fn !== 'function') {
    const available = Object.keys(mod).filter(k => typeof mod[k] === 'function');
    throw new Error(
      `Unknown command "${subcommand}" for tool "${toolName}". Available: ${available.join(', ')}`
    );
  }

  // 5. Call it with all trailing args
  const result = await fn(...args);

  // 6. Auto-store env vars if result is Record<string, string>
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string') {
        db.setEnv(toolName, key, value, directory);
      }
    }
    const keys = Object.keys(result).filter(k => typeof result[k] === 'string');
    logger.info(`Stored env vars for "${toolName}": ${keys.join(', ')}`);
  }
}
```

### Files to touch

| File | Change |
|------|--------|
| `src/index.ts` | Flatten `tool` subcommand group to top-level + add `command:*` handler |
| `src/commands/tool-command.ts` | New file — the routing logic above |

No changes to `DatabaseService`, `ToolService`, or `@bashly/core` needed.

## Reference example

**Repo:** `git@github.com:kazibee/google-sheets.git`
**Local path:** `/Users/shavauhngabay/dev/noego_manager/workerbee_packages/google-sheets/`

```
package.json      ← "command": "./src/command.ts"
src/command.ts    ← exports login(...args) → { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN }
src/index.ts      ← sandbox API (main): readRange, writeRange, etc.
```

The `login()` function bundles its own OAuth client ID/secret, opens the browser, receives the callback, and returns all three env vars. The CLI stores them. After that, `kazibee exec` can run LLM code that calls the sandbox API and the secrets are already in place.

## Full user flow

```bash
# Install
kazibee install google-sheets github:kazibee/google-sheets#10994c8edffe84677beb19fd3b963e93694a9baa

# Login (opens browser, stores credentials automatically)
kazibee google-sheets login

# Use via sandbox
echo 'const data = await tools["google-sheets"].readRange("SHEET_ID", "A1:C10"); console.log(data);' | kazibee exec
```

## Error cases

| Scenario | Message |
|----------|---------|
| Tool not installed | `Tool "<name>" is not installed in this directory` |
| No `command` field in package.json | `Tool "<name>" does not expose any commands` |
| Unknown subcommand | `Unknown command "<sub>" for tool "<name>". Available: login, ...` |
| No subcommand given | List available commands |
| Command function throws | Propagate the error message to the user |
