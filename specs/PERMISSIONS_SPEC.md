# Kazibee Permissions Spec (Draft)

## Status

Draft based on product decisions captured on February 8, 2026.

## Goals

- Keep package repos simple.
- Enforce permissions in host runtime (`kazibee`), not inside tool packages.
- Let users choose what a tool can access at install time.
- Inject only explicitly granted env vars into tool `main(env)`.

## Boundary

- Tool packages receive `env` as an argument (`main(env)`).
- Tool packages do not resolve `SYSTEM` vs `GLOBAL` vs `LOCAL`.
- Source precedence and permission enforcement are runtime responsibilities in `kazibee`.

## Permission Manifest Location

Use both:

1. `permissions.json` in the tool repo.
2. Pointer in `package.json`:

```json
{
  "kazibee": {
    "permissions": "./permissions.json"
  }
}
```

Compatibility fallback:

- If pointer is missing, runtime may fallback to `./permissions.json`.

## Manifest Shape

Use keyed sections (extensible), not top-level arrays.

```json
{
  "env": {
    "GEMINI_API_KEY": ["SYSTEM:GEMINI_API_KEY", "LOCAL:GEMINI_API_KEY"],
    "OPENAI_API_KEY": "OPENAI_API_KEY",
    "CUSTOM_NAME": "GEMINI_API_KEY"
  }
}
```

### Semantics

- Manifest key is the injected env key name seen by tool code.
  - Example: `"CUSTOM_NAME": "GEMINI_API_KEY"` injects as `env.CUSTOM_NAME`.
- Manifest value defines allowed source-key candidates.

Accepted env value forms:

1. String scoped:
   - `"SYSTEM:GEMINI_API_KEY"`
   - `"GLOBAL:GEMINI_API_KEY"`
   - `"LOCAL:GEMINI_API_KEY"`
2. String unscoped:
   - `"GEMINI_API_KEY"` (means any source policy)
3. Array of candidates:
   - `["SYSTEM:GEMINI_API_KEY", "LOCAL:GEMINI_API_KEY"]`

## Source Types

- `SYSTEM`: value from `process.env`.
- `GLOBAL`: value from global persisted tool env scope.
- `LOCAL`: value from directory-scoped persisted tool env scope.

## Install-Time Permission UX

When a user installs a tool:

1. Load permission manifest.
2. Show interactive permission menu.
3. For each requested injected key, present allowed source options.
4. User selects one source option or denies.
5. Persist grants in SQLite.

If required permissions exist in future schema and user denies required entries, install must fail.

## SQLite Persistence (Conceptual)

Persist request + grant decisions per tool identity, tied to versioned install (`owner/repo/sha` or equivalent unique install identity).

Suggested concepts:

- Requested permissions (what tool asked for).
- Granted permissions (what user allowed, including selected source).
- Timestamps for auditability.

## Runtime Enforcement

At tool execution:

1. Build env for each tool on demand.
2. For each injected key, resolve only from the granted source/candidate.
3. Inject only granted keys.
4. Do not expose ungranted keys.

Important rule:

- No silent source substitution when a source is explicitly granted.
  - Example: if granted `SYSTEM:GEMINI_API_KEY` but only local exists, do not inject.

## Candidate Resolution Rules

### Scoped candidate (`SYSTEM:KEY`, `GLOBAL:KEY`, `LOCAL:KEY`)

- Must resolve from that exact source only.

### Unscoped candidate (`KEY`)

- Represents any-source policy.
- Runtime expands internally to explicit ordered candidates.
- Default recommended order: `LOCAL -> GLOBAL -> SYSTEM`.
- If a user chooses a specific source during install, runtime should resolve from that chosen source only.

## Security Contract

- Tool receives only a filtered env snapshot.
- Tool never gets full process env or direct source store access.
- Permission grant must be re-evaluated when tool version changes and requested permissions differ.

## Non-Goals (Current Draft)

- File system/network/process permission model details.
- Final required vs optional permission schema.
- Final CLI command surface for editing permissions after install.

