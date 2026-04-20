import { existsSync, realpathSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { EnvPermissionGrant } from '@kazibee/core';
import { createCliInstance } from '../create-instance.js';

function resolveLocalToolPath(inputPath: string): string {
  const absolutePath = resolve(inputPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const canonicalPath = realpathSync(absolutePath);
  if (!statSync(canonicalPath).isDirectory()) {
    throw new Error(`Path is not a directory: ${canonicalPath}`);
  }

  if (!existsSync(join(canonicalPath, 'package.json'))) {
    throw new Error(`package.json not found in directory: ${canonicalPath}`);
  }

  return canonicalPath;
}

export async function toolLink(
  name: string,
  localPathInput: string,
  options: { global?: boolean; skipPermissions?: boolean },
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    const linkPath = resolveLocalToolPath(localPathInput);

    await kazi.tools.link(name, linkPath, directory);
    console.log(`Tool "${name}" linked for ${directory}`);

    const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
    if (!linked) {
      throw new Error(`Tool "${name}" link record was not found after linking.`);
    }

    // Run setup script if declared
    const setupPath = await kazi.setup.loadToolSetup(linked.install_path);
    if (setupPath) {
      const existingEnv = kazi.db.getSetupEnv(name, linked.owner, linked.repo);
      const setupEnv = await kazi.setup.runToolSetup(setupPath, existingEnv);
      kazi.db.setSetupEnv(name, linked.owner, linked.repo, setupEnv);
      const count = Object.keys(setupEnv).length;
      if (count > 0) {
        console.log(`Setup for "${name}" set ${count} env variable(s).`);
      }
    }

    const permissionRequests = await kazi.permissions.loadToolEnvPermissions(linked.install_path);
    if (options.skipPermissions) {
      const existingGrants = kazi.db.getToolEnvPermissions(
        name,
        linked.owner,
        linked.repo,
        linked.sha,
      );

      const existingCount = existingGrants.length;
      console.log(
        `Skipped permissions for "${name}" (--skip-permissions). ` +
        `Kept ${existingCount} existing permission grant(s) unchanged.`,
      );
    } else if (permissionRequests.length === 0) {
      kazi.db.replaceToolEnvPermissionGrants(
        name,
        linked.owner,
        linked.repo,
        linked.sha,
        [],
      );
      console.log(`Tool "${name}" requested no env permissions.`);
    } else {
      const grants = await kazi.permissions.resolveEnvPermissionGrants(name, permissionRequests);
      kazi.db.replaceToolEnvPermissionGrants(
        name,
        linked.owner,
        linked.repo,
        linked.sha,
        grants,
      );

      const grantedCount = grants.filter((g: EnvPermissionGrant) => g.granted).length;
      const deniedCount = grants.length - grantedCount;
      console.log(
        `Saved permissions for "${name}": ${grantedCount} granted, ${deniedCount} denied.`,
      );
    }

  } catch (err) {
    console.error(`Link failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    kazi.close();
  }
}
