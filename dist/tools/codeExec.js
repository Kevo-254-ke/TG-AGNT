"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeExecutor = void 0;
exports.newExecId = newExecId;
const node_child_process_1 = require("node:child_process");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const uuid_1 = require("uuid");
const logger_1 = require("../core/logger");
const log = logger_1.logger.child({ module: 'tools:codeExec' });
const RUNNERS = {
    node: { command: 'node', ext: '.js', args: (file) => [file] },
    python: { command: 'python3', ext: '.py', args: (file) => [file] },
    bash: { command: 'bash', ext: '.sh', args: (file) => [file] },
};
const MAX_OUTPUT_CHARS = 4000;
/**
 * Runs a short snippet in a subprocess, with a hard wall-clock timeout.
 *
 * The snippet is written into (and run from) the caller-supplied
 * workspace directory — not an unrelated system tmp dir — so a snippet
 * that references a file the bot just created for the same user (a
 * relative `require('./helpers.js')`, `open('data.json')`, etc.) actually
 * resolves. The script file itself is a randomly-named, hidden dotfile
 * cleaned up after the run, so it doesn't clutter the user's file listing
 * or collide with anything they've named.
 *
 * Important scope note: this is a *convenience* sandbox (isolated script
 * file, timeout, output capped, minimal env) suitable for a bot's own
 * users running their own snippets against their own workspace — it is
 * NOT a security boundary against adversarial input. It runs with
 * whatever OS-level permissions the bot process itself has, so don't
 * treat per-user workspace isolation as a substitute for real sandboxing
 * (containers, gVisor, firejail, etc.) if this is ever exposed to
 * untrusted or hostile users.
 */
class CodeExecutor {
    timeoutMs;
    constructor(timeoutMs = 8000) {
        this.timeoutMs = timeoutMs;
    }
    async execute(language, code, workspaceDir) {
        const runner = RUNNERS[language];
        if (!runner)
            throw new Error(`Unsupported language: ${language}`);
        await promises_1.default.mkdir(workspaceDir, { recursive: true });
        const scriptPath = node_path_1.default.join(workspaceDir, `.agent-run-${(0, uuid_1.v4)()}${runner.ext}`);
        await promises_1.default.writeFile(scriptPath, code, 'utf-8');
        try {
            return await this.run(runner.command, runner.args(scriptPath), workspaceDir);
        }
        finally {
            await promises_1.default.rm(scriptPath, { force: true }).catch(() => undefined);
        }
    }
    run(command, args, cwd) {
        return new Promise((resolve) => {
            const child = (0, node_child_process_1.spawn)(command, args, {
                cwd,
                env: { PATH: process.env.PATH ?? '' }, // minimal env — no inherited secrets
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
            }, this.timeoutMs);
            child.stdout.on('data', (chunk) => {
                if (stdout.length < MAX_OUTPUT_CHARS)
                    stdout += chunk.toString();
            });
            child.stderr.on('data', (chunk) => {
                if (stderr.length < MAX_OUTPUT_CHARS)
                    stderr += chunk.toString();
            });
            child.on('error', (err) => {
                clearTimeout(timer);
                log.warn({ err: err.message, command }, 'Failed to spawn process');
                resolve({ stdout, stderr: `${stderr}\n${err.message}`.trim(), exitCode: null, timedOut });
            });
            child.on('close', (code) => {
                clearTimeout(timer);
                resolve({
                    stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
                    stderr: (timedOut ? `${stderr}\n[killed: exceeded ${this.timeoutMs}ms timeout]` : stderr).slice(0, MAX_OUTPUT_CHARS),
                    exitCode: code,
                    timedOut,
                });
            });
        });
    }
}
exports.CodeExecutor = CodeExecutor;
/** Unique id helper kept here so callers don't need to import uuid directly. */
function newExecId() {
    return (0, uuid_1.v4)();
}
//# sourceMappingURL=codeExec.js.map