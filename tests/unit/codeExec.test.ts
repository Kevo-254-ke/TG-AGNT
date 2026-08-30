import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeExecutor } from '../../src/tools/codeExec';

describe('CodeExecutor', () => {
  let workspaceDir: string;
  let executor: CodeExecutor;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeexec-test-'));
    executor = new CodeExecutor(5000);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('runs a node snippet and captures stdout', async () => {
    const result = await executor.execute('node', 'console.log("hello from snippet")', workspaceDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello from snippet');
  });

  it('can read a file that already exists in the workspace (the whole point of running there)', async () => {
    await fs.writeFile(path.join(workspaceDir, 'data.txt'), 'workspace file contents', 'utf-8');
    const result = await executor.execute(
      'node',
      "console.log(require('fs').readFileSync('data.txt', 'utf-8'))",
      workspaceDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('workspace file contents');
  });

  it('does not leave the transient script file behind after running', async () => {
    await executor.execute('node', 'console.log(1)', workspaceDir);
    const files = await fs.readdir(workspaceDir);
    expect(files.filter((f) => f.startsWith('.agent-run-'))).toHaveLength(0);
  });

  it('captures a non-zero exit code and stderr on failure', async () => {
    const result = await executor.execute('node', 'process.exit(2)', workspaceDir);
    expect(result.exitCode).toBe(2);
  });

  it('kills a snippet that exceeds the timeout', async () => {
    const shortExecutor = new CodeExecutor(300);
    const result = await shortExecutor.execute('node', 'setTimeout(() => {}, 5000)', workspaceDir);
    expect(result.timedOut).toBe(true);
  });
});
