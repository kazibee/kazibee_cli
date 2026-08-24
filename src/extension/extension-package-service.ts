import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { generateDtsBundle } from 'dts-bundle-generator';

export const EXTENSION_MANIFEST_VERSION = 1;
export const EXTENSION_SEAL_SCHEMA_VERSION = 1;
export const EXTENSION_SEAL_PATH = '.kazibee/validation.json';
export const EXTENSION_DECLARATION_PATH = '.kazibee/index.d.ts';

const VALIDATOR = {
  name: 'kazibee',
  version: '1',
} as const;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ExtensionDiagnostic {
  code: string;
  message: string;
  path?: string;
}

export interface ExtensionManifestSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  brief: string;
  tags: string[];
  main: string;
  types: string;
  manual: string;
  permissions: string;
  command: string | null;
}

export interface ExtensionValidationReport {
  ok: boolean;
  root: string;
  status: 'valid' | 'invalid' | 'unsealed' | 'stale' | 'incompatible';
  manifest: ExtensionManifestSummary | null;
  diagnostics: ExtensionDiagnostic[];
  contentDigest: string | null;
}

export interface ExtensionGeneratedResult {
  root: string;
  declarationPath: string;
  byteCount: number;
  changed: boolean;
}

export interface ExtensionSealResult extends ExtensionValidationReport {
  sealPath: string;
  fileCount: number;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  main?: unknown;
  types?: unknown;
  command?: unknown;
  kazibee?: unknown;
}

interface KazibeeManifest {
  manifestVersion?: unknown;
  id?: unknown;
  brief?: unknown;
  tags?: unknown;
  manual?: unknown;
  permissions?: unknown;
  commands?: unknown;
}

interface SealFileEntry {
  path: string;
  role: 'manifest' | 'source' | 'declaration' | 'manual' | 'permissions' | 'command';
  bytes: number;
  sha256: string;
}

interface ExtensionSealBase {
  schemaVersion: 1;
  validator: typeof VALIDATOR;
  package: {
    id: string;
    name: string;
    version: string;
  };
  artifacts: {
    entry: string;
    declaration: string;
    manual: string;
    permissions: string;
    command: string | null;
  };
  files: SealFileEntry[];
}

interface ExtensionSeal extends ExtensionSealBase {
  contentDigest: string;
}

interface LoadedPackage {
  root: string;
  packageJson: PackageJson;
  manifest: ExtensionManifestSummary;
}

export default class ExtensionPackageService {
  generate(inputPath = '.'): ExtensionGeneratedResult {
    const root = this.resolveRoot(inputPath);
    const loaded = this.loadPackage(root);
    const declaration = this.generateDeclaration(loaded);
    const declarationPath = this.resolveContainedFile(root, loaded.manifest.types);
    const previous = existsSync(declarationPath) ? readFileSync(declarationPath, 'utf8') : null;
    mkdirSync(dirname(declarationPath), { recursive: true });
    if (previous !== declaration) writeFileSync(declarationPath, declaration, 'utf8');
    return {
      root,
      declarationPath,
      byteCount: Buffer.byteLength(declaration),
      changed: previous !== declaration,
    };
  }

  validate(inputPath = '.'): ExtensionValidationReport {
    const root = this.resolveRoot(inputPath);
    try {
      const loaded = this.loadPackage(root);
      const diagnostics = this.validateLoadedPackage(loaded);
      return {
        ok: diagnostics.length === 0,
        root,
        status: diagnostics.length === 0 ? 'valid' : 'invalid',
        manifest: loaded.manifest,
        diagnostics,
        contentDigest: null,
      };
    } catch (error) {
      return this.failedReport(root, error);
    }
  }

  seal(inputPath = '.'): ExtensionSealResult {
    const generated = this.generate(inputPath);
    const validation = this.validate(generated.root);
    if (!validation.ok || !validation.manifest) {
      return {
        ...validation,
        sealPath: this.sealPath(generated.root),
        fileCount: 0,
      };
    }

    const loaded = this.loadPackage(generated.root);
    const base = this.buildSealBase(loaded);
    const seal: ExtensionSeal = {
      ...base,
      contentDigest: this.digestCanonical(base),
    };
    const sealPath = this.sealPath(generated.root);
    mkdirSync(dirname(sealPath), { recursive: true });
    writeFileSync(sealPath, `${JSON.stringify(seal, null, 2)}\n`, 'utf8');
    return {
      ...validation,
      contentDigest: seal.contentDigest,
      sealPath,
      fileCount: seal.files.length,
    };
  }

