# Kazibee CLI — Known Shortcomings

Comprehensive assessment of gaps, risks, and improvement areas in the kazibee CLI project.

Last updated: February 2026

---

## 1. Zero Test Coverage

**Severity:** Critical

There are no test files in the project — no `*.test.ts`, no `*.spec.ts`, no `__tests__/` directories. The `"test": "bun test"` script in `package.json` finds nothing to run.

**Impact:**
- Any refactor, dependency upgrade, or feature addition has no safety net.
- Regressions in tool install/uninstall, permission grants, env persistence, or exec routing would go undetected.
- Contributors have no way to validate changes locally.

**Proposed follow-up:**
- Add unit tests for each command handler (mock `createCliInstance`).
- Add integration tests for the full CLI flow (install → env → exec → uninstall).
- Add tests for edge cases: missing tools, bad sources, permission prompt cancellation.
- Gate CI merges on passing tests.

---

## 2. Inconsistent Error Handling

**Severity:** High

Only 3 of 15 command handlers have `try/catch` blocks (`tool-install`, `tool-link`, `tool-llm`). The rest rely on the top-level `main().catch()` in `index.ts`, which logs a raw string and exits 1.

**Impact:**
- Exceptions from database calls, file reads, or core service methods surface as raw error strings with no user-friendly context.
- Stack traces leak to stderr for internal errors (e.g. SQLite constraint violations, missing file paths).
- No distinction between user errors (bad input) and internal failures.

**Affected commands:** `tool-env`, `tool-info`, `tool-list`, `tool-show`, `tool-remove`, `tool-unlink`, `tool-uninstall`, `exec`, `tool-command`, `log`, `usage`, `tool-spec`.

**Proposed follow-up:**
- Add `try/catch` with user-friendly messages to every command handler.
- Distinguish user errors (exit 1 with message) from internal errors (exit 1 with message + log stack trace).
- Consider a shared error-handling wrapper for command actions.

---

## 3. New KazibeeInstance Per Command

**Severity:** Low

Every command calls `createCliInstance()`, which opens a new SQLite connection, creates a new logger adapter, and builds new `fs`/`runCommand` adapters. The instance is closed in `finally` blocks.

**Impact:**
- Unnecessary overhead per invocation (connection setup, pragma execution).
- No shared lifecycle if hypothetical multi-command flows are ever needed.
- Some commands (`log`, `tool-spec`) don't need a database connection at all but the pattern encourages creating one anyway.

**Proposed follow-up:**
- Lazy-initialize the instance only when database access is actually needed.
- Consider a singleton or request-scoped pattern for commands that share a process.

---

## 4. Hardcoded Secrets in `scripts/install.sh`

**Severity:** Medium

Google OAuth `CLIENT_ID` and `CLIENT_SECRET` are committed in plaintext at lines 37–38 of `scripts/install.sh`.

```bash
GOOGLE_CLIENT_ID="258815534555-..."
GOOGLE_CLIENT_SECRET="GOCSPX-..."
```

**Impact:**
- The client secret is visible to anyone with repository access.
- While OAuth client IDs are semi-public, client secrets for installed/desktop apps have limited risk — but committing them normalizes secret exposure.
- If this repo becomes public or is forked, the credentials are permanently exposed in git history.

**Proposed follow-up:**
- Distribute shared credentials through a secure channel (e.g. a first-run setup prompt, a separate config download, or a key management service).
- If the secret must ship with the binary, embed it at compile time from an environment variable rather than checking it into source.
- Rotate the current credentials if the repo has been shared beyond trusted contributors.

---

## 5. Permission Model Not Enforced at Runtime

**Severity:** High

This is already documented in `docs/PERMISSIONS_GAP_NOTES_2026-02-08.md`.

The `PERMISSIONS_SPEC.md` describes a strict grant-only model where tools only receive explicitly granted env keys. In practice:

- Tools receive all env values set via `kazibee env` regardless of permission grants.
- The permission prompt at install time records grants in SQLite, but the runtime exec path does not filter based on those grants.
- Tools run in-process and can access `process.env` directly.

