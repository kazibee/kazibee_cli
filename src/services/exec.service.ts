import { getLogger } from '@noego/logger';
import { validateAST } from '@bashly/core';
import { DatabaseService, type ToolEnvPermission } from './database.service.js';

const logger = getLogger('kazibee:exec');

export interface ExecResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration: number;
}

export class ExecService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Validates and executes code with tool access.
   *
   * 1. Validates AST for blocked patterns
   * 2. Resolves tools for the current directory
   * 3. Loads each tool in-process, calling its default export with scoped secrets
   * 4. Executes the code with the loaded tool APIs
   */
  async execute(code: string, directory: string): Promise<ExecResult> {
    // Step 1: Validate AST
    const validation = validateAST(code);
    if (!validation.valid) {
      const errorMessages = validation.errors.map(
        e => `  Line ${e.line}:${e.column} — ${e.message}`
      ).join('\n');
      const error = `AST validation failed:\n${errorMessages}`;
      logger.error(error);
      return { success: false, error, duration: 0 };
    }

    logger.info('AST validation passed');

    // Step 2: Resolve tools for directory
    const toolRows = this.db.listTools(directory);
    if (toolRows.length === 0) {
      logger.warn('No tools installed for this directory');
    }

    // Step 3: Load tools in-process
    const tools: Record<string, Record<string, (...args: unknown[]) => unknown>> = {};

    for (const tool of toolRows) {
      try {
        const permissions = this.db.getToolEnvPermissions(
          tool.name,
          tool.owner,
          tool.repo,
          tool.sha,
        );

        const secrets = permissions.length > 0
          ? this.resolveScopedSecrets(tool.name, directory, permissions)
          : this.db.getEnv(tool.name, directory);

        const toolEntryPoint = `${tool.install_path}/src/index.ts`;

        logger.info(`Loading tool "${tool.name}" from ${toolEntryPoint}`);

        const mod = await import(toolEntryPoint);
        const factory = mod.default ?? mod;

        if (typeof factory === 'function') {
          tools[tool.name] = await factory(secrets);
        } else {
          tools[tool.name] = factory;
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`Skipping tool "${tool.name}" due to load failure: ${error}`);
      }
    }

    // Step 4: Execute
    const start = Date.now();

    try {
      logger.info('Executing code');
      const fn = new Function('tools', `return (async () => {\n${code}\n})()`) as (
        tools: Record<string, unknown>,
      ) => Promise<unknown>;

      const result = await fn(tools);
      const duration = Date.now() - start;

      logger.info(`Execution completed in ${duration}ms`);
      return { success: true, result, duration };
    } catch (err) {
      const duration = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);

      logger.error(`Execution failed: ${error}`);
      return { success: false, error, duration };
    }
  }

  private resolveScopedSecrets(
    toolName: string,
    directory: string,
    permissions: ToolEnvPermission[],
  ): Record<string, string> {
    const secrets: Record<string, string> = {};
    let localEnv: Record<string, string> | null = null;
    let globalEnv: Record<string, string> | null = null;

    for (const permission of permissions) {
      if (!permission.granted || !permission.source || !permission.sourceKey) {
        continue;
      }

      let value: string | undefined;

      if (permission.source === 'SYSTEM') {
        value = process.env[permission.sourceKey];
      } else if (permission.source === 'GLOBAL') {
        globalEnv ??= this.db.getGlobalEnv(toolName);
        value = globalEnv[permission.sourceKey];
      } else if (permission.source === 'LOCAL') {
        localEnv ??= this.db.getLocalEnv(toolName, directory);
        value = localEnv[permission.sourceKey];
      }

      if (value !== undefined) {
        secrets[permission.injectedKey] = value;
      } else {
        logger.warn(
          `Missing granted env for ${toolName}: ${permission.source}:${permission.sourceKey} -> ${permission.injectedKey}`,
        );
      }
    }

    return secrets;
  }
}
