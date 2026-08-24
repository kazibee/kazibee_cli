import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExtensionPackageService, {
  EXTENSION_SEAL_PATH,
} from './extension-package-service';

setDefaultTimeout(15_000);

let root: string;
let extensionRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kazibee-extension-package-'));
  extensionRoot = join(root, 'demo-extension');
  createFixture(extensionRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ExtensionPackageService', () => {
  it('generates, validates, seals, and verifies deterministic package artifacts', () => {
    const service = new ExtensionPackageService();

    const generated = service.generate(extensionRoot);
    expect(generated.changed).toBe(true);
    expect(readFileSync(join(extensionRoot, '.kazibee/index.d.ts'), 'utf8')).toContain('declare function main');

    expect(service.validate(extensionRoot)).toMatchObject({ ok: true, status: 'valid' });

    const first = service.seal(extensionRoot);
    const firstText = readFileSync(join(extensionRoot, EXTENSION_SEAL_PATH), 'utf8');
    expect(first).toMatchObject({
      ok: true,
      status: 'valid',
      manifest: { id: 'demo-extension', tags: ['demo', 'records', 'search'] },
    });
    expect(first.fileCount).toBeGreaterThanOrEqual(5);
    expect(service.verify(extensionRoot)).toMatchObject({
      ok: true,
      status: 'valid',
      contentDigest: first.contentDigest,
    });

    const second = service.seal(extensionRoot);
    const secondText = readFileSync(join(extensionRoot, EXTENSION_SEAL_PATH), 'utf8');
    expect(second.contentDigest).toBe(first.contentDigest);
    expect(secondText).toBe(firstText);
  });

  it('invalidates the seal when discovery metadata changes', () => {
    const service = new ExtensionPackageService();
    service.seal(extensionRoot);

    const manifestPath = join(extensionRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.description = 'Changed without resealing.';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const report = service.verify(extensionRoot);
    expect(report.ok).toBe(false);
    expect(report.status).toBe('stale');
    expect(report.diagnostics.map((item) => item.code)).toContain('SEAL_STALE');
  });

  it('rejects stale declarations when source changes', () => {
    const service = new ExtensionPackageService();
    service.seal(extensionRoot);
    writeFileSync(
      join(extensionRoot, 'src/index.ts'),
      'export default function main() { return { pong: async (value: string) => value }; }\n',
    );

    const report = service.verify(extensionRoot);
    expect(report.ok).toBe(false);
    expect(report.status).toBe('invalid');
    expect(report.diagnostics.map((item) => item.code)).toContain('DTS_STALE');
  });

  it('keeps validation read-only when the declaration is missing', () => {
    const service = new ExtensionPackageService();
    const declarationPath = join(extensionRoot, '.kazibee/index.d.ts');
    expect(existsSync(declarationPath)).toBe(false);

    const report = service.validate(extensionRoot);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((item) => item.code)).toContain('DTS_MISSING');
    expect(existsSync(declarationPath)).toBe(false);
  });

  it('rejects referenced paths that escape the package root', () => {
    const service = new ExtensionPackageService();
    const manifestPath = join(extensionRoot, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      kazibee: Record<string, unknown>;
    };
    manifest.kazibee.manual = '../outside.txt';
    writeFileSync(join(root, 'outside.txt'), 'outside');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const report = service.validate(extensionRoot);

    expect(report.ok).toBe(false);
    expect(report.diagnostics[0]?.code).toBe('PATH_ESCAPE');
  });

  it('rejects legacy array-form environment permissions', () => {
    const service = new ExtensionPackageService();
    service.generate(extensionRoot);
    writeFileSync(
      join(extensionRoot, 'permissions.json'),
      JSON.stringify({ env: ['API_KEY'] }, null, 2),
    );

    const report = service.validate(extensionRoot);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.map((item) => item.code)).toContain('PERMISSIONS_ENV_INVALID');
  });
});

function createFixture(directory: string): void {
  mkdirSync(join(directory, 'src'), { recursive: true });
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: '@kazibee/demo-extension',
      version: '1.0.0',
      description: 'Demo extension for package validation.',
      type: 'module',
      main: './src/index.ts',
      types: './.kazibee/index.d.ts',
      kazibee: {
        manifestVersion: 1,
        id: 'demo-extension',
        brief: 'Search and inspect deterministic demo records.',
        tags: ['demo', 'records', 'search'],
        manual: './llm.txt',
        permissions: './permissions.json',
      },
    }, null, 2),
  );
  writeFileSync(
    join(directory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        declaration: true,
      },
      include: ['src/**/*.ts'],
    }, null, 2),
  );
  writeFileSync(
    join(directory, 'src/index.ts'),
    'export default function main() { return { ping: async (value: string) => value }; }\n',
  );
  writeFileSync(join(directory, 'llm.txt'), 'Use this extension to search demo records.\n');
  writeFileSync(join(directory, 'permissions.json'), JSON.stringify({ env: {} }, null, 2));
}
