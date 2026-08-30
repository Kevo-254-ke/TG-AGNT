"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const pino_1 = __importDefault(require("pino"));
const env_1 = require("../config/env");
/**
 * Single shared logger. Use `logger.child({ module: 'xyz' })` in each
 * module rather than instantiating pino again, so every log line carries
 * consistent metadata and can be filtered/redirected in one place.
 */
exports.logger = (0, pino_1.default)({
    level: env_1.env.LOG_LEVEL,
    transport: env_1.env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        }
        : undefined,
});
//# sourceMappingURL=logger.js.map