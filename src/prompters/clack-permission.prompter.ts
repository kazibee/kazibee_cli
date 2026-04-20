import * as p from '@clack/prompts';
import type {
  IPermissionPrompter,
  EnvPermissionRequest,
  EnvPermissionCandidate,
  PermissionDecision,
} from '@kazibee/core';

function candidateLabel(candidate: EnvPermissionCandidate): string {
  return `${candidate.source}:${candidate.key}`;
}

export function createClackPermissionPrompter(): IPermissionPrompter {
  return {
    begin(toolName: string, _requestCount: number): void {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(
          `Tool "${toolName}" requests permissions, but install is non-interactive. Run install from an interactive terminal.`,
        );
      }
      p.intro(`Permissions for "${toolName}"`);
    },

    async prompt(
      _toolName: string,
      request: EnvPermissionRequest,
      _index: number,
    ): Promise<PermissionDecision> {
      const isUnscoped = request.candidates.length > 1;

      type SelectValue = 'deny' | 'any' | `source:${number}`;

      const options: { value: SelectValue; label: string; hint?: string }[] = [];

      if (isUnscoped) {
        options.push({ value: 'any', label: 'Any source', hint: 'auto-resolve at runtime' });
      }

      for (let i = 0; i < request.candidates.length; i++) {
        options.push({
          value: `source:${i}`,
          label: candidateLabel(request.candidates[i]),
        });
      }

      options.push({ value: 'deny', label: 'Deny' });

      const selected = await p.select({
        message: `Inject "${request.injectedKey}" from:`,
        options,
        initialValue: options[0].value,
      });

      if (p.isCancel(selected)) {
        p.cancel('Permission setup cancelled.');
        process.exit(1);
      }

      if (selected === 'deny') {
        return { action: 'deny' };
      }

      if (selected === 'any') {
        return { action: 'any' };
      }

      const candidateIndex = Number.parseInt((selected as string).slice('source:'.length), 10);
      return { action: 'specific', candidateIndex };
    },

    end(grantedCount: number, deniedCount: number): void {
      p.outro('Permissions saved.');
    },
  };
}
