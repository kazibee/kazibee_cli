import { join } from 'path';
import { createInterface } from 'node:readline/promises';

export type PermissionSource = 'SYSTEM' | 'GLOBAL' | 'LOCAL';

export interface EnvPermissionCandidate {
  source: PermissionSource;
  key: string;
}

export interface EnvPermissionRequest {
  injectedKey: string;
  candidates: EnvPermissionCandidate[];
}

export interface EnvPermissionGrant {
  injectedKey: string;
  requestedCandidates: string[];
  granted: boolean;
  source: PermissionSource | null;
  sourceKey: string | null;
}

const SCOPED_ENV_RE = /^([A-Z]+):([A-Za-z_][A-Za-z0-9_]*)$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ANY_SOURCE_ORDER: PermissionSource[] = ['LOCAL', 'GLOBAL', 'SYSTEM'];

function assertEnvKey(value: string, context: string): string {
  if (!ENV_KEY_RE.test(value)) {
    throw new Error(`Invalid env key "${value}" in ${context}`);
  }
  return value;
}

function parseEnvToken(token: string, context: string): EnvPermissionCandidate[] {
  const scoped = token.match(SCOPED_ENV_RE);
  if (scoped) {
    const source = scoped[1];
    const key = assertEnvKey(scoped[2], context);

    if (source !== 'SYSTEM' && source !== 'GLOBAL' && source !== 'LOCAL') {
      throw new Error(`Invalid source "${source}" in ${context}. Expected SYSTEM, GLOBAL, or LOCAL.`);
    }

    return [{ source, key }];
  }

  const key = assertEnvKey(token, context);
  return ANY_SOURCE_ORDER.map(source => ({ source, key }));
}

function parsePermissionValue(
  injectedKey: string,
  rawValue: unknown,
): EnvPermissionCandidate[] {
  const context = `env permission "${injectedKey}"`;
  const seen = new Set<string>();
  const candidates: EnvPermissionCandidate[] = [];

  const addCandidates = (token: string): void => {
    for (const candidate of parseEnvToken(token, context)) {
      const id = `${candidate.source}:${candidate.key}`;
      if (!seen.has(id)) {
        seen.add(id);
        candidates.push(candidate);
      }
    }
  };

  if (typeof rawValue === 'string') {
    addCandidates(rawValue);
  } else if (Array.isArray(rawValue)) {
    if (rawValue.length === 0) {
      throw new Error(`Permission "${injectedKey}" must not be an empty array.`);
    }

    for (const item of rawValue) {
      if (typeof item !== 'string') {
        throw new Error(`Permission "${injectedKey}" array entries must be strings.`);
      }
      addCandidates(item);
    }
  } else {
    throw new Error(`Permission "${injectedKey}" must be a string or array of strings.`);
  }

  if (candidates.length === 0) {
    throw new Error(`Permission "${injectedKey}" has no valid candidates.`);
  }

  return candidates;
}

/**
 * Loads and validates env permissions for a tool install.
 *
 * Resolution:
 * 1) package.json -> kazibee.permissions (string path)
 * 2) fallback ./permissions.json
 */
export async function loadToolEnvPermissions(installPath: string): Promise<EnvPermissionRequest[]> {
  const pkgPath = join(installPath, 'package.json');
  const pkgFile = Bun.file(pkgPath);
  if (!(await pkgFile.exists())) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = await pkgFile.json() as Record<string, unknown>;
  const kazibeeField = pkg.kazibee as Record<string, unknown> | undefined;
  const permissionsRelPath = typeof kazibeeField?.permissions === 'string'
    ? kazibeeField.permissions
    : 'permissions.json';
  const permissionsPath = join(installPath, permissionsRelPath);

  const permissionsFile = Bun.file(permissionsPath);
  if (!(await permissionsFile.exists())) {
    return [];
  }

  const manifest = await permissionsFile.json() as Record<string, unknown>;
  const envSection = manifest.env;
  if (envSection === undefined) {
    return [];
  }
  if (!envSection || typeof envSection !== 'object' || Array.isArray(envSection)) {
    throw new Error(`Invalid permissions file at ${permissionsPath}: "env" must be an object.`);
  }

  const requests: EnvPermissionRequest[] = [];
  for (const [injectedKeyRaw, rawValue] of Object.entries(envSection)) {
    const injectedKey = assertEnvKey(injectedKeyRaw, `permissions file ${permissionsPath}`);
    const candidates = parsePermissionValue(injectedKey, rawValue);
    requests.push({ injectedKey, candidates });
  }

  return requests;
}

function candidateLabel(candidate: EnvPermissionCandidate): string {
  return `${candidate.source}:${candidate.key}`;
}

/**
 * Prompts the user to grant or deny each requested env permission.
 */
export async function promptForEnvPermissionGrants(
  toolName: string,
  requests: EnvPermissionRequest[],
): Promise<EnvPermissionGrant[]> {
  if (requests.length === 0) {
    return [];
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Tool "${toolName}" requests permissions, but install is non-interactive. Run install from an interactive terminal.`,
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`\nPermissions requested by "${toolName}":`);

    const grants: EnvPermissionGrant[] = [];

    for (const request of requests) {
      console.log(`\nInject "${request.injectedKey}" from:`);
      console.log('  1) Deny');
      request.candidates.forEach((candidate, idx) => {
        console.log(`  ${idx + 2}) ${candidateLabel(candidate)}`);
      });

      let selectedIndex = -1;
      const max = request.candidates.length + 1;
      while (selectedIndex < 1 || selectedIndex > max) {
        const answer = (await rl.question(`Choose [1-${max}]: `)).trim();
        const parsed = Number.parseInt(answer, 10);
        if (!Number.isNaN(parsed)) {
          selectedIndex = parsed;
        }
      }

      if (selectedIndex === 1) {
        grants.push({
          injectedKey: request.injectedKey,
          requestedCandidates: request.candidates.map(candidateLabel),
          granted: false,
          source: null,
          sourceKey: null,
        });
        continue;
      }

      const grantedCandidate = request.candidates[selectedIndex - 2];
      grants.push({
        injectedKey: request.injectedKey,
        requestedCandidates: request.candidates.map(candidateLabel),
        granted: true,
        source: grantedCandidate.source,
        sourceKey: grantedCandidate.key,
      });
    }

    return grants;
  } finally {
    rl.close();
  }
}

