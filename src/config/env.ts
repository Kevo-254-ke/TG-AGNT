import 'dotenv/config';
import { z } from 'zod';

/**
 * Central env schema. Every setting the app reads lives here so there is
 * exactly one place that knows what configuration exists and what its
 * defaults are. Nothing else in the codebase should touch `process.env`
 * directly — import `env` instead.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().default(''),

  // AI providers (fallback order: OpenRouter -> Groq -> degraded mode)
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_MODEL: z.string().default('deepseek/deepseek-chat'),
  GROQ_API_KEY: z.string().default(''),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(1000),
  AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),

  // Agent execution guardrails
  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(8),
  AGENT_MAX_TOOL_CALLS_PER_STEP: z.coerce.number().int().positive().default(10),
  AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Embeddings (used for vector-search memory retrieval)
  EMBEDDINGS_PROVIDER: z.enum(['huggingface', 'none']).default('huggingface'),
  HUGGINGFACE_API_KEY: z.string().default(''),
  HUGGINGFACE_MODEL: z
    .string()
    .default('sentence-transformers/all-MiniLM-L6-v2'),

  // Storage / memory
  WORK_DIR: z.string().default('./data'),
  FILES_DIR: z.string().default('./files'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(10),
  SUMMARIZE_AFTER_MESSAGES: z.coerce.number().int().positive().default(20),
  RECENT_MESSAGES_WINDOW: z.coerce.number().int().positive().default(6),
  SIMILAR_MESSAGES_LIMIT: z.coerce.number().int().nonnegative().default(2),
  SIMILAR_SUMMARIES_LIMIT: z.coerce.number().int().nonnegative().default(2),
  MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Code execution sandbox
  CODE_EXEC_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  CODE_EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  // Resource guardrails (Termux has 2-4GB RAM total)
  MAX_MEMORY_MB: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment configuration — check your .env file');
  }
  return parsed.data;
}

export const env = loadEnv();
