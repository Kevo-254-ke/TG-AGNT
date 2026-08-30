import { Bot as GrammyBot, Context } from 'grammy';
import { env } from '../config/env';
import { createRateLimiter } from './middleware/rateLimiter';
import { registerErrorHandler } from './middleware/errorHandler';

export type BotContext = Context;
export type Bot = GrammyBot<BotContext>;

/** Constructs the grammY bot with shared middleware already attached. */
export function createBot(token: string): Bot {
  const bot: Bot = new GrammyBot(token);
  registerErrorHandler(bot);
  bot.use(createRateLimiter(env.RATE_LIMIT_PER_MINUTE));
  return bot;
}
