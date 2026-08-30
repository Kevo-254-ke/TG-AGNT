"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileOperations = exports.FileTooLargeError = exports.PathTraversalError = void 0;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const adm_zip_1 = __importDefault(require("adm-zip"));
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'tools:fileOps' });
class PathTraversalError extends Error {
    constructor(filename) {
        super(`Refusing to operate outside the sandboxed workspace: "${filename}"`);
        this.name = 'PathTraversalError';
    }
}
exports.PathTraversalError = PathTraversalError;
class FileTooLargeError extends Error {
    constructor(filename, maxMb) {
        super(`"${filename}" exceeds the ${maxMb}MB size limit`);
        this.name = 'FileTooLargeError';
    }
}
exports.FileTooLargeError = FileTooLargeError;
/**
 * All file operations are confined to `workDir`. Every path is resolved
 * and checked to still live under `workDir` before any fs call — this is
 * the one piece of the whole codebase that MUST NOT regress, since it's
 * what stands between "user asks the bot to create a file" and "user asks
 * the bot to overwrite something outside the sandbox".
 */
class FileOperations {
    maxFileSizeMb;
    workDir;
    constructor(workDir, maxFileSizeMb = 10) {
        this.maxFileSizeMb = maxFileSizeMb;
        this.workDir = node_path_1.default.resolve(workDir);
        node_fs_1.default.mkdirSync(this.workDir, { recursive: true });
    }
    /** Absolute path to this workspace's root — safe to expose, it's already sandboxed. */
    get rootDir() {
        return this.workDir;
    }
    resolveSafe(filename) {
        const resolved = node_path_1.default.resolve(this.workDir, filename);
        const relative = node_path_1.default.relative(this.workDir, resolved);
        if (relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
            throw new PathTraversalError(filename);
        }
        return resolved;
    }
    /** Public wrapper around the traversal-checked resolver, for callers that need an absolute path (e.g. sending a file to the user) without re-implementing the safety check. */
    resolveAbsolutePath(filename) {
        return this.resolveSafe(filename);
    }
    async create(filename, content) {
        this.assertSizeOk(filename, content);
        const filepath = this.resolveSafe(filename);
        await promises_1.default.mkdir(node_path_1.default.dirname(filepath), { recursive: true });
        await promises_1.default.writeFile(filepath, content, 'utf-8');
        log.info({ filename }, 'File created');
        return { path: node_path_1.default.relative(this.workDir, filepath), bytes: Buffer.byteLength(content) };
    }
    async read(filename) {
        const filepath = this.resolveSafe(filename);
        return promises_1.default.readFile(filepath, 'utf-8');
    }
    async update(filename, content) {
        return this.create(filename, content);
    }
    async delete(filename) {
        const filepath = this.resolveSafe(filename);
        await promises_1.default.unlink(filepath);
        log.info({ filename }, 'File deleted');
    }
    async list(dirname = '.') {
        const dirpath = this.resolveSafe(dirname);
        return promises_1.default.readdir(dirpath);
    }
    async zip(files, outputName) {
        const zip = new adm_zip_1.default();
        for (const file of files) {
            const filepath = this.resolveSafe(file);
            zip.addLocalFile(filepath);
        }
        const outputPath = this.resolveSafe(outputName);
        zip.writeZip(outputPath);
        log.info({ outputName, fileCount: files.length }, 'Archive created');
        return { path: node_path_1.default.relative(this.workDir, outputPath) };
    }
    async unzip(filename, outputDir) {
        const filepath = this.resolveSafe(filename);
        const extractPath = this.resolveSafe(outputDir);
        await promises_1.default.mkdir(extractPath, { recursive: true });
        new adm_zip_1.default(filepath).extractAllTo(extractPath, true);
        return { path: node_path_1.default.relative(this.workDir, extractPath) };
    }
    assertSizeOk(filename, content) {
        const bytes = Buffer.byteLength(content);
        const maxBytes = this.maxFileSizeMb * 1024 * 1024;
        if (bytes > maxBytes)
            throw new FileTooLargeError(filename, this.maxFileSizeMb);
    }
}
exports.FileOperations = FileOperations;
//# sourceMappingURL=fileOps.js.map