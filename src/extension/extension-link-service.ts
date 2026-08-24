import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import ExtensionPackageService from './extension-package-service';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ExtensionLinkResult {
  readonly id: string;
  readonly sourcePath: string;
  readonly linkPath: string;
  readonly replaced: boolean;
  readonly unchanged: boolean;
  readonly contentDigest: string;
}

export interface ExtensionUnlinkResult {
  readonly id: string;
  readonly linkPath: string;
  readonly removed: boolean;
}

export default class ExtensionLinkService {
  constructor(
    private readonly packages = new ExtensionPackageService(),
    private readonly toolsRoot = process.env.KAZIBEE_TOOLS_DIR ?? join(homedir(), '.kazibee', 'tools'),
  ) {}

  link(packagePath: string, requestedId?: string): ExtensionLinkResult {
    const verification = this.packages.verify(packagePath);
    if (!verification.ok || !verification.manifest || !verification.contentDigest) {
      const first = verification.diagnostics[0];
      throw new ExtensionLinkError(
        first?.code ?? 'EXTENSION_VERIFY_FAILED',
        first?.message ?? 'Extension verification failed.',
        verification,
      );
    }

    const id = requestedId ?? verification.manifest.id;
    this.validateId(id);
    const sourcePath = realpathSync(packagePath);
    const linkPath = join(this.toolsRoot, id);
    mkdirSync(this.toolsRoot, { recursive: true });

    const existing = this.existingLink(linkPath, sourcePath);
    if (existing.unchanged) {
      return {
        id,
        sourcePath,
        linkPath,
        replaced: false,
        unchanged: true,
        contentDigest: verification.contentDigest,
      };
    }

    if (existing.exists) unlinkSync(linkPath);
    symlinkSync(sourcePath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return {
      id,
      sourcePath,
      linkPath,
      replaced: existing.exists,
      unchanged: false,
      contentDigest: verification.contentDigest,
    };
  }

  unlink(id: string): ExtensionUnlinkResult {
    this.validateId(id);
    const linkPath = join(this.toolsRoot, id);
    if (!existsSync(linkPath)) return { id, linkPath, removed: false };
    const info = lstatSync(linkPath);
    if (!info.isSymbolicLink()) {
      throw new ExtensionLinkError(
        'EXTENSION_NOT_LINKED',
        `Extension "${id}" is not a managed local link; refusing to remove it.`,
      );
    }
    unlinkSync(linkPath);
    return { id, linkPath, removed: true };
  }

  private existingLink(linkPath: string, sourcePath: string): { exists: boolean; unchanged: boolean } {
    if (!existsSync(linkPath)) return { exists: false, unchanged: false };
    const info = lstatSync(linkPath);
    if (!info.isSymbolicLink()) {
      throw new ExtensionLinkError(
        'EXTENSION_LINK_CONFLICT',
        `Extension destination exists and is not a symlink: ${linkPath}`,
      );
    }
    const currentTarget = realpathSync(linkPath);
    return { exists: true, unchanged: currentTarget === sourcePath };
  }

  private validateId(id: string): void {
    if (!ID_PATTERN.test(id) || id.length > 64) {
      throw new ExtensionLinkError('EXTENSION_ID_INVALID', 'Extension id must be lowercase kebab-case.');
    }
  }
}

export class ExtensionLinkError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ExtensionLinkError';
  }
}
