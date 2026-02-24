import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { getLogger } from '@noego/logger';

const logger = getLogger('kazibee:database');

const DB_DIR = join(homedir(), '.kazibee');
const DB_PATH = join(DB_DIR, 'db.sqlite');

export type ToolSourceType = 'github' | 'local';

interface ToolInstallRow {
  name: string;
  owner: string;
  repo: string;
  sha: string;
  install_path: string;
  dts_path: string;
  description: string;
  directory: string;
  installed_at: string;
}

interface ToolLinkRow {
  name: string;
  owner: string;
  repo: string;
  sha: string;
  install_path: string;
  dts_path: string;
  description: string;
  source_ref: string;
  directory: string;
  linked_at: string;
}

interface ResolvedToolQueryRow {
  name: string;
  owner: string;
  repo: string;
  sha: string;
  install_path: string;
  dts_path: string;
  description: string;
  directory: string;
  source_type: ToolSourceType;
  source_ref: string;
  installed_at: string;
  scope_len: number;
  source_priority: number;
}

export interface ResolvedToolRow {
  name: string;
  owner: string;
  repo: string;
  sha: string;
  install_path: string;
  dts_path: string;
  description: string;
  directory: string;
  source_type: ToolSourceType;
  source_ref: string;
  installed_at: string;
}

interface ToolEnvRow {
  tool_name: string;
  key: string;
  value: string;
  directory: string;
}

interface ToolEnvPermissionRow {
  tool_name: string;
  owner: string;
  repo: string;
  sha: string;
  injected_key: string;
  source: string | null;
  source_key: string | null;
  granted: number;
  requested: string;
  updated_at: string;
}

export interface ToolEnvPermissionGrant {
  injectedKey: string;
  requestedCandidates: string[];
  granted: boolean;
  source: 'SYSTEM' | 'GLOBAL' | 'LOCAL' | null;
  sourceKey: string | null;
}

export interface ToolEnvPermission {
  injectedKey: string;
  requestedCandidates: string[];
  granted: boolean;
  source: 'SYSTEM' | 'GLOBAL' | 'LOCAL' | null;
  sourceKey: string | null;
}

export class DatabaseService {
  private db: Database;

