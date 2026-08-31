"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const env_1 = require("./config/env");
const logger_1 = require("./core/logger");
const fallbackRouter_1 = require("./ai/fallbackRouter");
const openrouter_1 = require("./ai/providers/openrouter");
const groq_1 = require("./ai/providers/groq");
const db_1 = require("./memory/db");
const huggingface_1 = require("./memory/embeddings/huggingface");
const none_1 = require("./memory/embeddings/none");
const contextBuilder_1 = require("./memory/contextBuilder");
const summarizer_1 = require("./memory/summarizer");
const toolRegistry_1 = require("./tools/toolRegistry");
const registry_1 = require("./skills/registry");
const bot_1 = require("./telegram/bot");
const commands_1 = require("./telegram/handlers/commands");
const message_1 = require("./telegram/handlers/message");
const document_1 = require("./telegram/handlers/document");
const log = logger_1.logger.child({ module: 'app' });
/**
 * Builds every layer (AI providers -> memory -> tools -> Telegram) and
 * wires them together, but does NOT start long-polling. Call `bot.start()`
 * on the returned app yourself (see index.ts) — separating "build" from
 * "run" is what lets the smoke tests exercise the full wiring without
 * needing a live Telegram connection.
 */
function createApp() {
    const providers = [];
    const openrouter = new openrouter_1.OpenRouterProvider(env_1.env.OPENROUTER_API_KEY, env_1.env.OPENROUTER_MODEL);
    const groq = new groq_1.GroqProvider(env_1.env.GROQ_API_KEY, env_1.env.GROQ_MODEL);
    if (openrouter.isConfigured)
        providers.push(openrouter);
    else
        log.warn('OPENROUTER_API_KEY not set — OpenRouter provider disabled');
    if (groq.isConfigured)
        providers.push(groq);
    else
        log.warn('GROQ_API_KEY not set — Groq provider disabled');
    const ai = new fallbackRouter_1.AIFallbackRouter(providers);
    const embeddings = env_1.env.EMBEDDINGS_PROVIDER === 'huggingface'
        ? new huggingface_1.HuggingFaceEmbeddingProvider(env_1.env.HUGGINGFACE_API_KEY)
        : new none_1.NoopEmbeddingProvider();
    const db = new db_1.MemoryDatabase(env_1.env.WORK_DIR);
    const skills = new registry_1.SkillRegistry(embeddings);
    const contextBuilder = new contextBuilder_1.ContextBuilder(db, embeddings, skills);
    const summarizer = new summarizer_1.Summarizer(db, ai, embeddings);
    const tools = new toolRegistry_1.ToolRegistry(env_1.env.FILES_DIR);
    const bot = (0, bot_1.createBot)(env_1.env.TELEGRAM_BOT_TOKEN || 'unset-token');
    (0, commands_1.registerCommands)(bot, { db, ai, startedAt: Date.now() });
    const sharedDeps = {
        db,
        ai,
        contextBuilder,
        summarizer,
        tools,
        embed: (text) => embeddings.embed(text),
    };
    const handleMessage = (0, message_1.createMessageHandler)(sharedDeps);
    bot.on('message:text', handleMessage);
    const handleDocument = (0, document_1.createDocumentHandler)({ ...sharedDeps, botToken: env_1.env.TELEGRAM_BOT_TOKEN || 'unset-token' });
    bot.on('message:document', handleDocument);
    return { bot, db, ai, tools };
}
//# sourceMappingURL=app.js.map