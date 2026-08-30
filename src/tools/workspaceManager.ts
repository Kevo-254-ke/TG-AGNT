import path from 'node:path';
import { logger } from '../core/logger';
import { FileOperations } from './fileOps';

const log = logger.child({ module: 'tools:workspaceManager' });

/**
 * This is a multi-user bot — every user's files must live in their own
 * directory, never a shared global workspace. Without this, User A could
 * read, overwrite, or zip User B's files just by asking the bot to.
 *
 * One FileOperations instance is created per user, lazily, and cached —
 * each instance is independently sandboxed to `<baseDir>/<userId>/` via
 * FileOperations' own path-traversal checks, so per-user isolation and
 * per-file sandboxing are two independent layers, not one substituting
 * for the other.
 */
export class WorkspaceManager {
  private readonly baseDir: string;
  private readonly perUser = new Map<string, FileOperations>();

  constructor(baseDir: string, private readonly maxFileSizeMb: number) {
    this.baseDir = path.resolve(baseDir);
  }

  /** Returns (creating if needed) the sandboxed FileOperations for one user. */
  forUser(userId: string): FileOperations {
    const safeId = sanitizeUserId(userId);
    let ops = this.perUser.get(safeId);
    if (!ops) {
      const userDir = path.join(this.baseDir, safeId);
      ops = new FileOperations(userDir, this.maxFileSizeMb);
      this.perUser.set(safeId, ops);
      log.info({ userId: safeId }, 'Workspace created for user');
    }
    return ops;
  }
}

/** userId is our own internal string (Telegram numeric id today) — sanitized defensively since it becomes a directory name. */
function sanitizeUserId(userId: string): string {
  const cleaned = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned) throw new Error('Invalid user id for workspace');
  return cleaned;
}