  constructor() {
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.db.exec('PRAGMA journal_mode=WAL;');
    this.migrate();
    logger.info('Database initialized');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_installs (
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        sha TEXT NOT NULL,
        install_path TEXT NOT NULL,
        dts_path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        directory TEXT NOT NULL,
        installed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (name, directory)
      );

      CREATE TABLE IF NOT EXISTS tool_links (
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        sha TEXT NOT NULL,
        install_path TEXT NOT NULL,
        dts_path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source_ref TEXT NOT NULL,
        directory TEXT NOT NULL,
        linked_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (name, directory)
      );

      CREATE TABLE IF NOT EXISTS tool_env (
        tool_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        directory TEXT NOT NULL,
        PRIMARY KEY (tool_name, key, directory)
      );

      CREATE TABLE IF NOT EXISTS tool_env_permissions (
        tool_name TEXT NOT NULL,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        sha TEXT NOT NULL,
        injected_key TEXT NOT NULL,
        source TEXT,
        source_key TEXT,
        granted INTEGER NOT NULL DEFAULT 0,
        requested TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tool_name, owner, repo, sha, injected_key)
      );
    `);

    // Add description column to existing tables (migration for pre-existing DBs)
    const installCols = this.db.query<{ name: string }, []>('PRAGMA table_info(tool_installs)').all();
    if (!installCols.some((c) => c.name === 'description')) {
      this.db.exec(`ALTER TABLE tool_installs ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
    }
    const linkCols = this.db.query<{ name: string }, []>('PRAGMA table_info(tool_links)').all();
    if (!linkCols.some((c) => c.name === 'description')) {
      this.db.exec(`ALTER TABLE tool_links ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
    }

    // Development compatibility: if local links were previously stored in
    // tool_installs using source_type/source_ref, move them to tool_links.
    const installColumns = this.db.query<{ name: string }, []>('PRAGMA table_info(tool_installs)').all();
    const hasSourceType = installColumns.some((column) => column.name === 'source_type');
    const hasSourceRef = installColumns.some((column) => column.name === 'source_ref');

    if (hasSourceType) {
      const sourceRefExpr = hasSourceRef
        ? `CASE
             WHEN source_ref IS NULL OR source_ref = '' THEN 'local:' || install_path
             ELSE source_ref
           END`
        : `'local:' || install_path`;

      this.db.exec(`
        INSERT OR REPLACE INTO tool_links
          (name, owner, repo, sha, install_path, dts_path, source_ref, directory, linked_at)
        SELECT
          name,
          owner,
          repo,
          sha,
          install_path,
          dts_path,
          ${sourceRefExpr},
          directory,
          installed_at
        FROM tool_installs
        WHERE source_type = 'local';
      `);

      this.db.exec(`
        DELETE FROM tool_installs
        WHERE source_type = 'local';
      `);
    }
  }

  addToolInstall(
    name: string,
    owner: string,
    repo: string,
    sha: string,
    installPath: string,
    dtsPath: string,
    directory: string,
    description?: string,
  ): void {
    this.db.run(
      `INSERT OR REPLACE INTO tool_installs (name, owner, repo, sha, install_path, dts_path, description, directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, owner, repo, sha, installPath, dtsPath, description ?? '', directory],
    );
    logger.info(`Registered installed tool "${name}" for directory ${directory}`);
  }

  addToolLink(
    name: string,
    owner: string,
    repo: string,
    sha: string,
    installPath: string,
    dtsPath: string,
    sourceRef: string,
    directory: string,
    description?: string,
  ): void {
    this.db.run(
      `INSERT OR REPLACE INTO tool_links
       (name, owner, repo, sha, install_path, dts_path, description, source_ref, directory)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, owner, repo, sha, installPath, dtsPath, description ?? '', sourceRef, directory],
    );
    logger.info(`Registered linked tool "${name}" for directory ${directory}`);
  }

  private maybeDeleteEnvForScope(toolName: string, directory: string): void {
    const row = this.db.query<{ count: number }, [string, string, string, string]>(
      `SELECT (
          (SELECT COUNT(*) FROM tool_installs WHERE name = ? AND directory = ?) +
          (SELECT COUNT(*) FROM tool_links WHERE name = ? AND directory = ?)
        ) AS count`,
    ).get(toolName, directory, toolName, directory);

    if ((row?.count ?? 0) === 0) {
      this.db.run(
        'DELETE FROM tool_env WHERE tool_name = ? AND directory = ?',
        [toolName, directory],
      );
    }
  }

  removeToolInstall(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    const row = this.db.query<ToolInstallRow, [string, string]>(
      'SELECT * FROM tool_installs WHERE name = ? AND directory = ?',
    ).get(name, directory);

    if (!row) return { removed: false, installPath: null, orphaned: false };

    this.db.run(
      'DELETE FROM tool_installs WHERE name = ? AND directory = ?',
      [name, directory],
    );
    this.maybeDeleteEnvForScope(name, directory);

    const remaining = this.db.query<{ count: number }, [string, string]>(
      `SELECT (
          (SELECT COUNT(*) FROM tool_installs WHERE install_path = ?) +
          (SELECT COUNT(*) FROM tool_links WHERE install_path = ?)
        ) AS count`,
    ).get(row.install_path, row.install_path);

    return {
      removed: true,
      installPath: row.install_path,
      orphaned: (remaining?.count ?? 0) === 0,
    };
  }

  removeToolLink(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    const row = this.db.query<ToolLinkRow, [string, string]>(
      'SELECT * FROM tool_links WHERE name = ? AND directory = ?',
    ).get(name, directory);

    if (!row) return { removed: false, installPath: null, orphaned: false };

    this.db.run(
      'DELETE FROM tool_links WHERE name = ? AND directory = ?',
      [name, directory],
    );
    this.maybeDeleteEnvForScope(name, directory);

    const remaining = this.db.query<{ count: number }, [string, string]>(
      `SELECT (
          (SELECT COUNT(*) FROM tool_installs WHERE install_path = ?) +
          (SELECT COUNT(*) FROM tool_links WHERE install_path = ?)
        ) AS count`,
    ).get(row.install_path, row.install_path);

    return {
      removed: true,
      installPath: row.install_path,
      orphaned: (remaining?.count ?? 0) === 0,
    };
  }

  removeToolRegistration(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    const linked = this.getLinkedToolAtDirectory(name, directory);
    if (linked) {
      return this.removeToolLink(name, directory);
    }

    return this.removeToolInstall(name, directory);
  }

  /**
   * Lists tools visible for a directory using:
   * 1) longest-path-wins
   * 2) for equal path length, local link wins over install
   */
  listTools(directory: string): ResolvedToolRow[] {
    const rows = this.db.query<ResolvedToolQueryRow, [string, string]>(
      `SELECT
         name,
         owner,
         repo,
         sha,
         install_path,
         dts_path,
         description,
         directory,
         source_type,
         source_ref,
         installed_at,
         scope_len,
         source_priority
       FROM (
         SELECT
           name,
           owner,
           repo,
           sha,
           install_path,
           dts_path,
           description,
           directory,
           'github' AS source_type,
           'github:' || owner || '/' || repo || '#' || sha AS source_ref,
           installed_at,
           length(directory) AS scope_len,
           0 AS source_priority
         FROM tool_installs
         WHERE ? LIKE directory || '%'

         UNION ALL

         SELECT
           name,
           owner,
           repo,
           sha,
           install_path,
           dts_path,
           description,
           directory,
           'local' AS source_type,
           source_ref,
           linked_at AS installed_at,
           length(directory) AS scope_len,
           1 AS source_priority
         FROM tool_links
         WHERE ? LIKE directory || '%'
       )
       ORDER BY scope_len DESC, source_priority DESC`,
    ).all(directory, directory);

    const seen = new Set<string>();
    const result: ResolvedToolRow[] = [];
    for (const row of rows) {
      if (seen.has(row.name)) {
        continue;
      }
      seen.add(row.name);
      result.push({
        name: row.name,
        owner: row.owner,
        repo: row.repo,
        sha: row.sha,
        install_path: row.install_path,
        dts_path: row.dts_path,
        description: row.description,
        directory: row.directory,
        source_type: row.source_type,
        source_ref: row.source_ref,
        installed_at: row.installed_at,
      });
    }

    return result;
  }

  getToolInstall(name: string, directory: string): ResolvedToolRow | null {
    const tools = this.listTools(directory);
    return tools.find((tool) => tool.name === name) ?? null;
  }

  getInstalledToolAtDirectory(name: string, directory: string): ResolvedToolRow | null {
    const row = this.db.query<ResolvedToolRow, [string, string]>(
      `SELECT
         name,
         owner,
         repo,
         sha,
         install_path,
         dts_path,
         description,
         directory,
         'github' AS source_type,
         'github:' || owner || '/' || repo || '#' || sha AS source_ref,
         installed_at
       FROM tool_installs
       WHERE name = ? AND directory = ?`,
    ).get(name, directory);

    return row ?? null;
  }

  getLinkedToolAtDirectory(name: string, directory: string): ResolvedToolRow | null {
    const row = this.db.query<ResolvedToolRow, [string, string]>(
      `SELECT
         name,
         owner,
         repo,
         sha,
         install_path,
         dts_path,
         description,
         directory,
         'local' AS source_type,
         source_ref,
         linked_at AS installed_at
       FROM tool_links
       WHERE name = ? AND directory = ?`,
    ).get(name, directory);

    return row ?? null;
  }

  setEnv(toolName: string, key: string, value: string, directory: string): void {
    this.db.run(
      `INSERT OR REPLACE INTO tool_env (tool_name, key, value, directory)
       VALUES (?, ?, ?, ?)`,
      [toolName, key, value, directory],
    );
    logger.info(`Set env ${key} for tool "${toolName}" in ${directory}`);
  }

  deleteEnv(toolName: string, key: string, directory: string): boolean {
    const result = this.db.run(
      'DELETE FROM tool_env WHERE tool_name = ? AND key = ? AND directory = ?',
      [toolName, key, directory],
    );
    return result.changes > 0;
  }

  getEnv(toolName: string, directory: string): Record<string, string> {
    const rows = this.db.query<ToolEnvRow, [string, string]>(
      `SELECT * FROM tool_env
       WHERE tool_name = ? AND ? LIKE directory || '%'
       ORDER BY length(directory) DESC`,
    ).all(toolName, directory);

    const env: Record<string, string> = {};
    for (const row of rows) {
      if (!(row.key in env)) {
        env[row.key] = row.value;
      }
    }

    return env;
  }

  getEnvAtDirectory(toolName: string, directory: string): Record<string, string> {
    const rows = this.db.query<ToolEnvRow, [string, string]>(
      `SELECT * FROM tool_env
       WHERE tool_name = ? AND directory = ?`,
    ).all(toolName, directory);

    const env: Record<string, string> = {};
    for (const row of rows) {
      env[row.key] = row.value;
    }
    return env;
  }

  getGlobalEnv(toolName: string): Record<string, string> {
    return this.getEnvAtDirectory(toolName, '/');
  }

  getLocalEnv(toolName: string, directory: string): Record<string, string> {
    const rows = this.db.query<ToolEnvRow, [string, string]>(
      `SELECT * FROM tool_env
       WHERE tool_name = ? AND directory != '/' AND ? LIKE directory || '%'
       ORDER BY length(directory) DESC`,
    ).all(toolName, directory);

    const env: Record<string, string> = {};
    for (const row of rows) {
      if (!(row.key in env)) {
        env[row.key] = row.value;
      }
    }

    return env;
  }

  replaceToolEnvPermissionGrants(
    toolName: string,
    owner: string,
    repo: string,
    sha: string,
    grants: ToolEnvPermissionGrant[],
  ): void {
    this.db.run(
      `DELETE FROM tool_env_permissions
       WHERE tool_name = ? AND owner = ? AND repo = ? AND sha = ?`,
      [toolName, owner, repo, sha],
    );

    for (const grant of grants) {
      this.db.run(
        `INSERT INTO tool_env_permissions
         (tool_name, owner, repo, sha, injected_key, source, source_key, granted, requested, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          toolName,
          owner,
          repo,
          sha,
          grant.injectedKey,
          grant.source,
          grant.sourceKey,
          grant.granted ? 1 : 0,
          JSON.stringify(grant.requestedCandidates),
        ],
      );
    }
  }

  getToolEnvPermissions(
    toolName: string,
    owner: string,
    repo: string,
    sha: string,
  ): ToolEnvPermission[] {
    const rows = this.db.query<ToolEnvPermissionRow, [string, string, string, string]>(
      `SELECT * FROM tool_env_permissions
       WHERE tool_name = ? AND owner = ? AND repo = ? AND sha = ?`,
    ).all(toolName, owner, repo, sha);

    return rows.map((row) => {
      let requestedCandidates: string[] = [];
      try {
        const parsed = JSON.parse(row.requested);
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
          requestedCandidates = parsed;
        }
      } catch {
        requestedCandidates = [];
      }

      const source = row.source === 'SYSTEM' || row.source === 'GLOBAL' || row.source === 'LOCAL'
        ? row.source
        : null;

      return {
        injectedKey: row.injected_key,
        requestedCandidates,
        granted: row.granted === 1,
        source,
        sourceKey: row.source_key,
      };
    });
  }

  isInstallPathReferenced(installPath: string): boolean {
    const row = this.db.query<{ count: number }, [string, string]>(
      `SELECT (
          (SELECT COUNT(*) FROM tool_installs WHERE install_path = ?) +
          (SELECT COUNT(*) FROM tool_links WHERE install_path = ?)
        ) AS count`,
    ).get(installPath, installPath);
    return (row?.count ?? 0) > 0;
  }

  close(): void {
    this.db.close();
  }
}
