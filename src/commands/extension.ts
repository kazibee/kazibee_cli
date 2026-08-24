import type { Command } from 'commander';
import ExtensionPackageService, {
  type ExtensionGeneratedResult,
  type ExtensionSealResult,
  type ExtensionValidationReport,
} from '../extension/extension-package-service.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';
import ExtensionLinkService, {
  ExtensionLinkError,
  type ExtensionLinkResult,
  type ExtensionUnlinkResult,
} from '../extension/extension-link-service.js';

export function configureExtensionCommands(program: Command): void {
  const extension = program
    .command('extension')
    .description('Generate, validate, seal, and inspect Kazibee extension packages');

  extension
    .command('generate [path]')
    .description('Generate the canonical .kazibee/index.d.ts declaration')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionGenerate(path, options));

  extension
    .command('validate [path]')
    .description('Validate an extension package without modifying it')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionValidate(path, options));

  extension
    .command('seal [path]')
    .description('Generate, validate, and seal an extension package')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionSeal(path, options));

  extension
    .command('prepare [path]')
    .description('Alias for extension seal')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionSeal(path, options));

  extension
    .command('verify [path]')
    .description('Verify an existing extension validation seal without modifying it')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionVerify(path, options));

  extension
    .command('inspect [path]')
    .description('Inspect extension metadata and validation status')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => extensionInspect(path, options));


  extension
    .command('link [path]')
    .description('Verify and link a local extension package')
    .option('--id <id>', 'Override the model-facing extension id')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption & { id?: string }) => extensionLink(path, options));

  extension
    .command('unlink <id>')
    .description('Remove a managed local extension link without deleting its source')
    .option('--json', 'Print machine-readable JSON output')
    .action((id: string, options: JsonOption) => extensionUnlink(id, options));
}

export async function extensionGenerate(path: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionPackageService();
  await runCliCommand(
    options,
    () => service.generate(path),
    renderGenerated,
  );
}

export async function extensionValidate(path: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionPackageService();
  await runCliCommand(
    options,
    () => requireValid(service.validate(path), 'EXTENSION_INVALID'),
    renderValidation,
  );
}

export async function extensionSeal(path: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionPackageService();
  await runCliCommand(
    options,
    () => requireValid(service.seal(path), 'EXTENSION_SEAL_FAILED'),
    renderSeal,
  );
}

export async function extensionVerify(path: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionPackageService();
  await runCliCommand(
    options,
    () => requireValid(service.verify(path), 'EXTENSION_VERIFY_FAILED'),
    renderValidation,
  );
}

export async function extensionInspect(path: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionPackageService();
  await runCliCommand(
    options,
    () => service.inspect(path),
    renderValidation,
  );
}


export async function extensionLink(
  path: string,
  options: JsonOption & { id?: string } = {},
): Promise<void> {
  const service = new ExtensionLinkService();
  await runCliCommand(
    options,
    () => mapLinkError(() => service.link(path, options.id)),
    renderLink,
  );
}

export async function extensionUnlink(id: string, options: JsonOption = {}): Promise<void> {
  const service = new ExtensionLinkService();
  await runCliCommand(
    options,
    () => mapLinkError(() => service.unlink(id)),
    renderUnlink,
  );
}

function requireValid<T extends ExtensionValidationReport>(report: T, fallbackCode: string): T {
  if (report.ok) return report;
  const first = report.diagnostics[0];
  throw new CliCommandError(
    first?.code ?? fallbackCode,
    first?.message ?? 'Extension package validation failed.',
    report,
  );
}

function renderGenerated(result: ExtensionGeneratedResult): void {
  console.log(`${result.changed ? 'Generated' : 'Verified'} declaration: ${result.declarationPath} (${result.byteCount} bytes)`);
}

function renderValidation(result: ExtensionValidationReport): void {
  console.log(`Extension: ${result.manifest?.id ?? 'unknown'}`);
  console.log(`Status: ${result.status}`);
  if (result.contentDigest) console.log(`Digest: ${result.contentDigest}`);
  for (const diagnostic of result.diagnostics) {
    console.log(`- ${diagnostic.code}: ${diagnostic.message}${diagnostic.path ? ` [${diagnostic.path}]` : ''}`);
  }
}

function renderSeal(result: ExtensionSealResult): void {
  console.log(`Sealed extension: ${result.manifest?.id ?? 'unknown'}`);
  console.log(`Seal: ${result.sealPath}`);
  console.log(`Files: ${result.fileCount}`);
  console.log(`Digest: ${result.contentDigest ?? 'unavailable'}`);
}


function mapLinkError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ExtensionLinkError) {
      throw new CliCommandError(error.code, error.message, error.details);
    }
    throw error;
  }
}

function renderLink(result: ExtensionLinkResult): void {
  console.log(`${result.unchanged ? 'Verified' : 'Linked'} extension "${result.id}": ${result.linkPath}`);
  console.log(`Source: ${result.sourcePath}`);
  console.log(`Digest: ${result.contentDigest}`);
}

function renderUnlink(result: ExtensionUnlinkResult): void {
  console.log(result.removed
    ? `Unlinked extension "${result.id}".`
    : `Extension "${result.id}" was not linked.`);
}
