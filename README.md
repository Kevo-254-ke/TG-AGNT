# Telegram Coding Agent

A $0-budget Telegram bot that can write/read/zip files and run short code
snippets on request, backed by free-tier AI models with automatic
fallback, and a vector-search memory system so it doesn't resend your
whole chat history on every turn.

Built in TypeScript, designed to run comfortably on a Termux phone install
but structured so it isn't stuck there (see [Architecture](#architecture)).

## Features

- **Multi-model AI fallback**: OpenRouter → Groq, with a small circuit
  breaker per provider and a degraded "tools-only" mode if both are down.
- **Vector-search memory**: Hugging Face embeddings (free tier) + cosine
  similarity over a local NeDB store, so old but *relevant* messages get
  pulled back into context instead of the whole history.
- **Auto-summarization**: every N messages get compressed into a short
  summary (with its own embedding) so the bot's memory horizon isn't
  bounded by how many raw messages it can afford to resend.
- **Multi-step tool loop**: a request like "make separate HTML, CSS, and
  JS files" doesn't stall after the first file. The bot keeps asking the
  AI and feeding tool results back (`src/ai/agentLoop.ts`) until the model
  says it's done or a configurable step cap (`AGENT_MAX_STEPS`) is hit —
  most models only request one tool per turn, so this loop is what lets
  multi-file/multi-step requests actually finish.
- **Multi-user by design**: every Telegram user gets their own sandboxed
  workspace directory (`FILES_DIR/<userId>/`) — files, memory, and code
  execution are all scoped per user, so one person's files are never
  visible to or overwritable by another.
- **Real file delivery**: when the bot creates or updates a file, it sends
  the actual file as a Telegram document — not just a text description.
  Default is one file per attachment; if multiple related files belong
  together (or you ask for a zip), the bot bundles them into an archive
  and sends that instead.
- **Sandboxed file tools**: create/read/update/delete/list/zip/unzip,
  all path-traversal-checked and confined to one workspace directory.
- **Sandboxed code execution**: short Node/Python/Bash snippets, run in an
  isolated scratch directory with a hard timeout and capped output.
- **Per-user rate limiting** and a structured error boundary so one bad
  update can't take the process down.
- **Termux-friendly**: no native builds (NeDB, adm-zip are pure JS), a
  memory-usage monitor, and a pm2 ecosystem file for auto-restart.

## Architecture

```
src/
  config/env.ts          — one place that reads process.env (zod-validated)
  core/{types,logger}.ts — shared interfaces + logger
  ai/
    providers/            — one file per AI provider (OpenRouter, Groq…)
    fallbackRouter.ts      — tries providers in order + circuit breaker
    toolSchemas.ts         — function-calling schemas shared by providers
  memory/
    db.ts                  — typed NeDB wrapper (swap this file to change DB)
    embeddings/             — pluggable embedding providers (HF, no-op)
    vectorSearch.ts          — cosine similarity + top-K ranking
    contextBuilder.ts        — assembles the token-efficient prompt
    summarizer.ts             — background history compression
  tools/
    fileOps.ts               — sandboxed file CRUD/zip
    codeExec.ts               — sandboxed snippet execution
    toolRegistry.ts            — maps tool-call name -> implementation
  telegram/
    bot.ts                     — grammY instance + middleware
    middleware/                 — rate limiter, error handler
    handlers/                   — commands, message orchestration
  app.ts                         — wires every layer together (no I/O start)
  index.ts                       — entrypoint: builds app, starts polling
```

**Why it's built this way:**
- Every external dependency (AI provider, embedding provider, database) is
  hidden behind a small interface (`AIProvider`, `EmbeddingProvider`, the
  `MemoryDatabase` class). Adding a new AI provider or swapping NeDB for
  Postgres later touches one file, not the whole codebase.
- `app.ts` builds the fully-wired app but never calls `bot.start()` —
  that's `index.ts`'s job. This is what lets the smoke tests exercise real
  wiring (config validation, provider construction, tool registry, handler
  registration) without needing a live Telegram connection.
- The AI fallback router and tool registry don't know grammY exists;
  the Telegram layer is the only part that imports grammY. If you want to
  add a Discord or WhatsApp frontend later, everything under `ai/`,
  `memory/`, and `tools/` is reusable as-is.

## Setup

### Termux (phone)

```bash
git clone <your-repo-url> telegram-agent
cd telegram-agent
bash scripts/setup-termux.sh
# edit .env with your tokens
npm start
```

### Any machine

```bash
npm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN at minimum
npm run build
npm start
```

Get free API keys:
- **Telegram bot token**: message [@BotFather](https://t.me/botfather), `/newbot`
- **OpenRouter** (primary AI): https://openrouter.ai/keys
- **Groq** (fallback AI, generous free tier): https://console.groq.com/keys
- **Hugging Face** (embeddings, optional — works without a key at low volume): https://huggingface.co/settings/tokens

The bot works with only one AI provider configured, and even with none
(it runs in degraded/tools-only mode and tells you so).

## Running persistently in Termux

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow its printed instructions so it survives Termux restarts
pm2 logs telegram-agent
```

`ecosystem.config.js` sets `max_memory_restart: 350M` as a safety net on
top of the in-process memory monitor.

## Development

```bash
npm run dev        # tsx watch mode
npm run typecheck  # tsc --noEmit
npm test           # vitest — unit + wiring smoke tests
```

## Extending

- **New AI provider**: implement `AIProvider` in `src/ai/providers/`,
  construct it in `src/app.ts`, push it into the `providers` array in the
  order you want it tried.
- **New tool**: add a schema to `src/ai/toolSchemas.ts` and a `case` in
  `src/tools/toolRegistry.ts`. The AI model picks it up automatically via
  function calling.
- **New storage backend**: reimplement `MemoryDatabase` in
  `src/memory/db.ts` against the same method signatures.

## Safety notes

- File tools are confined to `FILES_DIR` with path-traversal checks —
  reviewed carefully, since it's the one thing standing between "create a
  file" and "overwrite something outside the sandbox."
- `execute_code` is a *convenience* sandbox (isolated temp dir, timeout,
  capped output) intended for a single trusted owner running their own
  snippets — it is not a security boundary against adversarial input.
  Set `CODE_EXEC_ENABLED=false` if you don't need it.
