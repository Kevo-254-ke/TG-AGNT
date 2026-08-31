"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveExecution = getActiveExecution;
exports.hasActiveExecution = hasActiveExecution;
exports.createMessageHandler = createMessageHandler;
const grammy_1 = require("grammy");
const env_1 = require("../../config/env");
const logger_1 = require("../../core/logger");
const executionController_1 = require("../../ai/executionController");
const cancellation_1 = require("../../ai/cancellation");
const toolRegistry_1 = require("../../tools/toolRegistry");
const tokenCounter_1 = require("../../utils/tokenCounter");
const statusReporter_1 = require("../statusReporter");
const toolStatusMessages_1 = require("../toolStatusMessages");
const log = logger_1.logger.child({ module: 'telegram:messageHandler' });
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
/** Tracks one active execution per user so /stop can cancel it. */
const activeExecutions = new Map();
function getActiveExecution(userId) {
    return activeExecutions.get(userId);
}
function hasActiveExecution(userId) {
    const token = activeExecutions.get(userId);
    return token !== undefined && !token.isCancelled;
}
function createMessageHandler(deps) {
    return async function handleMessage(ctx) {
        const telegramId = ctx.from?.id;
        const text = ctx.message?.text;
        if (telegramId === undefined || !text)
            return;
        const user = await deps.db.upsertUser(telegramId, ctx.from?.first_name ?? 'there');
        await ctx.replyWithChatAction('typing').catch(() => undefined);
        const status = new statusReporter_1.StatusReporter(ctx);
        await status.start((0, toolStatusMessages_1.randomThinkingPhrase)());
        const userEmbedding = await deps.embed(text);
        await deps.db.saveMessage(user._id, 'user', text, (0, tokenCounter_1.estimateTokens)(text), userEmbedding);
        const cancellationToken = new cancellation_1.CancellationToken();
        activeExecutions.set(user._id, cancellationToken);
        try {
            const context = await deps.contextBuilder.build(user._id, text);
            log.debug({ userId: user._id, sources: context.sources, tokenEstimate: context.tokenEstimate }, 'Context built');
            const controller = new executionController_1.ExecutionController({ ai: deps.ai, tools: deps.tools }, {
                maxIterations: env_1.env.AGENT_MAX_STEPS,
                maxToolCallsPerStep: env_1.env.AGENT_MAX_TOOL_CALLS_PER_STEP,
                toolTimeoutMs: env_1.env.AGENT_TOOL_TIMEOUT_MS,
            });
            const run = await controller.run({
                messages: context.messages,
                userId: user._id,
                onToolCall: (toolCall) => status.update((0, toolStatusMessages_1.describeToolCall)(toolCall.name, toolCall.arguments)),
                cancellationToken,
            });
            await status.clear();
            if (run.finalContent) {
                await sendChunked(ctx, run.finalContent);
            }
            for (const step of run.steps) {
                await sendChunked(ctx, `${step.result.success ? '✅' : '⚠️'} ${step.result.message}`);
            }
            if (run.terminationReason === 'max_iterations') {
                await ctx.reply(`⏱️ Hit the ${env_1.env.AGENT_MAX_STEPS}-step limit for this turn — say "continue" if there's more to do.`);
            }
            else if (run.terminationReason === 'max_tool_calls_per_step') {
                await ctx.reply(`⏱️ Hit the ${env_1.env.AGENT_MAX_TOOL_CALLS_PER_STEP} tool-call limit in one step — try a more focused request.`);
            }
            else if (run.terminationReason === 'cancelled') {
                await ctx.reply('⏹️ Execution stopped.');
            }
            else if (run.terminationReason === 'provider_failure') {
                await ctx.reply('❌ All AI providers are currently unavailable. Please try again later.');
            }
            await deliverFileArtifacts(ctx, deps.tools, user._id, run.steps);
            const assistantEmbedding = await deps.embed(run.finalContent || '(tool calls)');
            const toolNames = run.steps.map((s) => s.toolCall.name);
            await deps.db.saveMessage(user._id, 'assistant', run.finalContent || `[used tool(s): ${toolNames.join(', ') || 'none'}]`, (0, tokenCounter_1.estimateTokens)(run.finalContent), assistantEmbedding);
            void deps.summarizer.maybeSummarize(user._id, env_1.env.SUMMARIZE_AFTER_MESSAGES);
        }
        catch (err) {
            await status.clear();
            log.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to handle message');
            await ctx.reply('❌ Something went wrong generating a response. Please try again.');
        }
        finally {
            activeExecutions.delete(user._id);
        }
    };
}
async function deliverFileArtifacts(ctx, tools, userId, steps) {
    const zipped = collectArtifactPaths(steps, (name) => name === 'zip_files');
    const singles = collectArtifactPaths(steps, (name) => name !== 'zip_files' && toolRegistry_1.FILE_PRODUCING_TOOLS.has(name));
    const toSend = zipped.length > 0 ? zipped : singles;
    for (const relativePath of toSend) {
        try {
            const absolutePath = tools.resolvePath(userId, relativePath);
            await ctx.replyWithDocument(new grammy_1.InputFile(absolutePath));
        }
        catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err), relativePath }, 'Failed to send file attachment');
        }
    }
}
function collectArtifactPaths(steps, matches) {
    const paths = [];
    for (const step of steps) {
        if (!step.result.success || !matches(step.toolCall.name))
            continue;
        const data = step.result.data;
        if (data && typeof data.path === 'string')
            paths.push(data.path);
    }
    return paths;
}
async function sendChunked(ctx, text) {
    if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
        await ctx.reply(text);
        return;
    }
    for (let i = 0; i < text.length; i += TELEGRAM_MAX_MESSAGE_LENGTH) {
        await ctx.reply(text.slice(i, i + TELEGRAM_MAX_MESSAGE_LENGTH));
    }
}
//# sourceMappingURL=message.js.map