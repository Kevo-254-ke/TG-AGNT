import pino from 'pino';
import { env } from '../config/env';

/**
 * Single shared logger. Use `logger.child({ module: 'xyz' })` in each
 * module rather than instantiating pino again, so every log line carries
 * consistent metadata and can be filtered/redirected in one place.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined,
});

export type Logger = typeof logger;
