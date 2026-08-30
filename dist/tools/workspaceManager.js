"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceManager = void 0;
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("../core/logger");
const fileOps_1 = require("./fileOps");
const log = logger_1.logger.child({ module: 'tools:workspaceManager' });
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
class WorkspaceManager {
    maxFileSizeMb;
    baseDir;
    perUser = new Map();
    constructor(baseDir, maxFileSizeMb) {
        this.maxFileSizeMb = maxFileSizeMb;
        this.baseDir = node_path_1.default.resolve(baseDir);
    }
    /** Returns (creating if needed) the sandboxed FileOperations for one user. */
    forUser(userId) {
        const safeId = sanitizeUserId(userId);
        let ops = this.perUser.get(safeId);
        if (!ops) {
            const userDir = node_path_1.default.join(this.baseDir, safeId);
            ops = new fileOps_1.FileOperations(userDir, this.maxFileSizeMb);
            this.perUser.set(safeId, ops);
            log.info({ userId: safeId }, 'Workspace created for user');
        }
        return ops;
    }
}
exports.WorkspaceManager = WorkspaceManager;
/** userId is our own internal string (Telegram numeric id today) — sanitized defensively since it becomes a directory name. */
function sanitizeUserId(userId) {
    const cleaned = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleaned)
        throw new Error('Invalid user id for workspace');
    return cleaned;
}
//# sourceMappingURL=workspaceManager.js.map