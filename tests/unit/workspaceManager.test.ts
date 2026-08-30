import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../src/tools/workspaceManager';

describe('WorkspaceManager', () => {
  let baseDir: string;
  let workspaces: WorkspaceManager;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspacemanager-test-'));
    workspaces = new WorkspaceManager(baseDir, 10);
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('creates a distinct subdirectory per user under the base dir', async () => {
    const opsA = workspaces.forUser('111');
    await opsA.create('a.txt', 'hi');
    expect(await fs.readFile(path.join(baseDir, '111', 'a.txt'), 'utf-8')).toBe('hi');
  });

  it('returns the same FileOperations instance for repeated calls with the same user', () => {
    const first = workspaces.forUser('111');
    const second = workspaces.forUser('111');
    expect(first).toBe(second);
  });

  it('gives different users independent, non-colliding workspaces', async () => {
    const opsA = workspaces.forUser('111');
    const opsB = workspaces.forUser('222');
    await opsA.create('note.txt', 'from A');
    await opsB.create('note.txt', 'from B');

    expect(await opsA.read('note.txt')).toBe('from A');
    expect(await opsB.read('note.txt')).toBe('from B');
    expect(opsA.rootDir).not.toBe(opsB.rootDir);
  });

  it('sanitizes user ids that contain path-unsafe characters', async () => {
    const ops = workspaces.forUser('../../etc');
    await ops.create('a.txt', 'x');
    // Should land under baseDir, not escape it — confirms the id was
    // sanitized before being used as a directory name.
    const rel = path.relative(baseDir, ops.rootDir);
    expect(rel.startsWith('..')).toBe(false);
  });
});
