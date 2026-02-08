# Permissions Gap Notes (February 8, 2026)

## Context

The current permissions design says tools should only receive explicitly granted env keys.
We are not changing runtime behavior yet because the current fallback behavior is widely used and changing it now would be disruptive.

## Current Gap

If a tool has no permissions manifest or no stored grants, runtime currently falls back to injecting tool env keys from persisted `tool_env`.

That means:

- A tool can still receive env values set via `kazibee env` without explicit permission grants.
- This does not match the stricter "grant-only injection" model in the permissions spec.

## Why This Is Deferred

- Existing tool workflows depend on legacy env behavior.
- Flipping to strict grants immediately can break existing tools.
- We need a migration path and rollout strategy before enforcing strict behavior.

## Additional Security Note

Tools are loaded in-process today. Even with filtered `main(env)` injection, tool code can still access process-level environment directly unless runtime isolation is introduced.

## Proposed Follow-Up (Later)

1. Add explicit compatibility mode (legacy vs strict grants).
2. Add migration tooling to preview impacted tools.
3. Gate strict mode behind a feature flag, then roll forward by default.
4. Reconcile spec wording with finalized runtime contract.
