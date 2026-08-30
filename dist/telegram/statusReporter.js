"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusReporter = void 0;
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'telegram:statusReporter' });
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
class StatusReporter {
    ctx;
    messageId = null;
    lastText = null;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async start(text) {
        try {
            const msg = await this.ctx.reply(text);
            this.messageId = msg.message_id;
            this.lastText = text;
        }
        catch (err) {
            log.debug({ err: describeErr(err) }, 'Failed to send status message');
        }
    }
    async update(text) {
        if (this.messageId === null || this.ctx.chat === undefined) {
            await this.start(text);
            return;
        }
        if (text === this.lastText)
            return; // Telegram rejects no-op edits with a 400
        try {
            await this.ctx.api.editMessageText(this.ctx.chat.id, this.messageId, text);
            this.lastText = text;
        }
        catch (err) {
            log.debug({ err: describeErr(err) }, 'Failed to edit status message');
        }
    }
    /** Removes the status message once real content is about to be sent. Safe to call multiple times. */
    async clear() {
        if (this.messageId === null || this.ctx.chat === undefined)
            return;
        const id = this.messageId;
        this.messageId = null;
        try {
            await this.ctx.api.deleteMessage(this.ctx.chat.id, id);
        }
        catch (err) {
            log.debug({ err: describeErr(err) }, 'Failed to delete status message');
        }
    }
}
exports.StatusReporter = StatusReporter;
function describeErr(err) {
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=statusReporter.js.map