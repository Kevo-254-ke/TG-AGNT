"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const logger_1 = require("./core/logger");
const app_1 = require("./app");
const memoryMonitor_1 = require("./utils/memoryMonitor");
const log = logger_1.logger.child({ module: 'main' });
async function main() {
    if (!env_1.env.TELEGRAM_BOT_TOKEN) {
        log.error('TELEGRAM_BOT_TOKEN is not set — copy .env.example to .env and fill it in. Exiting.');
        process.exit(1);
    }
    const app = (0, app_1.createApp)();
    const memoryMonitorHandle = (0, memoryMonitor_1.startMemoryMonitor)(env_1.env.MAX_MEMORY_MB);
    const pruneHandle = setInterval(() => {
        void app.db.pruneOldMessages(env_1.env.MESSAGE_RETENTION_DAYS);
    }, 24 * 60 * 60 * 1000);
    const shutdown = async (signal) => {
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
//# sourceMappingURL=index.js.map