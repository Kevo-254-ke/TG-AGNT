import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { logger } from '../core/logger';

const log = logger.child({ module: 'tools:fileOps' });

export class PathTraversalError extends Error {
  constructor(filename: string) {
    super(`Refusing to operate outside the sandboxed workspace: "${filename}"`);
    this.name = 'PathTraversalError';
  }
}

export class FileTooLargeError extends Error {
  constructor(filename: string, maxMb: number) {
    super(`"${filename}" exceeds the ${maxMb}MB size limit`);
    this.name = 'FileTooLargeError';
  }
}

/**
 * All file operations are confined to `workDir`. Every path is resolved
 * and checked to still live under `workDir` before any fs call — this is
 * the one piece of the whole codebase that MUST NOT regress, since it's
 * what stands between "user asks the bot to create a file" and "user asks
 * the bot to overwrite something outside the sandbox".
 */
export class FileOperations {
  private readonly workDir: string;

  constructor(workDir: string, private readonly maxFileSizeMb: number = 10) {
    this.workDir = path.resolve(workDir);
    fsSync.mkdirSync(this.workDir, { recursive: true });
  }

  /** Absolute path to this workspace's root — safe to expose, it's already sandboxed. */
  get rootDir(): string {
    return this.workDir;
  }

  private resolveSafe(filename: string): string {
    const resolved = path.resolve(this.workDir, filename);
    const relative = path.relative(this.workDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new PathTraversalError(filename);
    }
    return resolved;
  }

  /** Public wrapper around the traversal-checked resolver, for callers that need an absolute path (e.g. sending a file to the user) without re-implementing the safety check. */
  resolveAbsolutePath(filename: string): string {
    return this.resolveSafe(filename);
  }

  async create(filename: string, content: string): Promise<{ path: string; bytes: number }> {
    this.assertSizeOk(filename, content);
    const filepath = this.resolveSafe(filename);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content, 'utf-8');
    log.info({ filename }, 'File created');
    return { path: path.relative(this.workDir, filepath), bytes: Buffer.byteLength(content) };
  }

  async read(filename: string): Promise<string> {
    const filepath = this.resolveSafe(filename);
    return fs.readFile(filepath, 'utf-8');
  }

  async update(filename: string, content: string): Promise<{ path: string; bytes: number }> {
    return this.create(filename, content);
  }

  async delete(filename: string): Promise<void> {
    const filepath = this.resolveSafe(filename);
    await fs.unlink(filepath);
    log.info({ filename }, 'File deleted');
  }

  async list(dirname = '.'): Promise<string[]> {
    const dirpath = this.resolveSafe(dirname);
    return fs.readdir(dirpath);
  }

  async zip(files: string[], outputName: string): Promise<{ path: string }> {
    const zip = new AdmZip();
    for (const file of files) {
      const filepath = this.resolveSafe(file);
      zip.addLocalFile(filepath);
    }
    const outputPath = this.resolveSafe(outputName);
    zip.writeZip(outputPath);
    log.info({ outputName, fileCount: files.length }, 'Archive created');
    return { path: path.relative(this.workDir, outputPath) };
  }

  async unzip(filename: string, outputDir: string): Promise<{ path: string }> {
    const filepath = this.resolveSafe(filename);
    const extractPath = this.resolveSafe(outputDir);
    await fs.mkdir(extractPath, { recursive: true });
    new AdmZip(filepath).extractAllTo(extractPath, true);
    return { path: path.relative(this.workDir, extractPath) };
  }

  private assertSizeOk(filename: string, content: string): void {
    const bytes = Buffer.byteLength(content);
    const maxBytes = this.maxFileSizeMb * 1024 * 1024;
    if (bytes > maxBytes) throw new FileTooLargeError(filename, this.maxFileSizeMb);
  }
}
