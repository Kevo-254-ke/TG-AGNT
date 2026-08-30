import { logger } from '../core/logger';
import type { AIProvider, EmbeddingProvider, StoredMessage } from '../core/types';
import { estimateTokens } from '../utils/tokenCounter';
import type { MemoryDatabase } from './db';

const log = logger.child({ module: 'memory:summarizer' });

/**
 * Periodically compresses a user's message history into short summaries
 * (goal / key decisions / outcome), each with its own embedding so it can
 * later be retrieved by ContextBuilder just like a message. This is what
 * lets the bot "remember" a conversation from weeks ago without resending
 * it in full every turn.
 */
export class Summarizer {
  constructor(
    private readonly db: MemoryDatabase,
    private readonly ai: { chat: AIProvider['chat'] },
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async maybeSummarize(userId: string, thresholdMessages: number): Promise<void> {
    const recent = await this.db.getRecentMessages(userId, thresholdMessages + 1);
    if (recent.length <= thresholdMessages) return;

    const batch = recent.slice(0, thresholdMessages);
    try {
      const summaryText = await this.summarizeBatch(batch);
      const embedding = await this.embeddings.embed(summaryText);

      await this.db.saveSummary({
        userId,
        summary: summaryText,
        messageCount: batch.length,
        embedding,
        tokens: estimateTokens(summaryText),
        dateRangeStart: batch[0].createdAt,
        dateRangeEnd: batch[batch.length - 1].createdAt,
      });

      log.info({ userId, messageCount: batch.length }, 'Summarized conversation batch');
    } catch (err) {
      // Summarization is a background optimization — never let it break the chat flow.
      log.warn({ userId, err: err instanceof Error ? err.message : String(err) }, 'Summarization failed, skipping');
    }
  }

  private async summarizeBatch(messages: StoredMessage[]): Promise<string> {
    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const response = await this.ai.chat([
      { role: 'system', content: 'Summarize this conversation in 2-3 sentences. Focus on the goal, key decisions, and current status. Be terse.' },
      { role: 'user', content: transcript },
    ]);
    return response.content.trim();
  }
}
