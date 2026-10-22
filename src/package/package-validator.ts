import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

/**
 * Validates a Kazibee extension package exactly the way the desktop host reads
 * it: same manifest defaults, same runtime file inventory, same content digest.
 * Nothing is written to the package; there is no seal and no generated artifact.
 */

export const SUPPORTED_MANIFEST_VERSION = 1;
const DIGEST_SCHEMA_VERSION = 1;
const DEFAULT_ENTRY = './src/index.ts';
const DEFAULT_MANUAL = './llm.txt';
const DEFAULT_PERMISSIONS = './permissions.json';
const ROOT_CODE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx|json)$/;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEGACY_SEAL = '.kazibee/validation.json';
const LEGACY_DECLARATION = '.kazibee/index.d.ts';

export interface PackageDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface PackageManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly brief: string;
  readonly tags: string[];
  readonly entry: string;
  readonly types: string | null;
  readonly manual: string | null;
  readonly permissions: string | null;
  readonly command: string | null;
}

export interface PackageFile {
  readonly path: string;
  readonly role: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface PackageReport {
  readonly ok: boolean;
  readonly root: string;
  readonly manifest: PackageManifest | null;
  /** Problems that make the host reject the package. */
  readonly errors: PackageDiagnostic[];
  /** Problems the host tolerates but that degrade the model-facing listing or leave stale artifacts. */
  readonly warnings: PackageDiagnostic[];
  /** The digest the host will compute for these exact bytes. */
  readonly contentDigest: string | null;
  readonly files: PackageFile[];
}

export class PackageProblem extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) {
    super(message);
    this.name = 'PackageProblem';
  }
}

export default class PackageValidator {
  validate(inputPath = '.'): PackageReport {
    const root = this.resolveRoot(inputPath);
    if (typeof root !== 'string') return this.failed(resolve(inputPath), root);
    try {
      const packageJson = this.readJsonObject(join(root, 'package.json'), 'package.json');
      const manifest = this.readManifest(root, packageJson);
      const files = this.inventory(root, manifest);
      const errors = this.validatePermissions(root, manifest);
      if (!KEBAB.test(manifest.id)) {
        errors.push({ code: 'ID_INVALID', message: `Extension id "${manifest.id}" must be lowercase kebab-case to be installed or linked.`, path: 'package.json' });
      }
      return {
        ok: errors.length === 0,
        root,
        manifest,
        errors,
        warnings: this.warnings(root, packageJson, manifest),
        contentDigest: this.digest(manifest, files),
        files,
      };
    } catch (error) {
      return this.failed(root, error);
    }
  }