  verify(inputPath = '.'): ExtensionValidationReport {
    const root = this.resolveRoot(inputPath);
    const sealPath = this.sealPath(root);
    if (!existsSync(sealPath)) {
      return {
        ok: false,
        root,
        status: 'unsealed',
        manifest: this.tryManifest(root),
        diagnostics: [{
          code: 'SEAL_MISSING',
          message: `Validation seal is missing. Run "kazibee extension seal ${root}".`,
          path: EXTENSION_SEAL_PATH,
        }],
        contentDigest: null,
      };
    }

    try {
      const seal = this.readSeal(sealPath);
      if (seal.schemaVersion !== EXTENSION_SEAL_SCHEMA_VERSION) {
        return {
          ok: false,
          root,
          status: 'incompatible',
          manifest: this.tryManifest(root),
          diagnostics: [{
            code: 'SEAL_VERSION_UNSUPPORTED',
            message: `Unsupported validation seal version: ${String(seal.schemaVersion)}.`,
            path: EXTENSION_SEAL_PATH,
          }],
          contentDigest: typeof seal.contentDigest === 'string' ? seal.contentDigest : null,
        };
      }

      const loaded = this.loadPackage(root);
      const validationDiagnostics = this.validateLoadedPackage(loaded);
      if (validationDiagnostics.length > 0) {
        return {
          ok: false,
          root,
          status: 'invalid',
          manifest: loaded.manifest,
          diagnostics: validationDiagnostics,
          contentDigest: typeof seal.contentDigest === 'string' ? seal.contentDigest : null,
        };
      }

      const current = this.buildSealBase(loaded);
      const currentDigest = this.digestCanonical(current);
      const diagnostics = this.compareSeal(seal as ExtensionSeal, current, currentDigest);
      return {
        ok: diagnostics.length === 0,
        root,
        status: diagnostics.length === 0 ? 'valid' : 'stale',
        manifest: loaded.manifest,
        diagnostics,
        contentDigest: typeof seal.contentDigest === 'string' ? seal.contentDigest : null,
      };
    } catch (error) {
      return this.failedReport(root, error);
    }
  }

  inspect(inputPath = '.'): ExtensionValidationReport {
    const verification = this.verify(inputPath);
    if (verification.status === 'unsealed') {
      const validation = this.validate(inputPath);
      return {
        ...validation,
        status: validation.ok ? 'unsealed' : validation.status,
        diagnostics: [...validation.diagnostics, ...verification.diagnostics],
      };
    }
    return verification;
  }

  private validateLoadedPackage(loaded: LoadedPackage): ExtensionDiagnostic[] {
    const diagnostics: ExtensionDiagnostic[] = [];
    const declarationPath = this.resolveContainedFile(loaded.root, loaded.manifest.types);
    const expected = this.generateDeclaration(loaded);
    if (!existsSync(declarationPath)) {
      diagnostics.push({
        code: 'DTS_MISSING',
        message: 'Canonical declaration is missing. Run "kazibee extension generate".',
        path: loaded.manifest.types,
      });
    } else if (readFileSync(declarationPath, 'utf8') !== expected) {
      diagnostics.push({
        code: 'DTS_STALE',
        message: 'Canonical declaration does not match the public TypeScript entry point.',
        path: loaded.manifest.types,
      });
    }

    diagnostics.push(...this.validatePermissions(loaded));
    return diagnostics;
  }

