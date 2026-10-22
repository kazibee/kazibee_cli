# Kazibee Extension Package Contract

## Goal

An extension is a GitHub repository (or a local folder linked from the desktop app)
containing a TypeScript module whose default export `main(env)` returns the methods the
model can call from `code_sandbox`. Nothing else has to be generated, sealed, packed, or
published: the desktop app reads the source directly.

## Install and provenance

- **GitHub only.** Users install from Settings → Tools with `github:owner/repo`,
  `https://github.com/owner/repo`, or `git@github.com:owner/repo.git`; any other host or
  source is rejected. The app clones the default branch (`--depth 1`), records the commit
  SHA in `.kazibee-install.json` (`source`, `cloneUrl`, `commitSha`, `installedAt`),
  validates the package, moves it into place, and generates its API declarations. Git — not
  a seal — is the source of truth for what was installed. There is no npm distribution.
- **Local development.** Link a local folder from Settings → Tools. Linking also generates
  the declarations. Every edit is picked up on the next use: the app recomputes the content
  digest from the files and regenerates the declarations for the new digest.

## Package manifest

Everything is optional except an entry module. The minimal package is `package.json`
plus `src/index.ts`.

```json
{
  "name": "example",
  "version": "1.0.0",
  "description": "Human-facing description.",
  "type": "module",
  "main": "./src/index.ts",
  "kazibee": {
    "id": "example",
    "brief": "One line telling the model when to use this extension.",
    "tags": ["provider", "domain"],
    "manual": "./llm.txt",
    "permissions": "./permissions.json"
  }
}
```

| Field | Default when omitted |
| --- | --- |
| `kazibee.manifestVersion` | `1` (any other value is rejected) |
| `kazibee.id` | `name` without its `@scope/`, else the directory name. Must be lowercase kebab-case to install or link. |
| `version` | `0.0.0` |
| `kazibee.brief` | `kazibee.description`, else `description` |
| `kazibee.tags` | `[]` |
| `main` | `./src/index.ts` |
| `kazibee.manual` | `./llm.txt` if present |
| `kazibee.permissions` | `./permissions.json` if present (no permissions otherwise) |
| `types` | none — the app generates declarations itself; a declared file is used only when generation cannot resolve the package's imports |

Optional `command` names a local command module; optional `kazibee.commands` describes its
exports for Settings. Every referenced path must be relative and stay inside the package
after symlink resolution. A file that is **declared** but missing is an error; a
**defaulted** file that is missing is simply absent.

## Permissions

```json
{
  "net": ["api.example.com"],
  "env": { "API_KEY": {} },
  "methods": { "list": { "write": false } }
}
```

- `net`: array of nonempty hosts. Wildcards are rejected.
- `env`: object keyed by variable name (array form is accepted for older packages).
- `methods`: object keyed by method name; `write: false` exposes the method in read-only mode.

## API declarations

The desktop app owns type generation. It compiles `main` in memory (declaration-only, no
`node_modules` required) when the package is installed or linked, and again whenever the
content digest changes and the model calls `describe_extension` or Settings opens the API
tab. Results are cached by content digest under the app's data directory. Annotate method
return types: a method whose return type is inferred from an uninstalled third-party
module becomes `any`.

Do not commit generated declarations, `.kazibee/`, or `dist/` type bundles.

## Content digest

`sha256` over canonical JSON (keys sorted) of:

- `schemaVersion: 1`
- `package`: `id`, `name`, `version`
- `artifacts`: normalized `entry`, `manual`, `permissions`, `command` (or `null`)
- `files`: sorted `{ path, role, bytes, sha256 }` for `package.json`, the entry, the manual,
  permissions, command, a declared `types` file if present, every file under `src/`, the
  entry's own directory tree when the entry is outside `src/` (e.g. `dist/`), and root-level
  code files when the entry is at the package root. `node_modules` is never included;
  symlinks inside runtime code are rejected.

The app computes this on every load and copies exactly these files (re-hashing each) into
its sandbox store. `kazibee validate` prints the same digest.

## CLI

The CLI only validates and explains. It never installs, compiles, generates, seals, or
publishes.

```text
kazibee validate [path]   read-only; exactly the host's validation and digest (--json available)
kazibee spec [name]       print this contract (package) or the short authoring guide (guide)
```
