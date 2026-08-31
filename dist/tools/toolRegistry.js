"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILE_PRODUCING_TOOLS = exports.ToolRegistry = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const env_1 = require("../config/env");
const logger_1 = require("../core/logger");
const codeExec_1 = require("./codeExec");
const workspaceManager_1 = require("./workspaceManager");
const documentParser_1 = require("./documentParser");
const webSearch_1 = require("./webSearch");
const log = logger_1.logger.child({ module: 'tools:registry' });
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
class ToolRegistry {
    workspaces;
    codeExec;
    constructor(baseFilesDir) {
        this.workspaces = new workspaceManager_1.WorkspaceManager(baseFilesDir, env_1.env.MAX_FILE_SIZE_MB);
        this.codeExec = new codeExec_1.CodeExecutor(env_1.env.CODE_EXEC_TIMEOUT_MS);
    }
    /** Absolute path to a file in one user's workspace — used to attach the actual file when replying, not just its contents as text. */
    resolvePath(userId, relativePath) {
        return this.workspaces.forUser(userId).resolveAbsolutePath(relativePath);
    }
    /**
     * Saves a document (binary buffer) directly into a user's workspace.
     * Used by the Telegram document handler to persist uploaded files.
     */
    async saveDocument(userId, filename, data) {
        const fileOps = this.workspaces.forUser(userId);
        const filepath = fileOps.resolveAbsolutePath(filename);
        await promises_1.default.mkdir(node_path_1.default.dirname(filepath), { recursive: true });
        await promises_1.default.writeFile(filepath, data);
        const relativePath = node_path_1.default.relative(fileOps.rootDir, filepath);
        log.info({ userId, path: relativePath, bytes: data.length }, 'Document saved');
        return { path: relativePath, bytes: data.length };
    }
    async execute(name, args, userId) {
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
                case 'read_document': {
                    const { filename } = requireStrings(args, ['filename']);
                    const absolutePath = fileOps.resolveAbsolutePath(filename);
                    const parsed = await (0, documentParser_1.parseDocument)(absolutePath, filename);
                    if (parsed.error) {
                        return { success: false, message: parsed.error, data: parsed };
                    }
                    const meta = parsed.rows !== undefined ? ` (${parsed.rows} rows)` : parsed.pages !== undefined ? ` (${parsed.pages} pages)` : '';
                    return {
                        success: true,
                        message: `📄 ${parsed.filename}${meta}\n\n${parsed.content}`,
                        data: parsed,
                    };
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
                    const files = Array.isArray(args.files) ? args.files : [];
                    const { outputName } = requireStrings(args, ['outputName']);
                    if (files.length === 0)
                        return { success: false, message: 'No files specified to zip' };
                    const result = await fileOps.zip(files, outputName);
                    return { success: true, message: `Created archive ${result.path}`, data: result };
                }
                case 'unzip_file': {
                    const { filename, outputDir } = requireStrings(args, ['filename', 'outputDir']);
                    const result = await fileOps.unzip(filename, outputDir);
                    return { success: true, message: `Extracted to ${result.path}`, data: result };
                }
                case 'execute_code': {
                    if (!env_1.env.CODE_EXEC_ENABLED) {
                        return { success: false, message: 'Code execution is disabled by configuration' };
                    }
                    const { language, code } = requireStrings(args, ['language', 'code']);
                    const result = await this.codeExec.execute(language, code, fileOps.rootDir);
                    const summary = [
                        result.stdout ? `stdout:\n${result.stdout}` : null,
                        result.stderr ? `stderr:\n${result.stderr}` : null,
                        `exit code: ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`,
                    ]
                        .filter(Boolean)
                        .join('\n\n');
                    return { success: result.exitCode === 0, message: summary, data: result };
                }
                case 'web_search': {
                    const { query } = requireStrings(args, ['query']);
                    const results = await (0, webSearch_1.webSearch)(query);
                    if (results.length === 0) {
                        return { success: false, message: 'No search results found. Try a different query.' };
                    }
                    const formatted = results
                        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
                        .join('\n\n');
                    return {
                        success: true,
                        message: `🔍 Search results for "${query}":\n\n${formatted}`,
                        data: results,
                    };
                }
                case 'fetch_webpage': {
                    const { url } = requireStrings(args, ['url']);
                    const page = await (0, webSearch_1.fetchWebpage)(url);
                    if (page.error) {
                        return { success: false, message: `Failed to fetch page: ${page.error}`, data: page };
                    }
                    const preview = page.content.slice(0, 2000);
                    const truncated = page.content.length > 2000 ? `\n\n[... ${page.content.length - 2000} more characters]` : '';
                    return {
                        success: true,
                        message: `📄 ${page.title || 'Webpage'}\n${url}\n\n${preview}${truncated}`,
                        data: page,
                    };
                }
                default:
                    return { success: false, message: `Unknown tool: ${name}` };
            }
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            log.warn({ tool: name, userId, reason }, 'Tool execution failed');
            return { success: false, message: `⚠️ ${reason}` };
        }
    }
}
exports.ToolRegistry = ToolRegistry;
/** Tool names whose result represents a file the user probably wants delivered as an actual Telegram document, not just described in text. */
exports.FILE_PRODUCING_TOOLS = new Set(['create_file', 'update_file', 'zip_files']);
function requireStrings(args, keys) {
    const out = {};
    for (const key of keys) {
        const value = args[key];
        if (typeof value !== 'string')
            throw new Error(`Missing or invalid argument: ${key}`);
        out[key] = value;
    }
    return out;
}
//# sourceMappingURL=toolRegistry.js.map