import packageSpec from '../../specs/EXTENSION_PACKAGE_SPEC.md' with { type: 'text' };
import authoringGuide from '../../llm.txt' with { type: 'text' };

/**
 * The guidance the CLI prints, embedded at build time so the compiled binary
 * carries it. `package` is the full package contract; `guide` is the short
 * authoring guide for agents.
 */
const SPECS: Record<string, string> = {
  package: packageSpec,
  guide: authoringGuide,
};

const ALIASES: Record<string, string> = {
  'extension-package-spec': 'package',
  'extension_package_spec': 'package',
  llm: 'guide',
};

export default class SpecCatalog {
  names(): string[] {
    return Object.keys(SPECS);
  }

  read(name: string): string | null {
    const key = name.trim().toLowerCase().replace(/\.(?:md|txt)$/, '');
    return SPECS[ALIASES[key] ?? key] ?? null;
  }
}
