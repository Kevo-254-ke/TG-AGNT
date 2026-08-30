import { GrammyError, HttpError } from 'grammy';
import { logger } from '../../core/logger';
import type { Bot } from '../bot';

const log = logger.child({ module: 'telegram:errorHandler' });

/** Registers a top-level error boundary so one bad update can't crash the process. */
export function registerErrorHandler(bot: Bot): void {
  bot.catch((err) => {
    const ctx = err.ctx;
    const ex = err.error;

    if (ex instanceof GrammyError) {
      log.error({ description: ex.description }, 'Telegram API error');
    } else if (ex instanceof HttpError) {
      log.error({ err: ex.message }, 'Network error reaching Telegram');
    } else {
      log.error({ err: ex instanceof Error ? ex.message : String(ex) }, 'Unexpected error in update handler');
    }

    ctx.reply('⚠️ Something went wrong handling that. It has been logged.').catch(() => undefined);
  });
}