**Impact:**
- The permission system is install-time theater — it asks the user for consent but doesn't enforce it.
- A tool can read any env var from the host process.

**Proposed follow-up (from gap notes):**
1. Add explicit compatibility mode (legacy vs strict grants).
2. Add migration tooling to preview impacted tools.
3. Gate strict mode behind a feature flag, then roll forward by default.
4. Introduce runtime isolation to prevent direct `process.env` access.

---

## 6. No Sandbox Isolation for `kazibee exec`

**Severity:** High

The `exec` command runs user-provided JavaScript via `kazi.exec.execute()`, and tools are loaded in-process. There is no worker thread, no VM isolation, and no `process.env` scrubbing.

**Impact:**
- A malicious or buggy tool can access the full host environment, file system, and network.
- The term "sandbox" in the project description and documentation is aspirational, not actual.
- `kazibee exec` with untrusted code is equivalent to running `eval()` with full privileges.

**Proposed follow-up:**
- Run tool code in a separate Bun worker or subprocess with restricted permissions.
- Scrub `process.env` before entering the execution context.
- Add resource limits (memory, CPU time, execution timeout).
- Update documentation to accurately reflect the current isolation level.

---

## 7. Spec-to-Implementation Drift

**Severity:** Medium

Several specs no longer match the actual implementation:

| Drift | Spec says | Code does |
|-------|-----------|-----------|
| **Command env injection** | `TOOL_COMMAND_SPEC.md` and `COMMAND_ARGS_SPEC.md`: `await fn(...args)` | `tool-command.ts` line 56: `await fn(env, ...args)` |
| **Database access** | `TOOL_COMMAND_SPEC.md`: `new DatabaseService()` | Implementation uses `createCliInstance()` factory |
| **Spec code examples** | Show old class-based patterns | Implementation uses core instance methods |

**Impact:**
- Developers reading specs will write tool command functions with the wrong signature.
- Spec examples won't compile against the actual codebase.
- Erodes trust in specs as a source of truth.

**Proposed follow-up:**
- Audit each spec against the current implementation.
- Update spec code examples to match the actual patterns.
- Add a CI check or review checklist item: "Does this change affect any spec document?"

---

## 8. Duplicated Logic

**Severity:** Low

Several patterns are copy-pasted across files:

| Duplication | Locations |
|-------------|-----------|
| `getISOWeek()` function | `src/utils/file-transport.ts` (line 8) and `src/commands/log.ts` (line 7) — identical implementations |
| Permission grant flow (load → skip/resolve/replace) | `tool-install.ts` (lines 74–112) and `tool-link.ts` (lines 55–93) — near-identical |
| `directory === '/' ? 'global' : directory` formatting | 7+ locations across command files |

**Impact:**
- Bug fixes or behavior changes must be applied in multiple places.
- Risk of the copies drifting apart over time.

**Proposed follow-up:**
- Extract `getISOWeek()` to a shared utility and import from both locations.
- Extract the permission grant flow into a shared helper (e.g. `resolveAndStorePermissions(kazi, name, tool, options)`).
- Add a `formatDirectory(dir)` helper for the global/directory display pattern.

---

## 9. Bun-Only Runtime Lock-in

**Severity:** Low (by design, but worth noting)

The CLI is entirely Bun-dependent:
- `bun:sqlite` in `src/drivers/bun-sqlite.driver.ts`
- `Bun.stdin.stream()` in `src/commands/exec.ts`
- `bun build --compile` for the standalone binary
- `bun-types` in tsconfig

**Impact:**
- Cannot run on Node.js or Deno without porting the driver and stdin handling.
- Users must have Bun installed for development.
- The `IDatabaseDriver` interface in core is a good abstraction, but the CLI has no alternative driver.

**Proposed follow-up:**
- If Node.js support is desired, add a `better-sqlite3` driver behind the same interface.
- Replace `Bun.stdin.stream()` with a cross-runtime stdin reader.
- This may be intentional and acceptable — document the decision if so.

---

