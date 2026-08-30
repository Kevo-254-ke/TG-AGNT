import type { NextFunction } from 'grammy';
import type { BotContext } from '../bot';

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Token-bucket rate limiter, one bucket per Telegram user id, held in
 * memory. Cheap and sufficient for a single-process Termux bot; if this
 * ever runs as multiple replicas, swap the Map for a shared store (Redis)
 * — the bucket logic itself doesn't need to change.
 */
export function createRateLimiter(perMinute: number) {
  const buckets = new Map<number, Bucket>();
  const refillPerMs = perMinute / 60_000;

  return async function rateLimiter(ctx: BotContext, next: NextFunction): Promise<void> {
    const userId = ctx.from?.id;
    if (userId === undefined) {
      await next();
      return;
    }

    const now = Date.now();
    const bucket = buckets.get(userId) ?? { tokens: perMinute, lastRefillMs: now };

    const elapsed = now - bucket.lastRefillMs;
    bucket.tokens = Math.min(perMinute, bucket.tokens + elapsed * refillPerMs);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      buckets.set(userId, bucket);
      await ctx.reply("You're sending messages a bit fast — give it a few seconds and try again.");
      return;
    }

    bucket.tokens -= 1;
    buckets.set(userId, bucket);
    await next();
  };
}
