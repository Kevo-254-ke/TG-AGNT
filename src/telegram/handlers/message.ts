import { InputFile } from 'grammy';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { AIFallbackRouter } from '../../ai/fallbackRouter';
import { ExecutionController } from '../../ai/executionController';
import { CancellationToken } from '../../ai/cancellation';
import type { MemoryDatabase } from '../../memory/db';
import type { ContextBuilder } from '../../memory/contextBuilder';
import type { Summarizer } from '../../memory/summarizer';
import { FILE_PRODUCING_TOOLS, type ToolRegistry } from '../../tools/toolRegistry';
import { estimateTokens } from '../../utils/tokenCounter';
import { StatusReporter } from '../statusReporter';
import { describeToolCall, randomThinkingPhrase } from '../toolStatusMessages';
import type { BotContext } from '../bot';
import {
  setActiveExecution,
  clearActiveExecution,
  setPendingDocumentRequest,
  clearPendingDocumentRequest,
} from '../executionState';

const log = logger.child({ module: 'telegram:messageHandler' });
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;

export interface MessageHandlerDeps {
  db: MemoryDatabase;
  ai: AIFallbackRouter;
  contextBuilder: ContextBuilder;
  summarizer: Summarizer;
  tools: ToolRegistry;
  embed: (text: string) => Promise<number[] | null>;
}

/**
 * One turn of the conversation loop:
 *   persist user msg -> build smart context -> run the agent loop via
 *   ExecutionController (with guardrails, cancellation, and metadata)
 *   -> deliver any resulting files as real Telegram attachments ->
 *   persist assistant msg -> maybe summarize in the background.
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  return async function handleMessage(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id;
    const text = ctx.message?.text;
    if (telegramId === undefined || !text) return;

    const user = await deps.db.upsertUser(telegramId, ctx.from?.first_name ?? 'there');
    await ctx.replyWithChatAction('typing').catch(() => undefined);

    const status = new StatusReporter(ctx);
    await status.start(randomThinkingPhrase());

    const userEmbedding = await deps.embed(text);
    await deps.db.saveMessage(user._id, 'user', text, estimateTokens(text), userEmbedding);

    // Create cancellation token for this execution
    const cancellationToken = new CancellationToken();
    setActiveExecution(user._id, cancellationToken);

    try {
      const context = await deps.contextBuilder.build(user._id, text);
      log.debug({ userId: user._id, sources: context.sources, tokenEstimate: context.tokenEstimate }, 'Context built');

      const controller = new ExecutionController(
        { ai: deps.ai, tools: deps.tools },
        {
          maxIterations: env.AGENT_MAX_STEPS,
          maxToolCallsPerStep: env.AGENT_MAX_TOOL_CALLS_PER_STEP,
          toolTimeoutMs: env.AGENT_TOOL_TIMEOUT_MS,
        },
      );

      const run = await controller.run({
        messages: context.messages,
        userId: user._id,
        onToolCall: (toolCall) => status.update(describeToolCall(toolCall.name, toolCall.arguments)),
        cancellationToken,
      });

      await status.clear();

      // Deliver final content
      if (run.finalContent) {
        await sendChunked(ctx, run.finalContent);
      }

      // Deliver tool results as status messages (concise)
      for (const step of run.steps) {
        await sendChunked(ctx, `${step.result.success ? '✅' : '⚠️'} ${step.result.message}`);
      }

      // Notify user if we hit a limit
      if (run.terminationReason === 'max_iterations') {
        await ctx.reply(`⏱️ Hit the ${env.AGENT_MAX_STEPS}-step limit for this turn — say "continue" if there's more to do.`);
      } else if (run.terminationReason === 'max_tool_calls_per_step') {
        await ctx.reply(`⏱️ Hit the ${env.AGENT_MAX_TOOL_CALLS_PER_STEP} tool-call limit in one step — try a more focused request.`);
      } else if (run.terminationReason === 'cancelled') {
        await ctx.reply('⏹️ Execution stopped.');
      } else if (run.terminationReason === 'provider_failure') {
        await ctx.reply('❌ All AI providers are currently unavailable. Please try again later.');
      }

      // Send file attachments
      await deliverFileArtifacts(ctx, deps.tools, user._id, run.steps);

      // Persist assistant message
      const assistantEmbedding = await deps.embed(run.finalContent || '(tool calls)');
      const toolNames = run.steps.map((s) => s.toolCall.name);
      await deps.db.saveMessage(
        user._id,
        'assistant',
        run.finalContent || `[used tool(s): ${toolNames.join(', ') || 'none'}]`,
        estimateTokens(run.finalContent),
        assistantEmbedding,
      );

      // Detect if AI asked for a document upload
      detectAndTrackDocumentRequest(user._id, run.finalContent);

      // Fire-and-forget summarization
      void deps.summarizer.maybeSummarize(user._id, env.SUMMARIZE_AFTER_MESSAGES);
    } catch (err) {
      await status.clear();
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to handle message');
      await ctx.reply('❌ Something went wrong generating a response. Please try again.');
    } finally {
      clearActiveExecution(user._id);
    }
  };
}

/**
 * Heuristic: if the AI's final message asks the user to upload/send a file,
 * set a pending document request so the document handler can process the
 * upload automatically without making the user type an extra message.
 */
function detectAndTrackDocumentRequest(userId: string, content: string | null): void {
  if (!content) {
    clearPendingDocumentRequest(userId);
    return;
  }
  const lower = content.toLowerCase();
  const askingForFile =
    lower.includes('upload') ||
    lower.includes('send me') ||
    lower.includes('attach the') ||
    lower.includes('share the file') ||
    lower.includes('send the file') ||
    lower.includes('upload the') ||
    lower.includes('provide the file');

  if (askingForFile) {
    setPendingDocumentRequest(userId, content);
    log.debug({ userId }, 'AI asked for document — pending request set');
  } else {
    clearPendingDocumentRequest(userId);
  }
}

async function deliverFileArtifacts(ctx: BotContext, tools: ToolRegistry, userId: string, steps: Array<{ toolCall: { name: string }; result: { success: boolean; data?: unknown } }>): Promise<void> {
  const zipped = collectArtifactPaths(steps, (name) => name === 'zip_files');
  const singles = collectArtifactPaths(steps, (name) => name !== 'zip_files' && FILE_PRODUCING_TOOLS.has(name));

  const toSend = zipped.length > 0 ? zipped : singles;

  for (const relativePath of toSend) {
    try {
      const absolutePath = tools.resolvePath(userId, relativePath);
      await ctx.replyWithDocument(new InputFile(absolutePath));
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err), relativePath }, 'Failed to send file attachment');
    }
  }
}

function collectArtifactPaths(
  steps: Array<{ toolCall: { name: string }; result: { success: boolean; data?: unknown } }>,
  matches: (toolName: string) => boolean,
): string[] {
  const paths: string[] = [];
  for (const step of steps) {
    if (!step.result.success || !matches(step.toolCall.name)) continue;
    const data = step.result.data as { path?: unknown } | undefined;
    if (data && typeof data.path === 'string') paths.push(data.path);
  }
  return paths;
}

async function sendChunked(ctx: BotContext, text: string): Promise<void> {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    await ctx.reply(text);
    return;
  }
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_MESSAGE_LENGTH) {
    await ctx.reply(text.slice(i, i + TELEGRAM_MAX_MESSAGE_LENGTH));
  }
}
