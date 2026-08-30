import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../core/logger';

const log = logger.child({ module: 'tools:codeExec' });

export type SupportedLanguage = 'node' | 'python' | 'bash';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

const RUNNERS: Record<SupportedLanguage, { command: string; ext: string; args: (file: string) => string[] }> = {
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
export class CodeExecutor {
  constructor(private readonly timeoutMs: number = 8000) {}

  async execute(language: SupportedLanguage, code: string, workspaceDir: string): Promise<ExecResult> {
    const runner = RUNNERS[language];
    if (!runner) throw new Error(`Unsupported language: ${language}`);

    await fs.mkdir(workspaceDir, { recursive: true });
    const scriptPath = path.join(workspaceDir, `.agent-run-${uuidv4()}${runner.ext}`);
    await fs.writeFile(scriptPath, code, 'utf-8');

    try {
      return await this.run(runner.command, runner.args(scriptPath), workspaceDir);
    } finally {
      await fs.rm(scriptPath, { force: true }).catch(() => undefined);
    }
  }

  private run(command: string, args: string[], cwd: string): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
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
        if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString();
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

/** Unique id helper kept here so callers don't need to import uuid directly. */
export function newExecId(): string {
  return uuidv4();
}
