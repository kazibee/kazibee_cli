import { Database } from 'bun:sqlite';
import type { IDatabaseDriver, IStatement, RunResult } from '@kazibee/core';

const BUSY_TIMEOUT_MS = 5000;

export function createBunSqliteDriver(path: string): IDatabaseDriver {
  const db = new Database(path);

  // The Kazibee DB is shared by multiple short-lived CLI processes. Use WAL mode
  // for better writer/read concurrency and let SQLite wait briefly for locks
  // instead of failing immediately with SQLITE_BUSY / SQLITE_BUSY_RECOVERY.
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`PRAGMA synchronous = NORMAL;`);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);

  return {
    exec(sql: string): void {
      db.exec(sql);
    },

    run(sql: string, params?: unknown[]): RunResult {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = db.run(sql, ...(params as any[] ?? []));
      return { changes: result.changes };
    },

    prepare<TRow, TParams extends unknown[] = []>(sql: string): IStatement<TRow, TParams> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stmt = db.query<TRow, any>(sql);
      return {
        get(...p: TParams): TRow | null {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (stmt.get as any)(...p) ?? null;
        },
        all(...p: TParams): TRow[] {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (stmt.all as any)(...p);
        },
      };
    },

    close(): void {
      db.close();
    },
  };
}
