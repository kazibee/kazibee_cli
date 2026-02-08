import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';
import { createHash } from 'crypto';
import { getLogger } from '@noego/logger';
import {
  parseToolSource,
  installTool,
  generateDts,
  type ToolInstallerDeps,
  type DtsGeneratorDeps,
} from '@bashly/core';
import { createCoreLoggerAdapter } from '../utils/core-logger-adapter.js';
import { DatabaseService, type ToolSourceType } from './database.service.js';

const logger = getLogger('kazibee:tool');

function runCommand(cmd: string, args: string[], cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function getLocalToolIdentity(localPath: string): { owner: string; repo: string; sha: string } {
  const repo = basename(localPath) || 'local-tool';
  const sha = createHash('sha1').update(localPath).digest('hex');
  return { owner: 'local', repo, sha };
}

export class ToolService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  private async generateTypes(
    name: string,
    installPath: string,
    coreLogger: ReturnType<typeof createCoreLoggerAdapter>,
  ): Promise<void> {
    const dtsGeneratorDeps: DtsGeneratorDeps = {
      logger: coreLogger,
      runCommand,
      readFile: async (path: string) => Bun.file(path).text(),
      writeFile: async (path: string, content: string) => { await Bun.write(path, content); },
      exists: async (path: string) => existsSync(path),
    };

    const dtsResult = await generateDts(installPath, dtsGeneratorDeps);
    if (!dtsResult.success) {
      logger.warn(`Could not generate .d.ts for "${name}": ${dtsResult.error}`);
    }
  }

  async install(name: string, sourceStr: string, directory: string, onProgress?: (message: string) => void): Promise<void> {
    const source = parseToolSource(sourceStr);
    const coreLogger = createCoreLoggerAdapter('kazibee:tool-installer', onProgress);

    const installerDeps: ToolInstallerDeps = {
      logger: coreLogger,
      runCommand,
      exists: async (path: string) => existsSync(path),
      mkdir: async (path: string) => { mkdirSync(path, { recursive: true }); },
    };

    const result = await installTool(name, source, installerDeps);

    if (!result.success) {
      logger.error(`Failed to install tool "${name}": ${result.error}`);
      throw new Error(result.error);
    }

    const tool = result.tool!;

    await this.generateTypes(name, tool.installPath, coreLogger);

    // Register install in database
    this.db.addToolInstall(
      name,
      source.owner,
      source.repo,
      source.sha,
      tool.installPath,
      tool.dtsPath,
      directory,
    );

    if (result.skipped) {
      logger.info(`Tool "${name}" was already installed, registered for ${directory}`);
    } else {
      logger.info(`Tool "${name}" installed and registered for ${directory}`);
    }
  }

  async link(name: string, localPath: string, directory: string, onProgress?: (message: string) => void): Promise<void> {
    const source = getLocalToolIdentity(localPath);
    const coreLogger = createCoreLoggerAdapter('kazibee:tool-linker', onProgress);
    const dtsPath = join(localPath, 'dist', 'index.d.ts');

    await this.generateTypes(name, localPath, coreLogger);

    this.db.addToolLink(
      name,
      source.owner,
      source.repo,
      source.sha,
      localPath,
      dtsPath,
      `local:${localPath}`,
      directory,
    );

    logger.info(`Tool "${name}" linked from ${localPath} and registered for ${directory}`);
  }

  remove(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    return this.db.removeToolRegistration(name, directory);
  }

  uninstall(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    return this.db.removeToolInstall(name, directory);
  }

  unlink(name: string, directory: string): { removed: boolean; installPath: string | null; orphaned: boolean } {
    return this.db.removeToolLink(name, directory);
  }

  list(directory: string): Array<{
    name: string;
    owner: string;
    repo: string;
    sha: string;
    sourceType: ToolSourceType;
    sourceRef: string;
    installPath: string;
    directory: string;
  }> {
    return this.db.listTools(directory).map(row => ({
      name: row.name,
      owner: row.owner,
      repo: row.repo,
      sha: row.sha,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      installPath: row.install_path,
      directory: row.directory,
    }));
  }

  info(directory: string): Array<{
    name: string;
    source: string;
    sourceType: ToolSourceType;
    env: Record<string, string>;
    dtsPath: string;
  }> {
    const tools = this.db.listTools(directory);
    return tools.map(tool => ({
      name: tool.name,
      source: tool.source_ref,
      sourceType: tool.source_type,
      env: this.db.getEnv(tool.name, directory),
      dtsPath: tool.dts_path,
    }));
  }

  /**
   * Returns the combined .d.ts content for all tools in a directory.
   * Each tool's types are wrapped in a `declare namespace <toolName> { ... }` block.
   */
  async getCombinedDts(directory: string): Promise<string> {
    const tools = this.db.listTools(directory);
    const parts: string[] = [];

    for (const tool of tools) {
      try {
        const dtsFile = Bun.file(tool.dts_path);
        if (await dtsFile.exists()) {
          const content = await dtsFile.text();
          parts.push(`declare namespace ${tool.name} {\n${content}\n}`);
        }
      } catch {
        logger.warn(`Could not read .d.ts for tool "${tool.name}"`);
      }
    }

    return parts.join('\n\n');
  }

  setEnv(toolName: string, key: string, value: string, directory: string): void {
    this.db.setEnv(toolName, key, value, directory);
  }

  deleteEnv(toolName: string, key: string, directory: string): boolean {
    return this.db.deleteEnv(toolName, key, directory);
  }

  getEnv(toolName: string, directory: string): Record<string, string> {
    return this.db.getEnv(toolName, directory);
  }

  getEnvAtDirectory(toolName: string, directory: string): Record<string, string> {
    return this.db.getEnvAtDirectory(toolName, directory);
  }

  getGlobalEnv(toolName: string): Record<string, string> {
    return this.db.getGlobalEnv(toolName);
  }

  getLocalEnv(toolName: string, directory: string): Record<string, string> {
    return this.db.getLocalEnv(toolName, directory);
  }
}
