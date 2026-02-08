# Kazibee Link vs Install Spec (Draft)

## Status

Draft based on product decisions captured on February 8, 2026.

## Goals

- Keep `install` focused on published GitHub packages.
- Add `link` for local development against a directory on disk.
- Ensure linked tools behave the same as installed tools for runtime usage.
- Prevent destructive deletes of local source directories.

## Terms

- Installed tool: a tool added via `kazibee install` from GitHub.
- Linked tool: a tool added via `kazibee link` from a local directory.
- Lifecycle command: command that changes registration/source wiring (`install`, `uninstall`, `link`, `unlink`).

## Command Contract

1. `kazibee install <name> <source>`
   - GitHub only.
   - Existing GitHub source formats remain valid.
2. `kazibee link <name> <path>`
   - Local directory only.
   - `<path>` is normalized to an absolute canonical path.
3. `kazibee uninstall <name>`
   - Only valid for installed (GitHub) tools.
   - Must fail for linked tools with a clear message directing to `unlink`.
4. `kazibee unlink <name>`
   - Only valid for linked tools.
   - Must fail for installed tools with a clear message directing to `uninstall`.

## Behavior Parity (Required)

Only lifecycle behavior differs. All other user-facing behavior must be identical for installed and linked tools.

Commands that must work the same for both:

- `kazibee list`
- `kazibee info`
- `kazibee show [toolName]`
- `kazibee llm [toolName]`
- `kazibee env <name> ...`
- `kazibee exec`
- `kazibee <tool-name> <subcommand>`

Implication:

- If a linked tool is registered and resolvable, it must appear and execute exactly like an installed tool.

## Safety Rules

1. `unlink` must never delete the linked source directory.
2. `uninstall` must not operate on linked tools.
3. Any orphan cleanup logic triggered by reinstall/update must not delete linked source directories.
4. If a managed link artifact is used (for example a symlink in a Kazibee-managed folder), cleanup may remove that artifact only.

## Source Modeling

Kazibee tracks installs and links in separate tables.

- `tool_installs`:
  - GitHub installs only.
  - Stores install identity (`owner/repo/sha`) and managed install path.
- `tool_links`:
  - Local links only.
  - Stores local source identity and canonical local source reference.

Runtime resolution combines both tables:

- Longest-path-wins by directory scope.
- If scope length ties, `tool_links` takes precedence over `tool_installs`.

## Coexistence and Fallback

A tool can exist in both tables for the same scope.

- `install` does not remove link records.
- `link` does not remove install records.
- Resolver chooses the linked entry while both exist at the same scope.
- `unlink` removes only the link record; the installed version becomes active again if present at that scope.

This enables temporary override workflows such as:

1. `kazibee install --global <name> <github-source>`
2. `kazibee link --global <name> <local-path>` (local override active)
3. `kazibee unlink --global <name>` (fallback to installed version)

## Local Link Validation (Minimum)

When linking a local directory, validate:

1. Path exists and is a directory.
2. `package.json` exists.
3. Required runtime entry points expected by Kazibee are present (same expectations used for installed tools).

## Display Expectations

- `list` and `info` should show the true source origin.
- GitHub tools display GitHub source format.
- Linked tools display local source format.

## Error Cases

1. `uninstall` called on linked tool:
   - `Tool "<name>" is linked. Use "kazibee unlink <name>".`
   - Applies even when an installed record also exists at the same scope.
2. `unlink` called on installed tool:
   - `Tool "<name>" is installed from GitHub. Use "kazibee uninstall <name>".`
3. `link` path invalid:
   - Clear validation error describing what is missing/invalid.

## Non-Goals (This Spec)

- Defining a package publishing workflow.
- Defining hot-reload/watch behavior for linked tool type generation.
- Changing runtime API contracts for tool packages.
