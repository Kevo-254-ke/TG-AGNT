import type { AIFallbackRouter } from '../../ai/fallbackRouter';
import type { MemoryDatabase } from '../../memory/db';
import type { Bot, BotContext } from '../bot';

export interface CommandDeps {
  db: MemoryDatabase;
  ai: AIFallbackRouter;
  startedAt: number;
}

export function registerCommands(bot: Bot, deps: CommandDeps): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      "👋 Welcome to your coding agent!\n\n" +
        "I can:\n" +
        "• Write, read, update, and delete files\n" +
        "• Zip/unzip archives\n" +
        "• Run short Node.js/Python/Bash snippets\n" +
        "• Remember context across the conversation\n\n" +
        "Just tell me what you need. Type /help for commands.",
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '/start — introduction\n' +
        '/status — provider health, memory, uptime\n' +
        '/clear — forget this conversation\'s recent context\n' +
        '/help — this message',
    );
  });

  bot.command('status', async (ctx) => {
    const memory = process.memoryUsage();
    const uptimeMin = (process.uptime() / 60).toFixed(1);
    const health = deps.ai.getHealth();
    const providerLines = Object.entries(health)
      .map(([name, s]) => `  ${s.available ? '🟢' : '🔴'} ${name}`)
      .join('\n');

    await ctx.reply(
      `📊 Status\n` +
        `Uptime: ${uptimeMin}m\n` +
        `Heap: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB\n` +
        `Providers:\n${providerLines || '  (none configured)'}`,
    );
  });

  bot.command('clear', async (ctx) => {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) return;
    // We intentionally don't delete history — only stop surfacing it as
    // "recent" by relying on the summarizer/vector search for anything
    // older. A hard wipe is a separate, explicit feature if ever wanted.
    await ctx.reply('Got it — I\'ll lean on summaries and search instead of recent history for a while. 🧹');
  });
}

export type { Bot, BotContext };
