# Kazibee Context API Spec (Draft)

## Status

Draft based on product decisions captured on February 9, 2026.

## Goals

- Let tools persist data between execution sessions.
- Scope context per tool per directory, same as env.
- Auto-expire stale data via TTL.
- Maintain a replayable action trail for auditability and reconstruction.
- Keep tool-side usage simple: `context.set()`, `context.get()`, `context.delete()`.

## Boundary

- Context is injected into tool `main(env, context)` as the second argument.
- Tool packages call context methods directly. No HTTP, no IPC.
- Storage, expiration, and cleanup are runtime responsibilities in `kazibee`.

## Tool Author Contract

Tool `main` receives context as the second argument:

```ts
export default function main(env: Env, context: ToolContext) {
  return {
    async doWork() {
      context.set('user.name', 3600, 'Alice');
      const name = context.get('user.name'); // 'Alice'
      context.delete('user');                // removes user, user.name, user.*
    },
  };
}
```

Existing tools that accept only `env` remain compatible. Extra JS arguments are ignored.

## Context Interface

```ts
interface ToolContext {
  set(key: string, ttl: number, value: unknown): void;
  get(key: string): unknown;
  getAll(): Record<string, unknown>;
  delete(key: string): boolean;
  getActions(): ContextAction[];
}
```

### `set(key, ttl, value)`

Stores a value under `key` with a TTL in seconds.

- `key`: dot-notation string (e.g. `"user.name"`, `"cache.results"`).
- `ttl`: positive finite number. Seconds until expiration.
- `value`: any JSON-serializable value. Stored as serialized JSON.
- Overwrites any existing value for the same key.
- Records a `set` action in the action trail.

### `get(key)`

Returns the stored value for `key`, or `undefined` if missing or expired.

- Returns the deserialized JSON value.
- Does not expand dot-notation. `get("user")` returns whatever was stored at the literal key `"user"`, not a merged object of `user.*` keys.

### `getAll()`

Returns all non-expired context as a single nested object.

- Dot-notation keys are expanded: `"user.name"` becomes `{ user: { name: value } }`.
- Object values at the same path are deep-merged.
- Arrays and primitives overwrite rather than merge.
- Keys are applied in insertion order.

### `delete(key)`

Removes the key and all dot-notation children (cascading delete).

- `delete("user")` removes `user`, `user.name`, `user.age`, and any key prefixed with `user.`.
- `delete("user")` does **not** remove `username` (dot-boundary is enforced).
- Returns `true` if any rows were removed, `false` otherwise.
- Records a single `delete` action in the action trail.

### `getActions()`

Returns the full action trail: an ordered list of every `set` and `delete` operation.

- Only includes non-expired actions.
- Ordered by action ID (autoincrement), not by wall-clock time.

```ts
interface ContextAction {
  id: number;
  actionType: 'set' | 'delete';
  key: string;
  value: unknown;
  ttlSeconds: number | null;
  createdAt: string;
  expiresAt: string | null;
}
```

## Key Format

Keys are dot-notation strings.

Rules:

1. Must be a non-empty string.
2. Must not have empty segments (no leading dots, trailing dots, or consecutive dots).
3. Must not contain `%` or `_` characters (reserved for SQL LIKE queries).

Valid: `"user"`, `"user.name"`, `"cache.api.results"`.

Invalid: `""`, `".name"`, `"user."`, `"user..name"`, `"user%name"`, `"user_name"`.

## Dot-Notation Expansion

When building the merged object (`getAll()` and `replayActions()`), keys are expanded by splitting on `.`:

```
"user.name" = "Alice"
"user.age"  = 30

→ { user: { name: "Alice", age: 30 } }
```

### Deep Merge Rules

When two keys produce overlapping object paths:

- Object + Object: recursively merged.
- Object + Primitive/Array: primitive/array overwrites the object.
- Primitive/Array + Object: object overwrites the primitive/array.
- Primitive + Primitive: later key wins (insertion order).

