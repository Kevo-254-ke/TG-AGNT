import { env } from '../config/env';
import { logger } from '../core/logger';
import type { BuiltContext, ChatMessage, EmbeddingProvider } from '../core/types';
import { estimateTokens } from '../utils/tokenCounter';
import type { MemoryDatabase } from './db';
import { topKBySimilarity } from './vectorSearch';

const log = logger.child({ module: 'memory:contextBuilder' });

const SYSTEM_PROMPT =
  'You are a helpful coding assistant running inside a Telegram bot. ' +
  'You can create, read, update, delete, list, zip/unzip files, and run short code snippets via tools — each user has their own private workspace. ' +
  'You may call tools across multiple turns in a row — after a tool result comes back, keep going if the task needs more steps. ' +
  'When asked for several files (e.g. separate HTML, CSS, and JS files), create every one of them with its own create_file call, one at a time, before writing your final summary — do not stop after the first file. ' +
  "Any file you create or update is automatically sent to the user as a real file attachment, so don't paste large file contents into your reply — just describe what you did briefly. " +
  'If the user asks for a zip, or you produce multiple related files that belong together, call zip_files to bundle them — only the archive gets sent in that case, not each file separately. Otherwise, when the user asks for files "separately", do not zip them. ' +
  'Be concise — replies are read on a phone screen.';

/**
 * Builds the message array sent to the AI provider each turn, trading
 * "send the whole history" for "send what's relevant": a small recent
 * window plus vector-retrieved similar messages/summaries. This is the
 * single biggest lever for keeping a $0 free-tier bot within rate limits.
 */
export class ContextBuilder {
  constructor(
    private readonly db: MemoryDatabase,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async build(userId: string, userMessage: string): Promise<BuiltContext> {
    const queryEmbedding = await this.embeddings.embed(userMessage);

    if (!queryEmbedding) {
      log.debug('No query embedding available — using recency-only context');
      return this.buildBasicContext(userId, userMessage);
    }

    const [recent, allMessages, allSummaries] = await Promise.all([
      this.db.getRecentMessages(userId, env.RECENT_MESSAGES_WINDOW),
      this.db.getAllMessagesWithEmbeddings(userId),
      this.db.getAllSummariesWithEmbeddings(userId),
    ]);

    const recentIds = new Set(recent.map((m) => m._id));
    const searchable = allMessages.filter((m) => !recentIds.has(m._id));

    const similarMessages = topKBySimilarity(queryEmbedding, searchable, env.SIMILAR_MESSAGES_LIMIT);
    const similarSummaries = topKBySimilarity(queryEmbedding, allSummaries, env.SIMILAR_SUMMARIES_LIMIT);

    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (similarSummaries.length > 0) {
      const summaryText = similarSummaries.map((s) => `- ${s.summary}`).join('\n');
      messages.push({ role: 'system', content: `Relevant history:\n${summaryText}` });
    }

    if (similarMessages.length > 0) {
      const relatedText = similarMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
      messages.push({ role: 'system', content: `Related past messages:\n${relatedText}` });
    }

    for (const m of recent) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: userMessage });

    const tokenEstimate = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

    return {
      messages,
      tokenEstimate,
      sources: { recent: recent.length, similar: similarMessages.length, summaries: similarSummaries.length },
    };
  }

  /** Fallback when embeddings are unavailable — recency-only, still bounded. */
  private async buildBasicContext(userId: string, userMessage: string): Promise<BuiltContext> {
    const recent = await this.db.getRecentMessages(userId, env.RECENT_MESSAGES_WINDOW * 2);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...recent.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: 'user', content: userMessage },
    ];
    const tokenEstimate = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    return { messages, tokenEstimate, sources: { recent: recent.length, similar: 0, summaries: 0 } };
  }
}