  private validatePermissions(loaded: LoadedPackage): ExtensionDiagnostic[] {
    const pathValue = loaded.manifest.permissions;
    const absolute = this.resolveContainedFile(loaded.root, pathValue);
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch (error) {
      return [{
        code: 'PERMISSIONS_INVALID_JSON',
        message: error instanceof Error ? error.message : String(error),
        path: pathValue,
      }];
    }
    if (!this.isRecord(value)) {
      return [{ code: 'PERMISSIONS_INVALID', message: 'Permissions must be a JSON object.', path: pathValue }];
    }

    const diagnostics: ExtensionDiagnostic[] = [];
    if (value.env !== undefined && !this.isRecord(value.env)) {
      diagnostics.push({
        code: 'PERMISSIONS_ENV_INVALID',
        message: 'permissions.env must be a keyed object in manifest v1.',
        path: pathValue,
      });
    }
    if (value.net !== undefined) {
      if (!Array.isArray(value.net) || value.net.some((item) => typeof item !== 'string' || item.trim() === '')) {
        diagnostics.push({
          code: 'PERMISSIONS_NET_INVALID',
          message: 'permissions.net must be an array of nonempty hosts.',
          path: pathValue,
        });
      } else if (value.net.some((item) => item.trim() === '*')) {
        diagnostics.push({
          code: 'PERMISSIONS_NET_WILDCARD',
          message: 'Wildcard network access is not allowed.',
          path: pathValue,
        });
      }
    }
    return diagnostics;
  }

  private loadPackage(root: string): LoadedPackage {
    const packagePath = join(root, 'package.json');
    if (!existsSync(packagePath)) throw this.packageError('MANIFEST_MISSING', 'package.json is missing.', 'package.json');
    const packageJson = this.parseJsonFile(packagePath) as PackageJson;
    const kazibee = this.recordField(packageJson.kazibee, 'kazibee');

    const manifestVersion = kazibee.manifestVersion;
    if (manifestVersion !== EXTENSION_MANIFEST_VERSION) {
      throw this.packageError(
        'MANIFEST_VERSION_INVALID',
        `kazibee.manifestVersion must be ${EXTENSION_MANIFEST_VERSION}.`,
        'package.json',
      );
    }

    const name = this.requiredString(packageJson.name, 'package.json name');
    const version = this.requiredString(packageJson.version, 'package.json version');
    const description = this.requiredString(packageJson.description, 'package.json description');
    const id = this.requiredString(kazibee.id, 'kazibee.id');
    const brief = this.requiredString(kazibee.brief, 'kazibee.brief');
    const tags = this.stringArray(kazibee.tags, 'kazibee.tags');
    const main = this.requiredString(packageJson.main, 'package.json main');
    const types = this.requiredString(packageJson.types, 'package.json types');
    const manual = this.requiredString(kazibee.manual, 'kazibee.manual');
    const permissions = this.requiredString(kazibee.permissions, 'kazibee.permissions');
    const command = packageJson.command === undefined
      ? null
      : this.requiredString(packageJson.command, 'package.json command');

    this.validateMetadata(id, brief, tags, types);
    for (const value of [main, types, manual, permissions, ...(command ? [command] : [])]) {
      this.resolveContainedFile(root, value);
    }

    return {
      root,
      packageJson,
      manifest: { id, name, version, description, brief, tags, main, types, manual, permissions, command },
    };
  }

  private validateMetadata(id: string, brief: string, tags: string[], types: string): void {
    if (id.length > 64 || !ID_PATTERN.test(id)) {
      throw this.packageError('MANIFEST_ID_INVALID', 'kazibee.id must be lowercase kebab-case.', 'package.json');
    }
    if (brief.length < 20 || brief.length > 240 || brief.includes('\n')) {
      throw this.packageError('MANIFEST_BRIEF_INVALID', 'kazibee.brief must be a single line of 20-240 characters.', 'package.json');
    }
    if (tags.length < 3 || tags.length > 16 || tags.some((tag) => !TAG_PATTERN.test(tag))) {
      throw this.packageError('MANIFEST_TAGS_INVALID', 'kazibee.tags must contain 3-16 lowercase kebab-case tags.', 'package.json');
    }
    if (new Set(tags).size !== tags.length) {
      throw this.packageError('MANIFEST_TAGS_DUPLICATE', 'kazibee.tags must be unique.', 'package.json');
    }
    if (this.normalizeRelative(types) !== EXTENSION_DECLARATION_PATH) {
      throw this.packageError(
        'MANIFEST_TYPES_INVALID',
        `package.json types must be "./${EXTENSION_DECLARATION_PATH}".`,
        'package.json',
      );
    }
  }

