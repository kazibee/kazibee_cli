import type { Command } from 'commander';
import PackageValidator, { type PackageDiagnostic, type PackageReport } from '../package/package-validator.js';
import SpecCatalog from '../package/spec-catalog.js';
import { CliCommandError, type JsonOption, runCliCommand } from '../utils/cli-output.js';

/** Released `kazibee extension …` subcommands that now only validate. */
const REMOVED_COMMANDS: Record<string, string> = {
  seal: 'Sealing was removed: the desktop computes the content digest from your files on every load.',
  prepare: 'Sealing was removed: the desktop computes the content digest from your files on every load.',
  verify: 'Seal verification was removed: there is no seal to verify.',
  generate: 'Declaration generation was removed: the desktop generates declarations from source when it installs the package.',
  inspect: '"inspect" was folded into "kazibee validate".',
};

export function configurePackageCommands(program: Command): void {
  program
    .command('validate [path]')
    .description('Validate an extension package exactly as the desktop app will read it (read-only)')
    .option('--json', 'Print machine-readable JSON output')
    .action((path = '.', options: JsonOption) => validateCommand(path, options));

  program
    .command('spec [name]')
    .description(`Print authoring guidance: ${new SpecCatalog().names().join(', ')} (default: package)`)
    .action((name?: string) => specCommand(name));

  const legacy = program
    .command('extension', { hidden: true })
    .description('Deprecated command group; use "kazibee validate"');
  legacy.command('validate [path]').option('--json').action((path = '.', options: JsonOption) => validateCommand(path, options));
  for (const [name, notice] of Object.entries(REMOVED_COMMANDS)) {
    legacy.command(`${name} [path]`).option('--json').action((path = '.', options: JsonOption) => {
      if (!options.json) console.error(`${notice} Running "kazibee validate" instead.`);
      return validateCommand(path, options);
    });
  }
}

export async function validateCommand(path: string, options: JsonOption = {}): Promise<void> {
  await runCliCommand(options, () => requireOk(new PackageValidator().validate(path), options), renderReport);
}

export function specCommand(name = 'package'): void {
  const catalog = new SpecCatalog();
  const text = catalog.read(name);
  if (text === null) throw new Error(`Unknown spec "${name}". Available: ${catalog.names().join(', ')}`);
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

/** An invalid package fails the command; text mode still shows every diagnostic first (JSON carries them in the error). */
function requireOk(report: PackageReport, options: JsonOption): PackageReport {
  if (report.ok) return report;
  const first = report.errors[0];
  if (!options.json) renderReport(report);
  throw new CliCommandError(first?.code ?? 'EXTENSION_INVALID', first?.message ?? 'Extension package is invalid.', report);
}

function renderReport(report: PackageReport): void {
  console.log(`Extension: ${report.manifest?.id ?? 'unknown'} (${report.root})`);
  console.log(`Status: ${report.ok ? 'valid' : 'invalid'}`);
  if (report.contentDigest) console.log(`Digest: ${report.contentDigest} (${report.files.length} files)`);
  renderDiagnostics('error', report.errors);
  renderDiagnostics('warning', report.warnings);
}

function renderDiagnostics(level: string, diagnostics: PackageDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.log(`- ${level} ${diagnostic.code}: ${diagnostic.message}${diagnostic.path ? ` [${diagnostic.path}]` : ''}`);
  }
}
