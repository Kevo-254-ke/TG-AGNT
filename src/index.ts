import { env } from './config/env';
import { logger } from './core/logger';
import { createApp } from './app';
import { startMemoryMonitor } from './utils/memoryMonitor';

const log = logger.child({ module: 'main' });

async function main(): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    log.error('TELEGRAM_BOT_TOKEN is not set — copy .env.example to .env and fill it in. Exiting.');
    process.exit(1);
  }

  const app = createApp();
  const memoryMonitorHandle = startMemoryMonitor(env.MAX_MEMORY_MB);
  const pruneHandle = setInterval(() => {
    void app.db.pruneOldMessages(env.MESSAGE_RETENTION_DAYS);
  }, 24 * 60 * 60 * 1000);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down…');
    clearInterval(memoryMonitorHandle);
    clearInterval(pruneHandle);
    await app.bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.bot.start({
    onStart: () => log.info('🤖 Bot started — long-polling for updates'),
    allowed_updates: ['message', 'edited_message'],
  });
}

main().catch((err) => {
  log.fatal({ err: err instanceof Error ? err.stack : String(err) }, 'Fatal startup error');
  process.exit(1);
});