  private readManifest(root: string, packageJson: Record<string, unknown>): PackageManifest {
    const kazibee = packageJson.kazibee === undefined ? {} : this.object(packageJson.kazibee, 'package.json kazibee');
    if (kazibee.manifestVersion !== undefined && kazibee.manifestVersion !== SUPPORTED_MANIFEST_VERSION) {
      throw new PackageProblem('MANIFEST_VERSION_UNSUPPORTED', `kazibee.manifestVersion must be ${SUPPORTED_MANIFEST_VERSION} or omitted.`, 'package.json');
    }
    const name = this.optionalString(packageJson.name, 'package.json name') ?? basename(root);
    const id = this.optionalString(kazibee.id, 'kazibee.id') ?? name.replace(/^@[^/]+\//, '');
    const version = this.optionalString(packageJson.version, 'package.json version') ?? '0.0.0';
    const tags = kazibee.tags === undefined ? [] : this.strings(kazibee.tags, 'kazibee.tags');
    const [packageDescription, brief, kazibeeDescription] = [packageJson.description, kazibee.brief, kazibee.description]
      .map((value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null));
    const description = packageDescription ?? kazibeeDescription ?? '';

    const entry = this.optionalString(packageJson.main, 'package.json main') ?? DEFAULT_ENTRY;
    this.containedFile(root, entry, true);
    return {
      id, name, version, description, tags, entry,
      brief: brief ?? kazibeeDescription ?? description,
      types: this.artifact(root, packageJson.types, null, 'package.json types', false),
      manual: this.artifact(root, kazibee.manual, DEFAULT_MANUAL, 'kazibee.manual', true),
      permissions: this.artifact(root, kazibee.permissions, DEFAULT_PERMISSIONS, 'kazibee.permissions', true),
      command: this.artifact(root, packageJson.command, null, 'package.json command', true),
    };
  }

  /** Declared + required artifacts must exist; undeclared ones fall back to their conventional path only when present. */
  private artifact(root: string, declared: unknown, fallback: string | null, label: string, required: boolean): string | null {
    const explicit = this.optionalString(declared, label);
    const candidate = explicit ?? fallback;
    if (candidate === null) return null;
    if (this.containedFile(root, candidate, false)) return candidate;
    if (explicit !== null && required) {
      throw new PackageProblem('DECLARED_FILE_MISSING', `${label} points at "${explicit}", which does not exist.`, explicit);
    }
    return null;
  }

  private inventory(root: string, manifest: PackageManifest): PackageFile[] {
    const roles = new Map<string, string>([['package.json', 'manifest']]);
    const artifacts: Array<[string | null, string]> = [
      [manifest.entry, 'entry'], [manifest.types, 'declaration'], [manifest.manual, 'manual'],
      [manifest.permissions, 'permissions'], [manifest.command, 'command'],
    ];
    for (const [path, role] of artifacts) if (path !== null) roles.set(this.normalize(path), role);
    for (const file of this.sourceFiles(root, manifest.entry)) {
      const path = this.normalize(relative(root, file));
      if (!roles.has(path)) roles.set(path, 'source');
    }
    return [...roles].sort(([left], [right]) => left.localeCompare(right)).map(([path, role]) => {
      const bytes = readFileSync(this.realContainedFile(root, path));
      return { path, role, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
  }

  /** `src/**`, plus the entry's own tree when it lives elsewhere, or root code files beside a root entry. */
  private sourceFiles(root: string, entry: string): string[] {
    const entryDirectory = posix.dirname(this.normalize(entry));
    const inSrc = entryDirectory === 'src' || entryDirectory.startsWith('src/');
    const trees = entryDirectory === '.' || inSrc ? ['src'] : ['src', entryDirectory];
    const files = trees.flatMap((tree) => (existsSync(join(root, tree)) ? this.listFiles(join(root, tree)) : []));
    if (entryDirectory === '.') {
      for (const entryFile of readdirSync(root, { withFileTypes: true })) {
        if (entryFile.isFile() && ROOT_CODE_FILE.test(entryFile.name)) files.push(join(root, entryFile.name));
      }
    }
    return files;
  }

  private listFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') files.push(...this.listFiles(absolute));
      } else if (entry.isFile()) {
        files.push(absolute);
      } else {
        throw new PackageProblem('ENTRY_UNSUPPORTED', 'Symlinks and special files are not allowed in runtime code.', absolute);
      }
    }
    return files;
  }

  private validatePermissions(root: string, manifest: PackageManifest): PackageDiagnostic[] {
    if (manifest.permissions === null) return [];
    const path = manifest.permissions;
    const value = this.readJsonObject(join(root, path), path);
    const errors: PackageDiagnostic[] = [];
    if (value.env !== undefined && !this.isObject(value.env) && !Array.isArray(value.env)) {
      errors.push({ code: 'PERMISSIONS_ENV_INVALID', message: 'permissions.env must be an object keyed by variable name.', path });
    }
    if (value.net !== undefined) {
      const hosts = Array.isArray(value.net) ? value.net : null;
      if (hosts === null || hosts.some((host) => typeof host !== 'string' || host.trim() === '')) {
        errors.push({ code: 'PERMISSIONS_NET_INVALID', message: 'permissions.net must be an array of nonempty hosts.', path });
      } else if (hosts.some((host) => host.trim() === '*')) {
        errors.push({ code: 'PERMISSIONS_NET_WILDCARD', message: 'Wildcard network access is not allowed.', path });
      }
    }
    if (value.methods !== undefined && !this.isObject(value.methods)) {
      errors.push({ code: 'PERMISSIONS_METHODS_INVALID', message: 'permissions.methods must be an object keyed by method name.', path });
    }
    return errors;
  }

  private warnings(root: string, packageJson: Record<string, unknown>, manifest: PackageManifest): PackageDiagnostic[] {
    const warnings: PackageDiagnostic[] = [];
    const add = (condition: boolean, code: string, message: string, path?: string) => {
      if (condition) warnings.push({ code, message, ...(path ? { path } : {}) });
    };
    add(manifest.manual === null, 'MANUAL_MISSING', 'No llm.txt manual; describe_extension will return the API only.', DEFAULT_MANUAL);
    add(manifest.permissions === null, 'PERMISSIONS_MISSING', 'No permissions.json; the extension gets no network hosts or env keys.', DEFAULT_PERMISSIONS);
    add(manifest.brief === '', 'BRIEF_MISSING', 'Set kazibee.brief (or description) so the model knows when to use this extension.', 'package.json');
    add(manifest.brief.length > 240, 'BRIEF_TOO_LONG', 'kazibee.brief should be a single line under 240 characters.', 'package.json');
    add(manifest.tags.length === 0, 'TAGS_MISSING', 'Add kazibee.tags so the extension is discoverable.', 'package.json');
    add(manifest.tags.some((tag) => !KEBAB.test(tag)), 'TAGS_NOT_KEBAB', 'kazibee.tags should be lowercase kebab-case.', 'package.json');
    add(new Set(manifest.tags).size !== manifest.tags.length, 'TAGS_DUPLICATE', 'kazibee.tags contains duplicates.', 'package.json');
    add(existsSync(join(root, LEGACY_SEAL)), 'LEGACY_SEAL', 'Sealing was removed; delete .kazibee/ (the host computes the digest itself).', LEGACY_SEAL);
    add(this.normalize(String(packageJson.types ?? '')) === LEGACY_DECLARATION, 'LEGACY_TYPES', 'Remove "types": "./.kazibee/index.d.ts"; the host generates declarations from source.', 'package.json');
    return warnings;
  }

  private digest(manifest: PackageManifest, files: PackageFile[]): string {
    const nullable = (path: string | null) => (path === null ? null : this.normalize(path));
    return createHash('sha256').update(this.canonicalJson({
      schemaVersion: DIGEST_SCHEMA_VERSION,
      package: { id: manifest.id, name: manifest.name, version: manifest.version },
      artifacts: {
        entry: this.normalize(manifest.entry),
        manual: nullable(manifest.manual),
        permissions: nullable(manifest.permissions),
        command: nullable(manifest.command),
      },
      files,
    })).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (this.isObject(value)) {
      const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  /** Returns whether the contained path exists; throws when it escapes the root (or is missing and `required`). */
  private containedFile(root: string, path: string, required: boolean): boolean {
    if (isAbsolute(path)) throw new PackageProblem('PATH_ABSOLUTE', `Package paths must be relative: ${path}`, path);
    const absolute = resolve(root, path);
    if (!this.inside(root, absolute)) throw new PackageProblem('PATH_ESCAPE', `Path escapes the package root: ${path}`, path);
    const present = existsSync(absolute);
    if (!present && required) throw new PackageProblem('ENTRY_MISSING', `Entry module is missing: ${path}`, path);
    return present;
  }

  private realContainedFile(root: string, path: string): string {
    const real = realpathSync(resolve(root, path));
    if (!this.inside(root, real)) throw new PackageProblem('PATH_ESCAPE', `Path resolves outside the package root: ${path}`, path);
    return real;
  }

  private inside(root: string, absolute: string): boolean {
    const rel = relative(root, absolute);
    return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
  }

  private resolveRoot(inputPath: string): string | PackageProblem {
    const absolute = resolve(inputPath);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      return new PackageProblem('PACKAGE_PATH_INVALID', `Not a directory: ${absolute}`, inputPath);
    }
    return realpathSync(absolute);
  }

  private readJsonObject(path: string, label: string): Record<string, unknown> {
    if (!existsSync(path)) throw new PackageProblem('FILE_MISSING', `${label} is missing.`, label);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new PackageProblem('JSON_INVALID', `${label}: ${error instanceof Error ? error.message : String(error)}`, label);
    }
    return this.object(value, label);
  }

  private object(value: unknown, label: string): Record<string, unknown> {
    if (!this.isObject(value)) throw new PackageProblem('MANIFEST_INVALID', `${label} must be a JSON object.`, 'package.json');
    return value;
  }

  private optionalString(value: unknown, label: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PackageProblem('MANIFEST_FIELD_INVALID', `${label} must be a nonempty string.`, 'package.json');
    }
    return value.trim();
  }

  private strings(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new PackageProblem('MANIFEST_FIELD_INVALID', `${label} must be an array of strings.`, 'package.json');
    }
    return value.map((item: string) => item.trim());
  }

  private normalize(path: string): string {
    return path.replace(/^\.\//, '').split('\\').join('/');
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private failed(root: string, error: unknown): PackageReport {
    const problem = error instanceof PackageProblem
      ? { code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}) }
      : { code: 'VALIDATION_FAILED', message: error instanceof Error ? error.message : String(error) };
    return { ok: false, root, manifest: null, errors: [problem], warnings: [], contentDigest: null, files: [] };
  }
}
