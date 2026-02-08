import { existsSync, realpathSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { DatabaseService } from '../services/database.service.js';
import { ToolService } from '../services/tool.service.js';
import { loadToolEnvPermissions, promptForEnvPermissionGrants } from '../services/permission.service.js';

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
  options: { global?: boolean },
): Promise<void> {
  const directory = options.global ? '/' : process.cwd();
  const db = new DatabaseService();

  try {
    const linkPath = resolveLocalToolPath(localPathInput);

    const toolService = new ToolService(db);
    await toolService.link(name, linkPath, directory, (msg) => console.log(msg));
    console.log(`Tool "${name}" linked for ${directory}`);

    const linked = db.getLinkedToolAtDirectory(name, directory);
    if (!linked) {
      throw new Error(`Tool "${name}" link record was not found after linking.`);
    }

    const permissionRequests = await loadToolEnvPermissions(linked.install_path);
    if (permissionRequests.length === 0) {
      db.replaceToolEnvPermissionGrants(
        name,
        linked.owner,
        linked.repo,
        linked.sha,
        [],
      );
      console.log(`Tool "${name}" requested no env permissions.`);
    } else {
      const grants = await promptForEnvPermissionGrants(name, permissionRequests);
      db.replaceToolEnvPermissionGrants(
        name,
        linked.owner,
        linked.repo,
        linked.sha,
        grants,
      );

      const grantedCount = grants.filter(g => g.granted).length;
      const deniedCount = grants.length - grantedCount;
      console.log(
        `Saved permissions for "${name}": ${grantedCount} granted, ${deniedCount} denied.`,
      );
    }

  } catch (err) {
    console.error(`Link failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
