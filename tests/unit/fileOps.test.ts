import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileOperations, PathTraversalError, FileTooLargeError } from '../../src/tools/fileOps';

describe('FileOperations', () => {
  let workDir: string;
  let fileOps: FileOperations;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileops-test-'));
    fileOps = new FileOperations(workDir, 1); // 1MB limit for the size test
  });

  afterEach(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('creates and reads a file', async () => {
    await fileOps.create('hello.txt', 'hello world');
    const content = await fileOps.read('hello.txt');
    expect(content).toBe('hello world');
  });

  it('lists files in the workspace', async () => {
    await fileOps.create('a.txt', 'a');
    await fileOps.create('b.txt', 'b');
    const files = await fileOps.list('.');
    expect(files.sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('updates a file in place', async () => {
    await fileOps.create('note.txt', 'v1');
    await fileOps.update('note.txt', 'v2');
    expect(await fileOps.read('note.txt')).toBe('v2');
  });

  it('deletes a file', async () => {
    await fileOps.create('temp.txt', 'x');
    await fileOps.delete('temp.txt');
    await expect(fileOps.read('temp.txt')).rejects.toThrow();
  });

  it('zips and unzips files round-trip', async () => {
    await fileOps.create('one.txt', 'one');
    await fileOps.create('two.txt', 'two');
    await fileOps.zip(['one.txt', 'two.txt'], 'bundle.zip');
    await fileOps.unzip('bundle.zip', 'extracted');
    const extractedFiles = await fileOps.list('extracted');
    expect(extractedFiles.sort()).toEqual(['one.txt', 'two.txt']);
    expect(await fileOps.read('extracted/one.txt')).toBe('one');
  });

  it('rejects path traversal attempts', async () => {
    await expect(fileOps.create('../escape.txt', 'x')).rejects.toThrow(PathTraversalError);
    await expect(fileOps.read('../../etc/passwd')).rejects.toThrow(PathTraversalError);
    await expect(fileOps.create('/etc/passwd', 'x')).rejects.toThrow(PathTraversalError);
  });

  it('rejects files exceeding the configured size limit', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024); // 2MB > 1MB limit
    await expect(fileOps.create('big.txt', big)).rejects.toThrow(FileTooLargeError);
  });
});