## Cascading Delete

`delete(key)` removes:

1. The exact key.
2. All keys with the prefix `key + "."`.

This uses SQL `WHERE key = ? OR key LIKE ?` with the LIKE pattern `key.%`.

The `%` and `_` ban in key validation prevents LIKE injection.

Examples:

| Call | Removes | Does NOT remove |
|------|---------|-----------------|
| `delete("user")` | `user`, `user.name`, `user.age` | `username`, `users` |
| `delete("cache.api")` | `cache.api`, `cache.api.results` | `cache`, `cache.apis` |

## Action Trail

Every `set` and `delete` operation appends a row to the action log. This log is append-only during normal operation.

Design:

- `tool_context` table: materialized view of current state. Used for `get()` and `getAll()`.
- `tool_context_actions` table: append-only action log. Used for `getActions()`.
- Both tables are written transactionally on every `set` and `delete`.

### Replay Invariant

At any point in time:

```ts
ContextService.replayActions(context.getActions())
```

must produce the same result as:

```ts
context.getAll()
```

This invariant holds because:

1. Actions are ordered by autoincrement ID (deterministic).
2. Expired actions and expired context rows are cleaned together.
3. Replay applies cascading delete semantics matching the SQL layer.

### Replay Logic

```
for each action in order:
  if action is "set":
    map.set(action.key, action.value)
  if action is "delete":
    map.delete(action.key)
    map.delete all keys starting with action.key + "."
```

Then expand all remaining keys via dot-notation into a nested object.

## TTL and Expiration

- Every `set` computes `expires_at = now + ttl` as an ISO 8601 timestamp.
- `get()` and `getAll()` filter by `expires_at > now`.
- `getActions()` filters by `expires_at IS NULL OR expires_at > now` (delete actions have no expiration).
- Expired rows are not immediately removed; they are invisible to reads.

## Cleanup

Expired rows are cleaned at the start of each `kazibee exec` invocation.

Cleanup removes:

1. Expired rows from `tool_context`.
2. Expired rows from `tool_context_actions` (only rows where `expires_at IS NOT NULL AND expires_at <= now`).

Delete actions (which have `expires_at = NULL`) are never cleaned by TTL expiration. They persist indefinitely to maintain the action trail.

## Scoping

Context is scoped by `(tool_name, directory)`, matching env scoping.

- Each tool sees only its own context.
- Each directory scope is isolated.
- When a tool is uninstalled or unlinked and no other registrations exist for that `(tool_name, directory)` pair, all context and action rows for that scope are deleted.

## Size Limits

- Maximum serialized value size: 64 KB (65,536 bytes) per key.
- Values exceeding this limit are rejected with an error.

## Storage Model

### `tool_context` table

```sql
CREATE TABLE IF NOT EXISTS tool_context (
  tool_name TEXT NOT NULL,
  directory TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tool_name, directory, key)
);
```

### `tool_context_actions` table

```sql
CREATE TABLE IF NOT EXISTS tool_context_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  directory TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('set', 'delete')),
  key TEXT NOT NULL,
  value TEXT,
  ttl_seconds REAL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Error Cases

| Scenario | Error |
|----------|-------|
| Empty or non-string key | `Context key must be a non-empty string` |
| Key with empty segments | `Context key must not have empty segments (leading, trailing, or consecutive dots)` |
| Key contains `%` or `_` | `Context key must not contain "%" or "_" characters` |
| TTL is not a positive finite number | `Context TTL must be a positive finite number (seconds)` |
| Value is not JSON-serializable | `Context value must be JSON-serializable` |
| Value exceeds 64 KB | `Context value exceeds maximum size of 65536 bytes` |

## Non-Goals (Current Draft)

- Cross-directory context sharing.
- Context queries or search across keys.
- User-facing CLI commands for inspecting context.
- Context encryption at rest.
- Configurable TTL limits or per-tool quotas.
