# Kazibee Extension Package Contract v1

## Goal

A Kazibee extension is model-callable only when its package metadata, permissions, manual,
public declaration, runtime sources, and declared command entry match a validation seal
created by the Kazibee development CLI.

## Package manifest

`package.json` MUST contain:

```json
{
  "name": "@kazibee/example",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./.kazibee/index.d.ts",
  "kazibee": {
    "manifestVersion": 1,
    "id": "example",
    "brief": "One sentence describing when to use the extension.",
    "tags": ["provider", "domain", "action"],
    "manual": "./llm.txt",
    "permissions": "./permissions.json"
  }
}
```

Optional `package.json.command` names a local command module. Optional
`kazibee.commands` describes its public command exports. Every referenced path must be
relative, remain inside the package after realpath resolution, and exist.

### Discovery metadata

- `kazibee.id`: lowercase kebab-case, 1-64 characters.
- `kazibee.brief`: trimmed single line, 20-240 characters.
- `kazibee.tags`: 3-16 unique lowercase kebab-case terms.
- `package.json.description`: human-facing package description. It may differ from the
  model-facing brief.

## Permissions

`permissions.json` MUST exist. Version 1 accepts:

```json
{
  "net": ["api.example.com"],
  "env": {
    "API_KEY": "API_KEY"
  }
}
```

`net` is an optional array of unique nonempty hosts. Wildcards are forbidden.
`env` is an optional keyed object using the existing Kazibee permission-source
semantics. Legacy array-form `env` is invalid in a sealed v1 package.

## Declaration

The canonical declaration is the file referenced by `package.json.types`; v1 requires
`./.kazibee/index.d.ts`. It is generated from `package.json.main` and lives inside
`.kazibee/` alongside the seal so build artifacts never pollute the package tree.

A package can be sealed only when declaration generation succeeds and the generated
bytes exactly match the committed declaration.

## Validation seal

The seal is `.kazibee/validation.json`. It contains:

- `schemaVersion: 1`
- validator name and version
- package identity
- a sorted file inventory with role, relative path, byte count, and SHA-256
- an aggregate SHA-256 over canonical JSON containing every field except
  `contentDigest`

The inventory includes:

- `package.json`
- the declared manual and permissions files
- the canonical declaration
- the declared command module, when present
- every regular file below `src/`
- any future explicitly declared runtime asset

The seal file itself, VCS metadata, dependency directories, caches, and unrelated build
outputs are excluded.

Changing any inventoried byte invalidates the seal. The desktop verifies the seal before
exposing an extension to models and again before execution. Invalid packages remain
visible to Settings diagnostics with one of: `unsealed`, `stale`, `invalid`, or
`incompatible`.

## CLI lifecycle

```text
kazibee extension generate [path]  # writes the canonical declaration
kazibee extension validate [path]  # read-only package validation
kazibee extension seal [path]      # generate, validate, and write the seal
kazibee extension verify [path]    # read-only seal verification
kazibee extension prepare [path]   # alias for seal
```

`validate` and `verify` never mutate package files. Human and `--json` output share
stable diagnostic codes.

## Trust boundary

The v1 SHA-256 seal proves freshness after successful validation. It does not authenticate
a publisher. Publisher signatures, trust roots, rotation, and revocation are separate
future work.