## 10. No Input Validation on `kazibee exec`

**Severity:** Medium

The `exec` command reads arbitrary JavaScript from stdin with no guardrails:
- No size limit on input code
- No execution timeout
- No memory limit
- No CPU limit

**Impact:**
- An infinite loop hangs the process indefinitely.
- A memory bomb (`while(true) arr.push(new Array(1e6))`) crashes the host.
- No way for an LLM caller to recover from a hung execution.

**Proposed follow-up:**
- Add a `--timeout` flag (default e.g. 30s) that kills execution after a deadline.
- Add a maximum input size check before execution.
- Consider running exec in a subprocess that can be force-killed.

---

## 11. Silent Failures and Inconsistent UX

**Severity:** Low–Medium

Several user-facing behaviors are surprising or misleading:

| Issue | Location |
|-------|----------|
| **Silent skip on bad .d.ts** | `tool-show.ts` line 68: `if (!result) continue` — no message when a tool's types can't be parsed |
| **Unused logger** | `tool-command.ts` line 6: `logger` is declared but never used (confirmed by diagnostics) |
| **Env value leak** | `tool-info.ts` line 24: `env[key].slice(0, 4) + '****'` — values shorter than 4 characters are shown in full |
| **Unused import** | `tool-show.ts` line 2: `ResolvedToolRow` is imported but never used |

**Proposed follow-up:**
- Log a warning when a tool's `.d.ts` can't be parsed in `tool-show`.
- Remove unused logger/import declarations.
- Use a safe masking function: e.g. show first 2 chars + `****`, or `****` for values under 4 chars.

---

## 12. No `update` / `upgrade` Command

**Severity:** Medium

There is `install` (with automatic SHA resolution) and `uninstall`, but no dedicated `update` or `upgrade` command.

**Impact:**
- To update a tool, users must re-run `kazibee install <name> <source>` and rely on the orphan cleanup logic to remove the old version.
- There's no way to check if updates are available.
- The implicit "re-install to update" flow is undocumented and non-obvious.

**Proposed follow-up:**
- Add `kazibee update <name>` that resolves the latest SHA for the tool's existing source and re-installs.
- Add `kazibee update --all` to update all installed tools.
- Optionally show a diff of what changed (old SHA → new SHA).

---

## 13. GitHub-Only Source Support

**Severity:** Low (by design, but limiting)

The install source format only supports `github:owner/repo#sha`. There is no support for:
- npm packages
- Tarballs / URLs
- Private registries
- GitLab, Bitbucket, or other hosts

The source regex (`/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/`) is restrictive and rejects repos or owners with unusual but valid characters.

**Impact:**
- Tools must be hosted on public GitHub repositories.
- Private/enterprise tools require `link` as a workaround.

**Proposed follow-up:**
- If this is intentional, document the GitHub-only constraint explicitly.
- If expansion is desired, add a source resolver plugin system (e.g. `npm:package@version`, `https://...tar.gz`).

---

## 14. Hardcoded `main` Branch Assumption

**Severity:** Medium

`resolveLatestSha()` in `tool-install.ts` (line 12) fetches from `https://api.github.com/repos/{owner}/{repo}/commits/main`.

**Impact:**
- Repositories using `master`, `trunk`, `develop`, or any non-`main` default branch will fail with a confusing HTTP 422 or 404 error.
- No fallback or branch detection.

**Proposed follow-up:**
- Use the GitHub API to fetch the repo's default branch first: `GET /repos/{owner}/{repo}` → `default_branch`.
- Then fetch commits from that branch.
- Alternatively, accept an optional branch specifier in the source format: `github:owner/repo@branch`.

---

## Cross-Cutting Notes

- The project compiles cleanly (`tsc --noEmit` passes), so these are architectural/design issues, not type errors.
- The `@kazibee/core` package (at `../kazibee_core`) was not assessed here — some issues (sandbox isolation, permission enforcement) may need changes there.
- The existing `docs/PERMISSIONS_GAP_NOTES_2026-02-08.md` covers issue #5 in more detail and can be cross-referenced.
