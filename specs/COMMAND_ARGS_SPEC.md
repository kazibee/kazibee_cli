# Spec: Tool Command Arguments

## Status

Accepted. This is the developer-facing contract for CLI argument forwarding to tool commands.

## Goal

Allow tool authors to define commands that accept any number of user-provided parameters.

## Command Shape

Kazibee routes unknown top-level commands using this form:

```bash
kazibee <tool-name> <subcommand> [args...]
```

Examples:

```bash
kazibee chrome-browser open https://example.com
kazibee chrome-browser open https://example.com --new-tab --timeout 5000
```

## Forwarding Contract

1. Kazibee treats:
   - first token as `toolName`
   - second token as `subcommand`
   - all remaining tokens as `args: string[]`
2. Kazibee invokes tool subcommands as:
   - `await fn(...args)`
3. Kazibee does not parse tool-level flags.
   - Tokens are forwarded exactly as shell-tokenized argv strings.

## Tool Author Contract

Tool `package.json` must include:

- `command`: module path for command exports

Each command export should accept variadic string args:

```ts
export async function open(...args: string[]): Promise<void> {
  const [url, ...rest] = args;
}
```

Notes:

- Existing zero-arg functions remain compatible; extra JS arguments are ignored.
- Tool authors are responsible for parsing/validating args (`--flags`, positionals, etc.).

## Env Persistence Contract

If a command returns `Record<string, string>`, Kazibee stores each key/value as tool env for that tool scope.

If a command returns `void`/`undefined`, no env values are stored.

## Output Contract

- Kazibee does not auto-print arbitrary return values for tool subcommands.
- To show output to users, command implementations must print to stdout (for example, `console.log(...)`).
- Returning arrays/objects is allowed, but they will not be shown unless the command also prints them.
- Returning `Record<string, string>` triggers env persistence behavior; it should not be used as generic output.

## Example Mapping

Input:

```bash
kazibee chrome-browser open https://example.com --new-tab
```

Resolved call:

```ts
open("https://example.com", "--new-tab")
```

Output example:

```ts
export async function open(...args: string[]): Promise<number[]> {
  const result = [1, 2, 3];
  console.log(result); // visible to user
  return result; // not auto-printed by Kazibee
}
```

## Error Behavior

- Missing tool: `Tool "<name>" is not installed in this directory`
- Missing command entry: `Tool "<name>" does not expose any commands`
- Unknown subcommand: `Unknown command "<subcommand>" for tool "<name>". Available: ...`
- Missing subcommand: print available exported command names
- Thrown command errors: propagated to user
