# Kazibee CLI

Kazibee is the development boundary for extension packages. It generates public declarations,
validates package contracts, creates freshness seals, verifies installed content, and manages
safe local development links.

The desktop owns extension discovery, configuration, and execution. Legacy runtime commands
remain temporarily for authentication and workflow compatibility while those callers migrate.

## Extension development

```bash
kazibee extension generate [path]
kazibee extension validate [path]
kazibee extension seal [path]
kazibee extension verify [path]
kazibee extension inspect [path]
kazibee extension prepare [path]
```

- `generate` writes the canonical `dist/index.d.ts`.
- `validate` checks the package without modifying it.
- `seal` generates the declaration, validates the package, and writes
  `.kazibee/validation.json`.
- `verify` checks the current package against its seal without modifying it.
- `inspect` reports manifest and validation state.
- `prepare` is an alias for `seal`.

Every command accepts `--json` for stable machine-readable output.

The complete v1 contract is in `specs/EXTENSION_PACKAGE_SPEC.md`.

## Local development links

```bash
kazibee extension link [path]
kazibee extension link [path] --id <extension-id>
kazibee extension unlink <extension-id>
```

A package must have a current validation seal before it can be linked. Unlink removes only
the managed symlink and never deletes the source directory.

## Required package metadata

```json
{
  "name": "@kazibee/example",
  "version": "1.0.0",
  "description": "Human-facing package summary.",
  "main": "./src/index.ts",
  "types": "./dist/index.d.ts",
  "kazibee": {
    "manifestVersion": 1,
    "id": "example",
    "brief": "Model-facing sentence describing when to use the extension.",
    "tags": ["provider", "domain", "action"],
    "manual": "./llm.txt",
    "permissions": "./permissions.json"
  }
}
```

## Legacy compatibility commands

The following commands still use the legacy Kazibee runtime/database surface and are
retained during migration:

```bash
kazibee install <name> <source>
kazibee link <name> <path>
kazibee remove <name>
kazibee unlink <name>
kazibee uninstall <name>
kazibee list
kazibee info
kazibee show [toolName]
kazibee llm [toolName]
kazibee env <name> [KEY=VALUE...]
kazibee exec
kazibee <toolName> <subcommand> [args...]
```

Extension authentication manuals may continue using commands such as
`kazibee google-drive login` until the equivalent desktop workflow is verified.

## Specs

- `kazibee spec` prints available built-in spec names.
- `kazibee spec <SPEC_NAME>` prints a full spec document.
- Built-in specs live in `specs/`.
