import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Full wiring smoke test. This does NOT call bot.start() — this sandbox
 * has no route to api.telegram.org, and more importantly `createApp()`
 * is deliberately structured (see src/app.ts) so that everything except
 * actual long-polling can be verified without a live network connection:
 * env validation, provider construction, tool registry, NeDB init, and
 * grammY handler registration all happen inside `createApp()`.
 */
describe('createApp (full wiring smoke test)', () => {
  let workDir: string;
  let filesDir: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-workdir-'));
    filesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smoke-filesdir-'));

    process.env.TELEGRAM_BOT_TOKEN = '123456:FAKE_TOKEN_FOR_SMOKE_TEST';
    process.env.WORK_DIR = workDir;
    process.env.FILES_DIR = filesDir;
    process.env.EMBEDDINGS_PROVIDER = 'none'; // no network calls during the test
    process.env.OPENROUTER_API_KEY = '';
    process.env.GROQ_API_KEY = '';
    process.env.NODE_ENV = 'test';

    // Reset the module cache so config/env.ts re-reads the process.env
    // values we just set (it's a singleton computed at import time).
    const vitestModule = await import('vitest');
    vitestModule.vi.resetModules();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(filesDir, { recursive: true, force: true });
  });

  it('builds the app end-to-end with no AI providers configured (degraded mode)', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    await app.db.ready;

    expect(app.bot).toBeDefined();
    expect(app.db).toBeDefined();
    expect(app.tools).toBeDefined();

    // No providers configured -> health map is empty, and a chat call
    // should still resolve (degraded mode) rather than throwing.
    expect(app.ai.getHealth()).toEqual({});
    const response = await app.ai.chat([{ role: 'user', content: 'hello' }]);
    expect(response.provider).toBe('degraded');
    expect(response.content.length).toBeGreaterThan(0);
  });

  it('registers OpenRouter/Groq as healthy when their keys are set', async () => {
    process.env.OPENROUTER_API_KEY = 'fake-key';
    process.env.GROQ_API_KEY = 'fake-key';

    const { createApp } = await import('../../src/app');
    const app = createApp();
    await app.db.ready;

    expect(app.ai.getHealth()).toEqual({
      openrouter: { available: true },
      groq: { available: true },
    });
  });

  it('wires a working tool registry through the app, scoped to one user (create -> list -> read)', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    await app.db.ready;
    const testUserId = 'smoke-test-user';

    const created = await app.tools.execute('create_file', { filename: 'smoke.txt', content: 'it works' }, testUserId);
    expect(created.success).toBe(true);

    const listed = await app.tools.execute('list_files', {}, testUserId);
    expect(listed.data).toContain('smoke.txt');

    const read = await app.tools.execute('read_file', { filename: 'smoke.txt' }, testUserId);
    expect(read.message).toBe('it works');
  });

  it('keeps two different users\' workspaces isolated through the fully wired app', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    await app.db.ready;

    await app.tools.execute('create_file', { filename: 'private.txt', content: 'user A only' }, 'user-a');
    const userBList = await app.tools.execute('list_files', {}, 'user-b');
    const userBRead = await app.tools.execute('read_file', { filename: 'private.txt' }, 'user-b');

    expect(userBList.data).toEqual([]);
    expect(userBRead.success).toBe(false);
  });

  it('persists a user and message end-to-end through the wired MemoryDatabase', async () => {
    const { createApp } = await import('../../src/app');
    const app = createApp();
    await app.db.ready;

    const user = await app.db.upsertUser(42, 'Kevo');
    expect(user._id).toBe('42');

    await app.db.saveMessage(user._id, 'user', 'hello world', 3, null);
    const recent = await app.db.getRecentMessages(user._id, 5);
    expect(recent).toHaveLength(1);
    expect(recent[0].content).toBe('hello world');
  });

  it('throws a clear config error instead of booting with an invalid AI_TEMPERATURE', async () => {
    process.env.AI_TEMPERATURE = 'not-a-number-and-out-of-range';
    await expect(import('../../src/config/env')).rejects.toThrow();
  });
});