  private generateDeclaration(loaded: LoadedPackage): string {
    const entry = this.resolveContainedFile(loaded.root, loaded.manifest.main);
    const tsconfig = join(loaded.root, 'tsconfig.json');
    try {
      const [declaration] = generateDtsBundle(
        [{
          filePath: entry,
          output: {
            noBanner: true,
            sortNodes: false,
          },
        }],
        {
          followSymlinks: true,
          ...(existsSync(tsconfig) ? { preferredConfigPath: tsconfig } : {}),
        },
      );
      if (!declaration) {
        throw new Error('Declaration generator returned no output.');
      }
      return declaration;
    } catch (error) {
      throw this.packageError(
        'DTS_GENERATION_FAILED',
        error instanceof Error ? error.message : String(error),
        loaded.manifest.main,
      );
    }
  }

  private buildSealBase(loaded: LoadedPackage): ExtensionSealBase {
    return {
      schemaVersion: EXTENSION_SEAL_SCHEMA_VERSION,
      validator: VALIDATOR,
      package: {
        id: loaded.manifest.id,
        name: loaded.manifest.name,
        version: loaded.manifest.version,
      },
      artifacts: {
        entry: this.normalizeRelative(loaded.manifest.main),
        declaration: this.normalizeRelative(loaded.manifest.types),
        manual: this.normalizeRelative(loaded.manifest.manual),
        permissions: this.normalizeRelative(loaded.manifest.permissions),
        command: loaded.manifest.command ? this.normalizeRelative(loaded.manifest.command) : null,
      },
      files: this.buildInventory(loaded),
    };
  }

