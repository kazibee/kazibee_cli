# Kazibee CLI

Kazibee manages tool plugins and runs tool-enabled code.

## Core Commands

```bash
kazibee --help
kazibee -V
kazibee list
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

kazibee link <name> <path>
kazibee link <name> <path> --global

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

## Environment Variables

```bash
kazibee env <name>
kazibee env <name> --set KEY=VALUE
kazibee env <name> --set KEY1=VALUE1 KEY2=VALUE2
kazibee env <name> --delete KEY
kazibee env <name> --delete KEY1 KEY2
```

## Specs

- `kazibee spec` prints available built-in spec names.
- `kazibee spec <SPEC_NAME>` prints the full spec document.
- Built-in specs live in `specs/` and are statically embedded at build/compile time.
- General notes and non-exported docs live in `docs/`.
