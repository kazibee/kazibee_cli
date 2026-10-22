# Kazibee CLI

A small, read-only helper for authoring Kazibee extension packages: it validates a package
and prints the package contract. It never installs, compiles, seals, packs, publishes, or
writes files into your package.

Extensions are installed from GitHub inside the desktop app (Settings → Tools →
`github:owner/repo`). The app records the installed commit, computes the content digest
from your files, and generates the TypeScript API when it installs or links the package.
Your repository only needs source.

## Commands

```bash
kazibee validate [path]   # validate exactly as the desktop app will; prints the content digest
kazibee validate --json   # machine-readable report
kazibee spec              # print the package contract (specs/EXTENSION_PACKAGE_SPEC.md)
kazibee spec guide        # print the short authoring guide (llm.txt)
```

`validate` exits non-zero on errors; warnings (missing manual, thin metadata, leftover
`.kazibee/` artifacts) never fail the run.

## Minimal package

```text
package.json      { "name": "notes", "main": "./src/index.ts", "kazibee": { "brief": "…", "tags": ["notes"] } }
src/index.ts      export default function main(env) { return { list: async (): Promise<Note[]> => … } }
llm.txt           optional usage manual for the model
permissions.json  optional { "net": [...], "env": {...}, "methods": {...} }
```

The full contract — defaults, permissions, and how the digest is computed — is in
`specs/EXTENSION_PACKAGE_SPEC.md` (`kazibee spec`).

## Developing a package locally

1. Start from any repo with `package.json` + `src/index.ts`.
2. `kazibee validate my-extension` until there are no errors.
3. In the desktop app, Settings → Tools → Link, and point at the folder. The app generates
   the API on link; edits are picked up on the next call and nothing has to be regenerated.
4. Push to GitHub. Users install it with `github:owner/repo`.

## Removed commands

`extension seal`, `prepare`, `verify`, `generate`, and `inspect` print a notice and run
`validate`. The legacy runtime (`install`, `link`, `env`, `exec`, `show`, `<tool> <command>`, …)
was removed; the desktop app owns installing, configuring, typing, and running extensions.
