import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExtensionLinkService, { ExtensionLinkError } from './extension-link-service';

let root: string;
let toolsRoot: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kazibee-extension-link-'));
  toolsRoot = join(root, 'tools');
  sourceRoot = join(root, 'source');
  mkdirSync(toolsRoot, { recursive: true });
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(join(sourceRoot, 'source.txt'), 'preserve me');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ExtensionLinkService', () => {
  it('links a verified package and treats a repeated link as unchanged', () => {
    const service = new ExtensionLinkService(verifier(true) as never, toolsRoot);

    const first = service.link(sourceRoot);
    const second = service.link(sourceRoot);

    expect(first).toMatchObject({ id: 'demo-extension', replaced: false, unchanged: false });
    expect(second).toMatchObject({ id: 'demo-extension', replaced: false, unchanged: true });
    expect(existsSync(join(toolsRoot, 'demo-extension'))).toBe(true);
  });

  it('rejects an unverified package before creating a link', () => {
    const service = new ExtensionLinkService(verifier(false) as never, toolsRoot);

    expect(() => service.link(sourceRoot)).toThrow(ExtensionLinkError);
    expect(existsSync(join(toolsRoot, 'demo-extension'))).toBe(false);
  });

  it('unlinks only the managed symlink and preserves source bytes', () => {
    const service = new ExtensionLinkService(verifier(true) as never, toolsRoot);
    service.link(sourceRoot);

    const result = service.unlink('demo-extension');

    expect(result.removed).toBe(true);
    expect(existsSync(join(toolsRoot, 'demo-extension'))).toBe(false);
    expect(readFileSync(join(sourceRoot, 'source.txt'), 'utf8')).toBe('preserve me');
  });

  it('refuses to replace a non-symlink destination', () => {
    mkdirSync(join(toolsRoot, 'demo-extension'));
    const service = new ExtensionLinkService(verifier(true) as never, toolsRoot);

    expect(() => service.link(sourceRoot)).toThrow(/not a symlink/);
  });

  it('replaces a different managed symlink', () => {
    const other = join(root, 'other');
    mkdirSync(other);
    symlinkSync(other, join(toolsRoot, 'demo-extension'), 'dir');
    const service = new ExtensionLinkService(verifier(true) as never, toolsRoot);

    const result = service.link(sourceRoot);

    expect(result.replaced).toBe(true);
    expect(result.unchanged).toBe(false);
  });
});

function verifier(ok: boolean) {
  return {
    verify: () => ok ? {
      ok: true,
      status: 'valid',
      manifest: { id: 'demo-extension' },
      diagnostics: [],
      contentDigest: 'a'.repeat(64),
    } : {
      ok: false,
      status: 'stale',
      manifest: { id: 'demo-extension' },
      diagnostics: [{ code: 'SEAL_STALE', message: 'stale' }],
      contentDigest: 'a'.repeat(64),
    },
  };
}
