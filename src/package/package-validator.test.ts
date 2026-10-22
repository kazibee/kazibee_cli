import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PackageValidator from './package-validator.js';

let root: string;
const write = (path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), content);
};
const writePackage = (manifest: Record<string, unknown>) => write('package.json', JSON.stringify(manifest, null, 2));
const codes = (items: { code: string }[]) => items.map((item) => item.code);

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'kazibee-validate-')));
  writePackage({ name: '@acme/notes', version: '1.0.0', description: 'Read and write team notes.', kazibee: { tags: ['notes'] } });
  write('src/index.ts', 'export default function main() { return {}; }\n');
  write('src/helpers/format.ts', 'export const format = (value: string) => value;\n');
  write('llm.txt', 'Use notes for team notes.\n');
  write('permissions.json', JSON.stringify({ net: ['api.notes.dev'], env: { NOTES_TOKEN: {} }, methods: { list: { write: false } } }));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('PackageValidator', () => {
  it('applies the host defaults and needs no .kazibee artifacts', () => {
    const report = new PackageValidator().validate(root);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.manifest).toMatchObject({
      id: 'notes', name: '@acme/notes', brief: 'Read and write team notes.', entry: './src/index.ts',
      manual: './llm.txt', permissions: './permissions.json', types: null, command: null,
    });
    expect(report.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(report.files.map((file) => [file.path, file.role])).toEqual([
      ['llm.txt', 'manual'], ['package.json', 'manifest'], ['permissions.json', 'permissions'],
      ['src/helpers/format.ts', 'source'], ['src/index.ts', 'entry'],
    ]);
  });

  it('changes the digest when any runtime file changes, and only then', () => {
    const validator = new PackageValidator();
    const first = validator.validate(root).contentDigest;
    expect(validator.validate(root).contentDigest).toBe(first);
    write('src/helpers/format.ts', 'export const format = (value: string) => value.trim();\n');
    expect(validator.validate(root).contentDigest).not.toBe(first);
  });

  it('inventories the entry tree outside src, but never node_modules', () => {
    writePackage({ name: 'notes', main: './dist/index.js' });
    write('dist/index.js', "export { helper } from './lib/helper.js';\n");
    write('dist/lib/helper.js', 'export const helper = 1;\n');
    write('dist/node_modules/dep/index.js', 'module.exports = 1;\n');

    const paths = new PackageValidator().validate(root).files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining(['dist/index.js', 'dist/lib/helper.js']));
    expect(paths.some((path) => path.includes('node_modules'))).toBe(false);
  });

  it('rejects what the host rejects', () => {
    const validator = new PackageValidator();
    writePackage({ name: 'notes', kazibee: { manifestVersion: 2 } });
    expect(codes(validator.validate(root).errors)).toEqual(['MANIFEST_VERSION_UNSUPPORTED']);
    writePackage({ name: 'notes', main: './src/missing.ts' });
    expect(codes(validator.validate(root).errors)).toEqual(['ENTRY_MISSING']);
    writePackage({ name: 'notes', main: '../outside.ts' });
    expect(codes(validator.validate(root).errors)).toEqual(['PATH_ESCAPE']);
    writePackage({ name: 'notes', kazibee: { manual: './docs/missing.txt' } });
    expect(codes(validator.validate(root).errors)).toEqual(['DECLARED_FILE_MISSING']);
    writePackage({ name: 'Notes_App' });
    expect(codes(validator.validate(root).errors)).toEqual(['ID_INVALID']);
  });

  it('rejects malformed permissions', () => {
    write('permissions.json', JSON.stringify({ net: ['*'], env: 'TOKEN', methods: [] }));
    expect(codes(new PackageValidator().validate(root).errors)).toEqual([
      'PERMISSIONS_ENV_INVALID', 'PERMISSIONS_NET_WILDCARD', 'PERMISSIONS_METHODS_INVALID',
    ]);
  });

  it('warns about legacy seal artifacts and thin metadata without failing', () => {
    writePackage({ name: 'notes', types: './.kazibee/index.d.ts', kazibee: { manifestVersion: 1, tags: ['Notes', 'Notes'] } });
    write('.kazibee/validation.json', '{}');
    write('.kazibee/index.d.ts', 'export {};\n');
    rmSync(join(root, 'llm.txt'));

    const report = new PackageValidator().validate(root);

    expect(report.ok).toBe(true);
    expect(codes(report.warnings)).toEqual(['MANUAL_MISSING', 'BRIEF_MISSING', 'TAGS_NOT_KEBAB', 'TAGS_DUPLICATE', 'LEGACY_SEAL', 'LEGACY_TYPES']);
  });

  it('reports a missing directory or package.json as an error, not a crash', () => {
    expect(codes(new PackageValidator().validate(join(root, 'nope')).errors)).toEqual(['PACKAGE_PATH_INVALID']);
    rmSync(join(root, 'package.json'));
    expect(codes(new PackageValidator().validate(root).errors)).toEqual(['FILE_MISSING']);
  });
});
