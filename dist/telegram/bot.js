"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
const grammy_1 = require("grammy");
const env_1 = require("../config/env");
const rateLimiter_1 = require("./middleware/rateLimiter");
const errorHandler_1 = require("./middleware/errorHandler");
/** Constructs the grammY bot with shared middleware already attached. */
function createBot(token) {
    const bot = new grammy_1.Bot(token);
    (0, errorHandler_1.registerErrorHandler)(bot);
    bot.use((0, rateLimiter_1.createRateLimiter)(env_1.env.RATE_LIMIT_PER_MINUTE));
    return bot;
}
//# sourceMappingURL=bot.js.map