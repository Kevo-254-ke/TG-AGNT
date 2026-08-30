import { InputFile } from 'grammy';
import { env } from '../../config/env';
import { logger } from '../../core/logger';
import type { AIFallbackRouter } from '../../ai/fallbackRouter';
import { runAgentLoop, type AgentStep } from '../../ai/agentLoop';
import type { MemoryDatabase } from '../../memory/db';
import type { ContextBuilder } from '../../memory/contextBuilder';
import type { Summarizer } from '../../memory/summarizer';
import { FILE_PRODUCING_TOOLS, type ToolRegistry } from '../../tools/toolRegistry';
import { estimateTokens } from '../../utils/tokenCounter';
import { StatusReporter } from '../statusReporter';
import { describeToolCall, randomThinkingPhrase } from '../toolStatusMessages';
import type { BotContext } from '../bot';

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
 *   persist user msg -> build smart context -> run the agent loop (which
 *   may ask the AI several times in a row, executing tool calls scoped
 *   to this user's own workspace in between) -> deliver any resulting
 *   files as real Telegram attachments -> persist assistant msg -> maybe
 *   summarize in the background.
 *
 * A single status message is edited in place throughout ("🤔 Thinking..."
 * -> "📂 Unzipping bundle.zip..." -> ...) so a slow AI call or a
 * multi-step tool sequence (e.g. "make three files") shows live progress
 * instead of the chat going silent — then it's deleted right before the
 * real reply/tool results are sent.
 *
 * Kept as a plain function (not a class) taking its dependencies as a
 * parameter object — easy to unit test by passing fakes, no framework
 * coupling to grammY beyond the ctx shape it reads from/replies to.
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

    try {
      const context = await deps.contextBuilder.build(user._id, text);
      log.debug({ userId: user._id, sources: context.sources, tokenEstimate: context.tokenEstimate }, 'Context built');

      const run = await runAgentLoop(
        {
          ai: deps.ai,
          tools: deps.tools,
          maxIterations: env.AGENT_MAX_STEPS,
          onToolCall: (toolCall) => status.update(describeToolCall(toolCall.name, toolCall.arguments)),
        },
        context.messages,
        user._id,
      );

      await status.clear();

      if (run.finalContent) {
        await sendChunked(ctx, run.finalContent);
      }
      for (const step of run.steps) {
        await sendChunked(ctx, `${step.result.success ? '✅' : '⚠️'} ${step.result.message}`);
      }
      if (run.hitStepLimit) {
        await ctx.reply(`⏱️ Hit the ${env.AGENT_MAX_STEPS}-step limit for this turn — say "continue" if there's more to do.`);
      }

      await deliverFileArtifacts(ctx, deps.tools, user._id, run.steps);

      const assistantEmbedding = await deps.embed(run.finalContent || '(tool calls)');
      const toolNames = run.steps.map((s) => s.toolCall.name);
      await deps.db.saveMessage(
        user._id,
        'assistant',
        run.finalContent || `[used tool(s): ${toolNames.join(', ') || 'none'}]`,
        estimateTokens(run.finalContent),
        assistantEmbedding,
      );

      // Fire-and-forget: summarization shouldn't block the reply.
      void deps.summarizer.maybeSummarize(user._id, env.SUMMARIZE_AFTER_MESSAGES);
    } catch (err) {
      await status.clear();
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to handle message');
      await ctx.reply('❌ Something went wrong generating a response. Please try again.');
    }
  };
}

/**
 * Sends actual file attachments for anything created/updated/zipped
 * across the whole agent run, instead of leaving the user with only a
 * text description of a file they can't open.
 *
 * Default is one attachment per file (each successful create_file /
 * update_file step, across every iteration of the loop — this is what
 * makes "make three separate files" actually deliver three attachments).
 * If the AI bundled files into an archive at any point (zip_files —
 * normally because the user asked for one, or several related files
 * belonged together), only the archive is sent, not every individual
 * file that went into it, to avoid duplicate noise.
 */
async function deliverFileArtifacts(ctx: BotContext, tools: ToolRegistry, userId: string, steps: AgentStep[]): Promise<void> {
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

function collectArtifactPaths(steps: AgentStep[], matches: (toolName: string) => boolean): string[] {
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
