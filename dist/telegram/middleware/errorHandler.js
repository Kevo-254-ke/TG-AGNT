"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerErrorHandler = registerErrorHandler;
const grammy_1 = require("grammy");
const logger_1 = require("../../core/logger");
const log = logger_1.logger.child({ module: 'telegram:errorHandler' });
/** Registers a top-level error boundary so one bad update can't crash the process. */
function registerErrorHandler(bot) {
    bot.catch((err) => {
        const ctx = err.ctx;
        const ex = err.error;
        if (ex instanceof grammy_1.GrammyError) {
            log.error({ description: ex.description }, 'Telegram API error');
        }
        else if (ex instanceof grammy_1.HttpError) {
            log.error({ err: ex.message }, 'Network error reaching Telegram');
        }
        else {
            log.error({ err: ex instanceof Error ? ex.message : String(ex) }, 'Unexpected error in update handler');
        }
        ctx.reply('⚠️ Something went wrong handling that. It has been logged.').catch(() => undefined);
    });
}
//# sourceMappingURL=errorHandler.js.map