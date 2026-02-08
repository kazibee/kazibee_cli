import linkSpec from '../../specs/LINK_SPEC.md' with { type: 'text' };
import permissionsSpec from '../../specs/PERMISSIONS_SPEC.md' with { type: 'text' };

const SPEC_REGISTRY = {
  LINK_SPEC: linkSpec,
  PERMISSIONS_SPEC: permissionsSpec,
} as const;

type SpecName = keyof typeof SPEC_REGISTRY;

function normalizeSpecName(input: string): string {
  return input.trim().toUpperCase().replace(/\.MD$/, '');
}

function resolveSpecName(input: string): SpecName | null {
  const normalized = normalizeSpecName(input);
  if (normalized in SPEC_REGISTRY) {
    return normalized as SpecName;
  }
  return null;
}

function printWithTrailingNewline(content: string): void {
  process.stdout.write(content);
  if (!content.endsWith('\n')) {
    process.stdout.write('\n');
  }
}

export async function toolSpec(specName?: string): Promise<void> {
  const available = Object.keys(SPEC_REGISTRY);

  if (!specName) {
    for (const name of available) {
      console.log(name);
    }
    return;
  }

  const resolved = resolveSpecName(specName);
  if (!resolved) {
    console.error(`Unknown spec "${specName}". Available: ${available.join(', ')}`);
    process.exit(1);
  }

  printWithTrailingNewline(SPEC_REGISTRY[resolved]);
}
