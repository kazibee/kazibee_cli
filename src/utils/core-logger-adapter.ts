import { getLogger } from '@noego/logger';
import type { ILogger } from '@bashly/core';

/**
 * Bridges @noego/logger (sync) to @bashly/core's ILogger (async).
 * Core expects ILogger methods to return Promise<void>, but @noego/logger
 * methods are synchronous. This adapter wraps the sync calls to satisfy
 * the async interface.
 */
export function createCoreLoggerAdapter(name: string, onProgress?: (message: string) => void): ILogger {
  const logger = getLogger(name);

  return {
    async info(message: string, data?: Record<string, unknown>): Promise<void> {
      onProgress?.(message);
      logger.info(message, data);
    },
    async warn(message: string, data?: Record<string, unknown>): Promise<void> {
      onProgress?.(message);
      logger.warn(message, data);
    },
    async error(message: string, data?: Record<string, unknown>): Promise<void> {
      onProgress?.(message);
      logger.error(message, data);
    },
  };
}
