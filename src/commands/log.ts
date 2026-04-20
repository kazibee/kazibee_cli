import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';

const LOG_DIR = join(homedir(), '.kazibee', 'logs');

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getCurrentLogFile(): string {
  const now = new Date();
  const year = now.getFullYear();
  const week = String(getISOWeek(now)).padStart(2, '0');
  return join(LOG_DIR, `kazibee-${year}-W${week}.log`);
}

interface LogOptions {
  file?: boolean;
}

export function log(options: LogOptions = {}): void {
  if (options.file) {
    const logFile = getCurrentLogFile();
    if (existsSync(logFile)) {
      console.log(logFile);
    } else if (existsSync(LOG_DIR)) {
      const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort();
      if (files.length > 0) {
        console.log(join(LOG_DIR, files[files.length - 1]));
      } else {
        console.log(logFile);
      }
    } else {
      console.log(logFile);
    }
    return;
  }

  // Default: print current log file path
  console.log(getCurrentLogFile());
}
