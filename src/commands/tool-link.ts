import { existsSync, realpathSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { EnvPermissionGrant } from '@kazibee/core';
import { createCliInstance } from '../create-instance.js';
import { type JsonOption, runCliCommand } from '../utils/cli-output.js';

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
  options: { global?: boolean; skipPermissions?: boolean } & JsonOption,
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const kazi = createCliInstance();

  try {
    await runCliCommand(
      options,
      async () => {
        const linkPath = resolveLocalToolPath(localPathInput);

        await kazi.tools.link(name, linkPath, directory);

        const linked = kazi.db.getLinkedToolAtDirectory(name, directory);
        if (!linked) {
          throw new Error(`Tool "${name}" link record was not found after linking.`);
        }

        let setupEnvCount = 0;
        const setupPath = await kazi.setup.loadToolSetup(linked.install_path);
        if (setupPath) {
          const existingEnv = kazi.db.getSetupEnv(name, linked.owner, linked.repo);
          const setupEnv = await kazi.setup.runToolSetup(setupPath, existingEnv);
          kazi.db.setSetupEnv(name, linked.owner, linked.repo, setupEnv);
          setupEnvCount = Object.keys(setupEnv).length;
        }

        const permissionRequests = await kazi.permissions.loadToolEnvPermissions(linked.install_path);
        let permissionGrantCount = 0;
        let permissionDenyCount = 0;
        let existingPermissionGrantCount = 0;
        const permissionsSkipped = options.skipPermissions === true;
        if (options.skipPermissions) {
          existingPermissionGrantCount = kazi.db.getToolEnvPermissions(
            name,
            linked.owner,
            linked.repo,
            linked.sha,
          ).length;
        } else if (permissionRequests.length === 0) {
          kazi.db.replaceToolEnvPermissionGrants(
            name,
            linked.owner,
            linked.repo,
            linked.sha,
            [],
          );
        } else {
          const grants = await kazi.permissions.resolveEnvPermissionGrants(name, permissionRequests);
          kazi.db.replaceToolEnvPermissionGrants(
            name,
            linked.owner,
            linked.repo,
            linked.sha,
            grants,
          );

          permissionGrantCount = grants.filter((g: EnvPermissionGrant) => g.granted).length;
          permissionDenyCount = grants.length - permissionGrantCount;
        }

        return {
          toolName: name,
          directory,
          global: options.global === true,
          localPath: linkPath,
          sourceType: linked.source_type,
          sourceRef: linked.source_ref,
          owner: linked.owner,
          repo: linked.repo,
          sha: linked.sha,
          installPath: linked.install_path,
          dtsPath: linked.dts_path,
          setupEnvCount,
          permissionRequestCount: permissionRequests.length,
          permissionGrantCount,
          permissionDenyCount,
          existingPermissionGrantCount,
          permissionsSkipped,
        };
      },
      (result) => {
        console.log(`Tool "${name}" linked for ${directory}`);
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
      },
    );
  } finally {
    kazi.close();
  }
}
