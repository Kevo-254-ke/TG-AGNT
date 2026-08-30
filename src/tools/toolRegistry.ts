import { env } from '../config/env';
import { logger } from '../core/logger';
import type { ToolExecutionResult } from '../core/types';
import { CodeExecutor, type SupportedLanguage } from './codeExec';
import { WorkspaceManager } from './workspaceManager';

const log = logger.child({ module: 'tools:registry' });

/**
 * Maps a tool-call name (as emitted by the AI) to an executor function,
 * scoped to the calling user's own workspace.
 *
 * This is a multi-user bot: every method here takes a `userId` and routes
 * through `WorkspaceManager.forUser(userId)` rather than one shared
 * FileOperations instance, so User A's files are never visible to or
 * overwritable by User B. This is the seam for scaling the tool surface
 * too — adding a new capability is "write the schema in
 * ai/toolSchemas.ts, register a handler here" — nothing in the Telegram
 * or AI layers needs to change.
 */
export class ToolRegistry {
  private readonly workspaces: WorkspaceManager;
  private readonly codeExec: CodeExecutor;

  constructor(baseFilesDir: string) {
    this.workspaces = new WorkspaceManager(baseFilesDir, env.MAX_FILE_SIZE_MB);
    this.codeExec = new CodeExecutor(env.CODE_EXEC_TIMEOUT_MS);
  }

  /** Absolute path to a file in one user's workspace — used to attach the actual file when replying, not just its contents as text. */
  resolvePath(userId: string, relativePath: string): string {
    return this.workspaces.forUser(userId).resolveAbsolutePath(relativePath);
  }

  async execute(name: string, args: Record<string, unknown>, userId: string): Promise<ToolExecutionResult> {
    const fileOps = this.workspaces.forUser(userId);

    try {
      switch (name) {
        case 'create_file': {
          const { filename, content } = requireStrings(args, ['filename', 'content']);
          const result = await fileOps.create(filename, content);
          return { success: true, message: `Created ${result.path} (${result.bytes} bytes)`, data: result };
        }
        case 'read_file': {
          const { filename } = requireStrings(args, ['filename']);
          const content = await fileOps.read(filename);
          return { success: true, message: content, data: { filename, content } };
        }
        case 'update_file': {
          const { filename, content } = requireStrings(args, ['filename', 'content']);
          const result = await fileOps.update(filename, content);
          return { success: true, message: `Updated ${result.path} (${result.bytes} bytes)`, data: result };
        }
        case 'delete_file': {
          const { filename } = requireStrings(args, ['filename']);
          await fileOps.delete(filename);
          return { success: true, message: `Deleted ${filename}` };
        }
        case 'list_files': {
          const dirname = typeof args.dirname === 'string' ? args.dirname : '.';
          const files = await fileOps.list(dirname);
          return { success: true, message: files.length ? files.join('\n') : '(empty directory)', data: files };
        }
        case 'zip_files': {
          const files = Array.isArray(args.files) ? (args.files as string[]) : [];
          const { outputName } = requireStrings(args, ['outputName']);
          if (files.length === 0) return { success: false, message: 'No files specified to zip' };
          const result = await fileOps.zip(files, outputName);
          return { success: true, message: `Created archive ${result.path}`, data: result };
        }
        case 'unzip_file': {
          const { filename, outputDir } = requireStrings(args, ['filename', 'outputDir']);
          const result = await fileOps.unzip(filename, outputDir);
          return { success: true, message: `Extracted to ${result.path}`, data: result };
        }
        case 'execute_code': {
          if (!env.CODE_EXEC_ENABLED) {
            return { success: false, message: 'Code execution is disabled by configuration' };
          }
          const { language, code } = requireStrings(args, ['language', 'code']);
          const result = await this.codeExec.execute(language as SupportedLanguage, code, fileOps.rootDir);
          const summary = [
            result.stdout ? `stdout:\n${result.stdout}` : null,
            result.stderr ? `stderr:\n${result.stderr}` : null,
            `exit code: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
          ]
            .filter(Boolean)
            .join('\n\n');
          return { success: result.exitCode === 0, message: summary, data: result };
        }
        default:
          return { success: false, message: `Unknown tool: ${name}` };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log.warn({ tool: name, userId, reason }, 'Tool execution failed');
      return { success: false, message: `⚠️ ${reason}` };
    }
  }
}

/** Tool names whose result represents a file the user probably wants delivered as an actual Telegram document, not just described in text. */
export const FILE_PRODUCING_TOOLS = new Set(['create_file', 'update_file', 'zip_files']);

function requireStrings<K extends string>(args: Record<string, unknown>, keys: K[]): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = args[key];
    if (typeof value !== 'string') throw new Error(`Missing or invalid argument: ${key}`);
    out[key] = value;
  }
  return out;
}
