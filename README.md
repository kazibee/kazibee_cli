# Kazibee CLI

Kazibee manages tool plugins and runs tool-enabled code.

## Core Commands

```bash
kazibee --help
kazibee -V
kazibee list
kazibee list --all
kazibee info
kazibee show
kazibee show <toolName>
kazibee llm
kazibee llm <toolName>
kazibee spec
kazibee spec <SPEC_NAME>
kazibee exec
kazibee <toolName> <subcommand> [args...]
```

## Tool Lifecycle

```bash
kazibee install <name> <source>
kazibee install <name> <source> --global
kazibee install <name> <source> --skip-permissions

kazibee link <name> <path>
kazibee link <name> <path> --global
kazibee link <name> <path> --skip-permissions

kazibee remove <name>
kazibee remove <name> --global

kazibee unlink <name>
kazibee unlink <name> --global

kazibee uninstall <name>
kazibee uninstall <name> --global
```

Source formats:

- `github:owner/repo#sha`
- `github:owner/repo` (auto-resolves latest SHA)
- `owner/repo` (auto-normalized)

Permission prompt bypass:

- Use `--skip-permissions` with `install` or `link` to skip the interactive permission menu.
- Existing saved permission grants are left unchanged.

Package descriptions for `kazibee list`:

- Add `kazibee.description` in a tool package's `package.json` for LLM-oriented usage guidance.
- If `kazibee.description` is missing, Kazibee falls back to top-level `description`.

## Environment Variables

```bash
kazibee env <name>
kazibee env <name> KEY=VALUE
kazibee env <name> KEY1=VALUE1 KEY2=VALUE2
kazibee env <name> OLD=
kazibee env <name> KEY=VALUE --global
```

Notes:

- Use `KEY=VALUE` to set env vars.
- Use `KEY=` to delete env vars.
- `--global` applies the edits to global scope instead of the current directory.

## Tool Command Output

- `kazibee <toolName> <subcommand> [args...]` does not auto-print arbitrary return values.
- For visible output, tool commands should print to stdout (for example, `console.log(...)`).
- Returning `Record<string, string>` is reserved for env persistence behavior.

## Specs

- `kazibee spec` prints available built-in spec names.
- `kazibee spec <SPEC_NAME>` prints the full spec document.
- Built-in specs live in `specs/` and are statically embedded at build/compile time.
- General notes and non-exported docs live in `docs/`.
