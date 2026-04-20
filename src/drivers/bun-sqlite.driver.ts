import { Database } from 'bun:sqlite';
import type { IDatabaseDriver, IStatement, RunResult } from '@kazibee/core';

export function createBunSqliteDriver(path: string): IDatabaseDriver {
  const db = new Database(path);

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
