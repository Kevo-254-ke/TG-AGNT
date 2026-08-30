"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
require("dotenv/config");
const zod_1 = require("zod");
/**
 * Central env schema. Every setting the app reads lives here so there is
 * exactly one place that knows what configuration exists and what its
 * defaults are. Nothing else in the codebase should touch `process.env`
 * directly — import `env` instead.
 */
const EnvSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: zod_1.z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Telegram
    TELEGRAM_BOT_TOKEN: zod_1.z.string().default(''),
    // AI providers (fallback order: OpenRouter -> Groq -> degraded mode)
    OPENROUTER_API_KEY: zod_1.z.string().default(''),
    OPENROUTER_MODEL: zod_1.z.string().default('deepseek/deepseek-chat'),
    GROQ_API_KEY: zod_1.z.string().default(''),
    GROQ_MODEL: zod_1.z.string().default('llama-3.3-70b-versatile'),
    AI_MAX_TOKENS: zod_1.z.coerce.number().int().positive().default(1000),
    AI_TEMPERATURE: zod_1.z.coerce.number().min(0).max(2).default(0.7),
    AI_TIMEOUT_MS: zod_1.z.coerce.number().int().positive().default(90_000),
    // Safety cap on the tool-calling loop (ask AI -> run tool -> ask AI
    // again -> ...) for a single user turn, so a model that never stops
    // requesting tools can't loop forever.
    AGENT_MAX_STEPS: zod_1.z.coerce.number().int().positive().default(8),
    // Embeddings (used for vector-search memory retrieval)
    EMBEDDINGS_PROVIDER: zod_1.z.enum(['huggingface', 'none']).default('huggingface'),
    HUGGINGFACE_API_KEY: zod_1.z.string().default(''),
    HUGGINGFACE_MODEL: zod_1.z
        .string()
        .default('sentence-transformers/all-MiniLM-L6-v2'),
    // Storage / memory
    WORK_DIR: zod_1.z.string().default('./data'),
    // Base directory for all users' sandboxed file workspaces. Each Telegram
    // user gets their own subfolder here (FILES_DIR/<userId>/) — see
    // WorkspaceManager — so files are never shared across users.
    FILES_DIR: zod_1.z.string().default('./files'),
    MAX_FILE_SIZE_MB: zod_1.z.coerce.number().positive().default(10),
    SUMMARIZE_AFTER_MESSAGES: zod_1.z.coerce.number().int().positive().default(20),
    RECENT_MESSAGES_WINDOW: zod_1.z.coerce.number().int().positive().default(6),
    SIMILAR_MESSAGES_LIMIT: zod_1.z.coerce.number().int().nonnegative().default(2),
    SIMILAR_SUMMARIES_LIMIT: zod_1.z.coerce.number().int().nonnegative().default(2),
    MESSAGE_RETENTION_DAYS: zod_1.z.coerce.number().int().positive().default(30),
    // Code execution sandbox
    CODE_EXEC_ENABLED: zod_1.z
        .string()
        .default('true')
        .transform((v) => v === 'true'),
    CODE_EXEC_TIMEOUT_MS: zod_1.z.coerce.number().int().positive().default(8000),
    // Resource guardrails (Termux has 2-4GB RAM total)
    MAX_MEMORY_MB: zod_1.z.coerce.number().int().positive().default(300),
    RATE_LIMIT_PER_MINUTE: zod_1.z.coerce.number().int().positive().default(20),
});
function loadEnv() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
        throw new Error('Invalid environment configuration — check your .env file');
    }
    return parsed.data;
}
exports.env = loadEnv();
//# sourceMappingURL=env.js.map