  private buildInventory(loaded: LoadedPackage): SealFileEntry[] {
    const roles = new Map<string, SealFileEntry['role']>();
    roles.set('package.json', 'manifest');
    roles.set(this.normalizeRelative(loaded.manifest.types), 'declaration');
    roles.set(this.normalizeRelative(loaded.manifest.manual), 'manual');
    roles.set(this.normalizeRelative(loaded.manifest.permissions), 'permissions');
    for (const pathValue of this.listFiles(join(loaded.root, 'src'))) {
      roles.set(this.normalizeRelative(relative(loaded.root, pathValue)), 'source');
    }
    if (loaded.manifest.command) roles.set(this.normalizeRelative(loaded.manifest.command), 'command');

    return [...roles.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([relativePath, role]) => {
        const absolute = this.resolveContainedFile(loaded.root, relativePath);
        const bytes = readFileSync(absolute);
        return {
          path: relativePath,
          role,
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
      });
  }

  private listFiles(root: string): string[] {
    if (!existsSync(root)) throw this.packageError('SOURCE_MISSING', 'src directory is missing.', 'src');
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (entry.isFile()) files.push(absolute);
        else throw this.packageError('SOURCE_ENTRY_UNSUPPORTED', 'Source symlinks and special files are not supported.', absolute);
      }
    };
    visit(root);
    return files;
  }

  private compareSeal(seal: ExtensionSeal, current: ExtensionSealBase, currentDigest: string): ExtensionDiagnostic[] {
    const diagnostics: ExtensionDiagnostic[] = [];
    if (seal.contentDigest !== this.digestCanonical(this.sealWithoutDigest(seal))) {
      diagnostics.push({
        code: 'SEAL_DIGEST_INVALID',
        message: 'The validation seal content digest is invalid.',
        path: EXTENSION_SEAL_PATH,
      });
    }
    if (seal.contentDigest !== currentDigest) {
      diagnostics.push({
        code: 'SEAL_STALE',
        message: 'Package contents no longer match the validation seal. Run "kazibee extension seal".',
        path: EXTENSION_SEAL_PATH,
      });
    }
    return diagnostics;
  }

  private sealWithoutDigest(seal: ExtensionSeal): ExtensionSealBase {
    const { contentDigest: _contentDigest, ...base } = seal;
    return base;
  }

  private readSeal(pathValue: string): ExtensionSeal {
    const value = this.parseJsonFile(pathValue);
    if (!this.isRecord(value)) throw this.packageError('SEAL_INVALID', 'Validation seal must be a JSON object.', EXTENSION_SEAL_PATH);
    return value as unknown as ExtensionSeal;
  }

  private tryManifest(root: string): ExtensionManifestSummary | null {
    try {
      return this.loadPackage(root).manifest;
    } catch {
      return null;
    }
  }

  private failedReport(root: string, error: unknown): ExtensionValidationReport {
    const diagnostic = this.diagnosticFrom(error);
    return {
      ok: false,
      root,
      status: 'invalid',
      manifest: this.tryManifest(root),
      diagnostics: [diagnostic],
      contentDigest: null,
    };
  }

  private diagnosticFrom(error: unknown): ExtensionDiagnostic {
    if (error instanceof ExtensionPackageFailure) {
      return { code: error.code, message: error.message, ...(error.path ? { path: error.path } : {}) };
    }
    return {
      code: 'PACKAGE_VALIDATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  private resolveRoot(inputPath: string): string {
    const absolute = resolve(inputPath);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw this.packageError('PACKAGE_PATH_INVALID', `Extension path is not a directory: ${absolute}`, inputPath);
    }
    return realpathSync(absolute);
  }

  private resolveContainedFile(root: string, pathValue: string): string {
    if (isAbsolute(pathValue)) throw this.packageError('PATH_ABSOLUTE', 'Extension paths must be relative.', pathValue);
    const absolute = resolve(root, pathValue);
    const relativePath = relative(root, absolute);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw this.packageError('PATH_ESCAPE', 'Extension path escapes the package root.', pathValue);
    }
    if (!existsSync(absolute) && this.normalizeRelative(pathValue) !== EXTENSION_DECLARATION_PATH) {
      throw this.packageError('PATH_MISSING', `Referenced extension path is missing: ${pathValue}`, pathValue);
    }
    if (existsSync(absolute)) {
      const info = lstatSync(absolute);
      if (!info.isFile()) throw this.packageError('PATH_NOT_FILE', `Referenced extension path is not a file: ${pathValue}`, pathValue);
      const real = realpathSync(absolute);
      const realRelative = relative(root, real);
      if (realRelative === '..' || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
        throw this.packageError('PATH_ESCAPE', 'Extension path resolves outside the package root.', pathValue);
      }
    }
    return absolute;
  }

  private normalizeRelative(pathValue: string): string {
    return pathValue.replace(/^\.\//, '').split('\\').join('/');
  }

  private sealPath(root: string): string {
    return join(root, EXTENSION_SEAL_PATH);
  }

  private parseJsonFile(pathValue: string): unknown {
    try {
      return JSON.parse(readFileSync(pathValue, 'utf8')) as unknown;
    } catch (error) {
      throw this.packageError(
        'JSON_INVALID',
        error instanceof Error ? error.message : String(error),
        pathValue,
      );
    }
  }

  private recordField(value: unknown, label: string): KazibeeManifest {
    if (!this.isRecord(value)) throw this.packageError('MANIFEST_INVALID', `${label} must be an object.`, 'package.json');
    return value as KazibeeManifest;
  }

  private requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw this.packageError('MANIFEST_FIELD_INVALID', `${label} must be a nonempty string.`, 'package.json');
    }
    return value.trim();
  }

  private stringArray(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw this.packageError('MANIFEST_FIELD_INVALID', `${label} must be an array of strings.`, 'package.json');
    }
    return value.map((item) => item.trim());
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private digestCanonical(value: unknown): string {
    return createHash('sha256').update(this.canonicalJson(value)).digest('hex');
  }

  private canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalJson(item)).join(',')}]`;
    if (this.isRecord(value)) {
      const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalJson(item)}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private packageError(code: string, message: string, pathValue?: string): ExtensionPackageFailure {
    return new ExtensionPackageFailure(code, message, pathValue);
  }
}

class ExtensionPackageFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'ExtensionPackageFailure';
  }
}
