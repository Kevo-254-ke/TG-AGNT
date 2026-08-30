import { logger } from '../core/logger';
import type { BotContext } from './bot';

const log = logger.child({ module: 'telegram:statusReporter' });

/**
 * Owns one Telegram message and edits its text in place as the bot
 * progresses through a turn (thinking -> running tool A -> running tool
 * B -> done), instead of the chat going silent for the duration of a
 * slow AI call or a multi-step tool sequence.
 *
 * Every Telegram call here is best-effort: a failed edit (e.g. "message
 * is not modified", or the message got deleted by the user) is logged
 * and swallowed rather than thrown — a cosmetic progress indicator must
 * never be able to break the actual conversation flow.
 */
export class StatusReporter {
  private messageId: number | null = null;
  private lastText: string | null = null;

  constructor(private readonly ctx: BotContext) {}

  async start(text: string): Promise<void> {
    try {
      const msg = await this.ctx.reply(text);
      this.messageId = msg.message_id;
      this.lastText = text;
    } catch (err) {
      log.debug({ err: describeErr(err) }, 'Failed to send status message');
    }
  }

  async update(text: string): Promise<void> {
    if (this.messageId === null || this.ctx.chat === undefined) {
      await this.start(text);
      return;
    }
    if (text === this.lastText) return; // Telegram rejects no-op edits with a 400
    try {
      await this.ctx.api.editMessageText(this.ctx.chat.id, this.messageId, text);
      this.lastText = text;
    } catch (err) {
      log.debug({ err: describeErr(err) }, 'Failed to edit status message');
    }
  }

  /** Removes the status message once real content is about to be sent. Safe to call multiple times. */
  async clear(): Promise<void> {
    if (this.messageId === null || this.ctx.chat === undefined) return;
    const id = this.messageId;
    this.messageId = null;
    try {
      await this.ctx.api.deleteMessage(this.ctx.chat.id, id);
    } catch (err) {
      log.debug({ err: describeErr(err) }, 'Failed to delete status message');
    }
  }
}

function describeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
