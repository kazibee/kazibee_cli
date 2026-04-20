import { existsSync, rmSync } from 'fs';
import { getLogger } from '@noego/logger';
import type { EnvPermissionGrant } from '@kazibee/core';
import { createCliInstance } from '../create-instance.js';

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
};

export async function toolInstall(name: string, source: string, options: ToolInstallOptions): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    // Normalize owner/repo shorthand to github:owner/repo
    let normalizedSource = source;
    if (!source.startsWith('github:') && OWNER_REPO_SHORTHAND.test(source)) {
      normalizedSource = `github:${source}`;
      logger.info(`Normalized shorthand "${source}" to "${normalizedSource}"`);
    }

    // If no SHA provided, resolve latest from main branch
    let resolvedSource = normalizedSource;
    const match = normalizedSource.match(SOURCE_WITH_PREFIX);
    if (match) {
      const [, owner, repo] = match;
      const sha = await resolveLatestSha(owner, repo);
      resolvedSource = `${normalizedSource}#${sha}`;
      console.log(`Resolved latest SHA for ${owner}/${repo}: ${sha.slice(0, 7)}`);
    }

    // Check for existing install before overwriting
    const existing = kazi.db.getInstalledToolAtDirectory(name, directory);
    const oldInstallPath = existing?.install_path ?? null;

    await kazi.tools.install(name, resolvedSource, directory);
    console.log(`Tool "${name}" installed for ${directory}`);

    const installed = kazi.db.getInstalledToolAtDirectory(name, directory);
    if (!installed) {
      throw new Error(`Tool "${name}" install record was not found after installation.`);
    }

    // Run setup script if declared
    const setupPath = await kazi.setup.loadToolSetup(installed.install_path);
    if (setupPath) {
      const existingEnv = kazi.db.getSetupEnv(name, installed.owner, installed.repo);
      const setupEnv = await kazi.setup.runToolSetup(setupPath, existingEnv);
      kazi.db.setSetupEnv(name, installed.owner, installed.repo, setupEnv);
      const count = Object.keys(setupEnv).length;
      if (count > 0) {
        console.log(`Setup for "${name}" set ${count} env variable(s).`);
      }
    }

    const permissionRequests = await kazi.permissions.loadToolEnvPermissions(installed.install_path);
    if (options.skipPermissions) {
      const existingGrants = kazi.db.getToolEnvPermissions(
        name,
        installed.owner,
        installed.repo,
        installed.sha,
      );

      const existingCount = existingGrants.length;
      console.log(
        `Skipped permissions for "${name}" (--skip-permissions). ` +
        `Kept ${existingCount} existing permission grant(s) unchanged.`,
      );
    } else if (permissionRequests.length === 0) {
      kazi.db.replaceToolEnvPermissionGrants(
        name,
        installed.owner,
        installed.repo,
        installed.sha,
        [],
      );
      console.log(`Tool "${name}" requested no env permissions.`);
    } else {
      const grants = await kazi.permissions.resolveEnvPermissionGrants(name, permissionRequests);
      kazi.db.replaceToolEnvPermissionGrants(
        name,
        installed.owner,
        installed.repo,
        installed.sha,
        grants,
      );

      const grantedCount = grants.filter((g: EnvPermissionGrant) => g.granted).length;
      const deniedCount = grants.length - grantedCount;
      console.log(
        `Saved permissions for "${name}": ${grantedCount} granted, ${deniedCount} denied.`,
      );
    }

    // Clean up old install directory if SHA changed and path is now orphaned
    if (oldInstallPath) {
      const current = kazi.db.getToolInstall(name, directory);
      if (current && current.install_path !== oldInstallPath && existsSync(oldInstallPath)) {
        // Verify no other DB entries reference the old path
        const stillReferenced = kazi.db.isInstallPathReferenced(oldInstallPath);
        if (!stillReferenced) {
          rmSync(oldInstallPath, { recursive: true, force: true });
          console.log(`Removed old install at ${oldInstallPath}`);
          logger.info(`Cleaned up orphaned install directory: ${oldInstallPath}`);
        }
      }
    }
  } catch (err) {
    console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    kazi.close();
  }
}
