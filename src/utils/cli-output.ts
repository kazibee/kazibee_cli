export interface JsonOption {
  json?: boolean;
}

export interface CliJsonSuccess<T> {
  ok: true;
  data: T;
  warnings?: string[];
}

export interface CliJsonError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class CliCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CliCommandError';
  }
}

export function emitJson<T>(data: T, warnings?: string[]): void {
  const payload: CliJsonSuccess<T> = warnings && warnings.length > 0
    ? { ok: true, data, warnings }
    : { ok: true, data };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function emitJsonError(error: unknown): void {
  const payload: CliJsonError = {
    ok: false,
    error: normalizeCliError(error),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function normalizeCliError(error: unknown): CliJsonError['error'] {
  if (error instanceof CliCommandError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }

  return {
    code: 'COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function runCliCommand<T>(
  options: JsonOption | undefined,
  execute: () => Promise<T> | T,
  renderText: (data: T) => void,
): Promise<void> {
  try {
    const data = await execute();
    if (options?.json) {
      emitJson(data);
      return;
    }
    renderText(data);
  } catch (error) {
    if (options?.json) {
      emitJsonError(error);
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  }
}

export function maskValue(value: string): string {
  return `${value.slice(0, 4)}****`;
}
