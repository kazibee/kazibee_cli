import { existsSync, rmSync } from 'fs';
import { getLogger } from '@noego/logger';
import type { EnvPermissionGrant } from '@kazibee/core';
import { createCliInstance } from '../create-instance.js';
import { type JsonOption, runCliCommand } from '../utils/cli-output.js';

const logger = getLogger('kazibee:cmd:tool-install');

const SOURCE_WITH_PREFIX = /^github:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/;
const OWNER_REPO_SHORTHAND = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/;

async function resolveLatestSha(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/main`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to resolve latest SHA for ${owner}/${repo}: ${res.status} ${res.statusText}`);
  }
  const data = await res.json() as { sha: string };
  return data.sha;
}

type ToolInstallOptions = {
  global?: boolean;
  skipPermissions?: boolean;
} & JsonOption;

export async function toolInstall(name: string, source: string, options: ToolInstallOptions): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      async () => {
        let normalizedSource = source;
        const messages: string[] = [];
        if (!source.startsWith('github:') && OWNER_REPO_SHORTHAND.test(source)) {
          normalizedSource = `github:${source}`;
          logger.info(`Normalized shorthand "${source}" to "${normalizedSource}"`);
        }

        let resolvedSource = normalizedSource;
        const match = normalizedSource.match(SOURCE_WITH_PREFIX);
        if (match) {
          const [, owner, repo] = match;
          const sha = await resolveLatestSha(owner, repo);
          resolvedSource = `${normalizedSource}#${sha}`;
          messages.push(`Resolved latest SHA for ${owner}/${repo}: ${sha.slice(0, 7)}`);
        }

        const existing = kazi.db.getInstalledToolAtDirectory(name, directory);
        const oldInstallPath = existing?.install_path ?? null;

        await kazi.tools.install(name, resolvedSource, directory);

        const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
        if (!installed) {
          throw new Error(`Tool "${name}" install record was not found after installation.`);
        }

        let setupEnvCount = 0;
        const setupPath = await kazi.setup.loadToolSetup(installed.install_path);
        if (setupPath) {
          const existingEnv = kazi.db.getSetupEnv(name, installed.owner, installed.repo);
          const setupEnv = await kazi.setup.runToolSetup(setupPath, existingEnv);
          kazi.db.setSetupEnv(name, installed.owner, installed.repo, setupEnv);
          setupEnvCount = Object.keys(setupEnv).length;
        }

        const permissionRequests = await kazi.permissions.loadToolEnvPermissions(installed.install_path);
        let permissionGrantCount = 0;
        let permissionDenyCount = 0;
        let existingPermissionGrantCount = 0;
        let permissionsSkipped = options.skipPermissions === true;
        if (options.skipPermissions) {
          existingPermissionGrantCount = kazi.db.getToolEnvPermissions(
            name,
            installed.owner,
            installed.repo,
            installed.sha,
          ).length;
        } else if (permissionRequests.length === 0) {
          kazi.db.replaceToolEnvPermissionGrants(
            name,
            installed.owner,
            installed.repo,
            installed.sha,
            [],
          );
        } else {
          const grants = await kazi.permissions.resolveEnvPermissionGrants(name, permissionRequests);
          kazi.db.replaceToolEnvPermissionGrants(
            name,
            installed.owner,
            installed.repo,
            installed.sha,
            grants,
          );
          permissionGrantCount = grants.filter((g: EnvPermissionGrant) => g.granted).length;
          permissionDenyCount = grants.length - permissionGrantCount;
        }

        let removedOldInstallPath: string | null = null;
        if (oldInstallPath) {
          const current = kazi.db.getToolInstall(name, directory);
          if (current && current.install_path !== oldInstallPath && existsSync(oldInstallPath)) {
            const stillReferenced = kazi.db.isInstallPathReferenced(oldInstallPath);
            if (!stillReferenced) {
              rmSync(oldInstallPath, { recursive: true, force: true });
              removedOldInstallPath = oldInstallPath;
              logger.info(`Cleaned up orphaned install directory: ${oldInstallPath}`);
            }
          }
        }

        return {
          toolName: name,
          directory,
          global: options.global === true,
          source,
          normalizedSource,
          resolvedSource,
          sourceType: installed.source_type,
          sourceRef: installed.source_ref,
          owner: installed.owner,
          repo: installed.repo,
          sha: installed.sha,
          installPath: installed.install_path,
          dtsPath: installed.dts_path,
          setupEnvCount,
          permissionRequestCount: permissionRequests.length,
          permissionGrantCount,
          permissionDenyCount,
          existingPermissionGrantCount,
          permissionsSkipped,
          removedOldInstallPath,
          messages,
        };
      },
      (result) => {
        for (const message of result.messages) {
          console.log(message);
        }
        console.log(`Tool "${name}" installed for ${directory}`);
        if (result.setupEnvCount > 0) {
          console.log(`Setup for "${name}" set ${result.setupEnvCount} env variable(s).`);
        }
        if (result.permissionsSkipped) {
          console.log(
            `Skipped permissions for "${name}" (--skip-permissions). ` +
            `Kept ${result.existingPermissionGrantCount} existing permission grant(s) unchanged.`,
          );
        } else if (result.permissionRequestCount === 0) {
          console.log(`Tool "${name}" requested no env permissions.`);
        } else {
          console.log(
            `Saved permissions for "${name}": ${result.permissionGrantCount} granted, ${result.permissionDenyCount} denied.`,
          );
        }
        if (result.removedOldInstallPath) {
          console.log(`Removed old install at ${result.removedOldInstallPath}`);
        }
      },
    );
  } finally {
    kazi.close();
  }
}
