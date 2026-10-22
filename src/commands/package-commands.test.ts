import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import SpecCatalog from '../package/spec-catalog.js';
import { configurePackageCommands } from './package-commands.js';

describe('kazibee command surface', () => {
  it('exposes only validate and spec (plus the hidden legacy extension group)', () => {
    const program = new Command();
    configurePackageCommands(program);

    expect(program.commands.map((command) => command.name())).toEqual(['validate', 'spec', 'extension']);
    const legacy = program.commands.find((command) => command.name() === 'extension')!;
    expect(legacy.commands.map((command) => command.name()).sort()).toEqual(['generate', 'inspect', 'prepare', 'seal', 'validate', 'verify']);
  });
});

describe('kazibee spec', () => {
  it('embeds the package contract and the authoring guide, with legacy names as aliases', () => {
    const catalog = new SpecCatalog();

    expect(catalog.names()).toEqual(['package', 'guide']);
    expect(catalog.read('package')).toContain('Extension Package');
    expect(catalog.read('EXTENSION_PACKAGE_SPEC.md')).toBe(catalog.read('package'));
    expect(catalog.read('guide')).toContain('kazibee validate');
    expect(catalog.read('LINK_SPEC')).toBeNull();
  });

  it('describes no sealing, packaging or npm publishing step', () => {
    const catalog = new SpecCatalog();
    for (const name of catalog.names()) {
      const text = catalog.read(name)!;
      expect(text).not.toMatch(/kazibee (?:extension )?(?:seal|check|init|install|publish)\b/);
      expect(text).not.toMatch(/npm publish/);
    }
  });
});
