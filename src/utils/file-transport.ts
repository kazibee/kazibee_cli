import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LogEntry, LogTransport } from '@noego/logger';

const LOG_DIR = join(homedir(), '.kazibee', 'logs');

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getLogFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const week = String(getISOWeek(now)).padStart(2, '0');
  return `kazibee-${year}-W${week}.log`;
}

export class FileTransport implements LogTransport {
  private ensuredDir = false;

  private ensureDir(): void {
    if (this.ensuredDir) return;
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    this.ensuredDir = true;
  }

  log(entry: LogEntry): void {
    this.ensureDir();

    const contextStr = entry.context !== undefined
      ? ` ${JSON.stringify(entry.context)}`
      : '';
    const line = `[${entry.timestamp}] [${entry.logger}] [${entry.level}] ${entry.message}${contextStr}\n`;

    appendFileSync(join(LOG_DIR, getLogFileName()), line);
  }
}
