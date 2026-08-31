import { env } from './config/env';
import { logger } from './core/logger';
import type { AIProvider } from './core/types';
import { AIFallbackRouter } from './ai/fallbackRouter';
import { OpenRouterProvider } from './ai/providers/openrouter';
import { GroqProvider } from './ai/providers/groq';
import { MemoryDatabase } from './memory/db';
import { HuggingFaceEmbeddingProvider } from './memory/embeddings/huggingface';
import { NoopEmbeddingProvider } from './memory/embeddings/none';
import { ContextBuilder } from './memory/contextBuilder';
import { Summarizer } from './memory/summarizer';
import { ToolRegistry } from './tools/toolRegistry';
import { SkillRegistry } from './skills/registry';
import { createBot, type Bot } from './telegram/bot';
import { registerCommands } from './telegram/handlers/commands';
import { createMessageHandler } from './telegram/handlers/message';
import { createDocumentHandler } from './telegram/handlers/document';

const log = logger.child({ module: 'app' });

export interface App {
  bot: Bot;
  db: MemoryDatabase;
  ai: AIFallbackRouter;
  tools: ToolRegistry;
}

/**
 * Builds every layer (AI providers -> memory -> tools -> Telegram) and
 * wires them together, but does NOT start long-polling. Call `bot.start()`
 * on the returned app yourself (see index.ts) — separating "build" from
 * "run" is what lets the smoke tests exercise the full wiring without
 * needing a live Telegram connection.
 */
export function createApp(): App {
  const providers: AIProvider[] = [];
  const openrouter = new OpenRouterProvider(env.OPENROUTER_API_KEY, env.OPENROUTER_MODEL);
  const groq = new GroqProvider(env.GROQ_API_KEY, env.GROQ_MODEL);
  if (openrouter.isConfigured) providers.push(openrouter);
  else log.warn('OPENROUTER_API_KEY not set — OpenRouter provider disabled');
  if (groq.isConfigured) providers.push(groq);
  else log.warn('GROQ_API_KEY not set — Groq provider disabled');

  const ai = new AIFallbackRouter(providers);

  const embeddings =
    env.EMBEDDINGS_PROVIDER === 'huggingface'
      ? new HuggingFaceEmbeddingProvider(env.HUGGINGFACE_API_KEY)
      : new NoopEmbeddingProvider();

  const db = new MemoryDatabase(env.WORK_DIR);
  const skills = new SkillRegistry(embeddings);
  const contextBuilder = new ContextBuilder(db, embeddings, skills);
  const summarizer = new Summarizer(db, ai, embeddings);
  const tools = new ToolRegistry(env.FILES_DIR);

  const bot = createBot(env.TELEGRAM_BOT_TOKEN || 'unset-token');

  registerCommands(bot, { db, ai, startedAt: Date.now() });

  const sharedDeps = {
    db,
    ai,
    contextBuilder,
    summarizer,
    tools,
    embed: (text: string) => embeddings.embed(text),
  };

  const handleMessage = createMessageHandler(sharedDeps);
  bot.on('message:text', handleMessage);

  const handleDocument = createDocumentHandler({ ...sharedDeps, botToken: env.TELEGRAM_BOT_TOKEN || 'unset-token' });
  bot.on('message:document', handleDocument);

  return { bot, db, ai, tools };
}
