import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/tools/toolRegistry';

describe('ToolRegistry', () => {
  let filesDir: string;
  let registry: ToolRegistry;
  const userA = '111';
  const userB = '222';

  beforeEach(async () => {
    filesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toolregistry-test-'));
    registry = new ToolRegistry(filesDir);
  });

  afterEach(async () => {
    await fs.rm(filesDir, { recursive: true, force: true });
  });

  it("creates a file via the create_file tool, scoped under the user's own workspace", async () => {
    const result = await registry.execute('create_file', { filename: 'a.txt', content: 'hello' }, userA);
    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(filesDir, userA, 'a.txt'), 'utf-8')).toBe('hello');
  });

  it('reads a file via the read_file tool', async () => {
    await registry.execute('create_file', { filename: 'a.txt', content: 'hello' }, userA);
    const result = await registry.execute('read_file', { filename: 'a.txt' }, userA);
    expect(result.success).toBe(true);
    expect(result.message).toBe('hello');
  });

  it('lists files via the list_files tool', async () => {
    await registry.execute('create_file', { filename: 'a.txt', content: '1' }, userA);
    const result = await registry.execute('list_files', {}, userA);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['a.txt']);
  });

  it('returns a graceful failure for missing required arguments', async () => {
    const result = await registry.execute('create_file', { filename: 'a.txt' }, userA);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/content/i);
  });

  it('returns a graceful failure for an unknown tool name', async () => {
    const result = await registry.execute('not_a_real_tool', {}, userA);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/unknown tool/i);
  });

  it('reports a failure (not a thrown error) on path traversal via the tool interface', async () => {
    const result = await registry.execute('read_file', { filename: '../secret.txt' }, userA);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/sandboxed workspace/i);
  });

  describe('multi-user isolation', () => {
    it("keeps user A's files invisible to user B's list_files", async () => {
      await registry.execute('create_file', { filename: 'secret.txt', content: 'shh' }, userA);
      const listB = await registry.execute('list_files', {}, userB);
      expect(listB.data).toEqual([]);
    });

    it("does not let user B read a file that only exists in user A's workspace", async () => {
      await registry.execute('create_file', { filename: 'secret.txt', content: 'shh' }, userA);
      const readB = await registry.execute('read_file', { filename: 'secret.txt' }, userB);
      expect(readB.success).toBe(false);
    });

    it('allows both users to create a file with the same name independently', async () => {
      const a = await registry.execute('create_file', { filename: 'note.txt', content: 'from A' }, userA);
      const b = await registry.execute('create_file', { filename: 'note.txt', content: 'from B' }, userB);
      expect(a.success).toBe(true);
      expect(b.success).toBe(true);

      const readA = await registry.execute('read_file', { filename: 'note.txt' }, userA);
      const readB = await registry.execute('read_file', { filename: 'note.txt' }, userB);
      expect(readA.message).toBe('from A');
      expect(readB.message).toBe('from B');
    });

    it("resolvePath resolves within the correct user's own workspace directory", () => {
      const resolved = registry.resolvePath(userA, 'note.txt');
      expect(resolved).toBe(path.resolve(filesDir, userA, 'note.txt'));
    });
  });
});
