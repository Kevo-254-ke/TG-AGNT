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
  hasActiveExecution,
  setActiveExecution,
  clearActiveExecution,
  hasPendingDocumentRequest,
  clearPendingDocumentRequest,
  getPendingDocumentContext,
} from '../executionState';

const log = logger.child({ module: 'telegram:documentHandler' });
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const TELEGRAM_MAX_FILE_SIZE_MB = 20;

export interface DocumentHandlerDeps {
  db: MemoryDatabase;
  ai: AIFallbackRouter;
  contextBuilder: ContextBuilder;
  summarizer: Summarizer;
  tools: ToolRegistry;
  embed: (text: string) => Promise<number[] | null>;
  botToken: string;
}

export function createDocumentHandler(deps: DocumentHandlerDeps) {
  return async function handleDocument(ctx: BotContext): Promise<void> {
    const telegramId = ctx.from?.id;
    const document = ctx.message?.document;
    if (!telegramId || !document) return;

    const user = await deps.db.upsertUser(telegramId, ctx.from?.first_name ?? 'there');

    if (hasActiveExecution(user._id)) {
      await ctx.reply('⏳ I\'m still working on your previous request. Please wait or use /stop to cancel.');
      return;
    }

    const filename = document.file_name ?? `document-${document.file_id}`;
    const caption = ctx.message?.caption;
    const fileSizeMb = (document.file_size ?? 0) / (1024 * 1024);

    if (fileSizeMb > TELEGRAM_MAX_FILE_SIZE_MB) {
      await ctx.reply(`❌ This file is too large (${fileSizeMb.toFixed(1)} MB). Telegram limits downloads to ${TELEGRAM_MAX_FILE_SIZE_MB} MB.`);
      return;
    }

    await ctx.replyWithChatAction('typing').catch(() => undefined);

    try {
      const fileInfo = await ctx.api.getFile(document.file_id);
      if (!fileInfo.file_path) {
        await ctx.reply('❌ Could not retrieve the file from Telegram. It may be too large or unavailable.');
        return;
      }

      const fileUrl = `https://api.telegram.org/file/bot${deps.botToken}/${fileInfo.file_path}`;
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());

      const saved = await deps.tools.saveDocument(user._id, filename, buffer);
      log.info({ userId: user._id, filename: saved.path, bytes: saved.bytes, mimeType: document.mime_type }, 'Document saved to workspace');

      const hasPending = hasPendingDocumentRequest(user._id);

      if (caption) {
        clearPendingDocumentRequest(user._id);
        const instruction = `${caption} (file: ${saved.path})`;
        await processDocumentTurn(ctx, deps, user._id, instruction, `📄 Received ${filename} — processing...`);
      } else if (hasPending) {
        const pendingContext = getPendingDocumentContext(user._id);
        clearPendingDocumentRequest(user._id);
        const instruction = pendingContext
          ? `Here is the document you requested. ${pendingContext} (file: ${saved.path})`
          : `Here is the document you requested: ${saved.path}`;
        await processDocumentTurn(ctx, deps, user._id, instruction, `📄 Processing ${filename}...`);
      } else {
        await ctx.reply(
          `📄 Received **${filename}** (${(saved.bytes / 1024).toFixed(1)} KB).\n\n` +
            `What would you like me to do with it? ` +
            `Reply with instructions like "summarize this", "extract the data", or "convert to JSON".`,
        );
      }
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err), userId: user._id, filename }, 'Failed to handle document');
      await ctx.reply('❌ Failed to download or save the document. Please try again.');
    }
  };
}

async function processDocumentTurn(
  ctx: BotContext,
  deps: DocumentHandlerDeps,
  userId: string,
  instruction: string,
  statusText: string,
): Promise<void> {
  const status = new StatusReporter(ctx);
  await status.start(statusText);

  const userEmbedding = await deps.embed(instruction);
  await deps.db.saveMessage(userId, 'user', instruction, estimateTokens(instruction), userEmbedding);

  const cancellationToken = new CancellationToken();
  setActiveExecution(userId, cancellationToken);

  try {
    const context = await deps.contextBuilder.build(userId, instruction);
    log.debug({ userId, sources: context.sources, tokenEstimate: context.tokenEstimate }, 'Document context built');

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
      userId,
      onToolCall: (toolCall) => status.update(describeToolCall(toolCall.name, toolCall.arguments)),
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
      await ctx.reply(`⏱️ Hit the ${env.AGENT_MAX_STEPS}-step limit — say "continue" if there's more to do.`);
    } else if (run.terminationReason === 'max_tool_calls_per_step') {
      await ctx.reply(`⏱️ Hit the tool-call limit — try a more focused request.`);
    } else if (run.terminationReason === 'cancelled') {
      await ctx.reply('⏹️ Execution stopped.');
    } else if (run.terminationReason === 'provider_failure') {
      await ctx.reply('❌ All AI providers are currently unavailable. Please try again later.');
    }

    await deliverFileArtifacts(ctx, deps.tools, userId, run.steps);

    const assistantEmbedding = await deps.embed(run.finalContent || '(tool calls)');
    const toolNames = run.steps.map((s) => s.toolCall.name);
    await deps.db.saveMessage(
      userId,
      'assistant',
      run.finalContent || `[used tool(s): ${toolNames.join(', ') || 'none'}]`,
      estimateTokens(run.finalContent),
      assistantEmbedding,
    );

    void deps.summarizer.maybeSummarize(userId, env.SUMMARIZE_AFTER_MESSAGES);
  } catch (err) {
    await status.clear();
    log.error({ err: err instanceof Error ? err.message : String(err), userId }, 'Failed to process document turn');
    await ctx.reply('❌ Something went wrong processing the document. Please try again.');
  } finally {
    clearActiveExecution(userId);
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
