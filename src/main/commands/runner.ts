import { execFile, spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CommandEvent,
  LastRun,
  RunOutcome,
  RunRequestResult,
  RunningCommand,
  SavedCommand,
  SshHost,
} from '../../shared/commandSchema';
import { MAX_STORED_OUTPUT, describeInvocation, sshArgs } from '../../shared/commandSchema';

/** Most output kept (and shown live) per run; older text is dropped. */
export const MAX_RUN_OUTPUT = 256 * 1024;
export const MAX_CONCURRENT = 4;
const FLUSH_MS = 100;

export interface Invocation {
  file: string;
  args: string[];
  options: SpawnOptions;
  /** The exact line shown to the user. */
  display: string;
  isSsh: boolean;
}

/** The system OpenSSH client: Windows' own build if present, otherwise whatever `ssh` is on PATH. */
export function resolveSshPath(platform: NodeJS.Platform = process.platform, env = process.env): string {
  if (platform === 'win32') {
    const system = path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
    if (fs.existsSync(system)) return system;
  }
  return 'ssh';
}

/**
 * How a saved command is started. SSH runs `ssh` directly with an argument list (no local shell, so
 * no local quoting). Local commands go to cmd.exe /d /s /c with the whole line wrapped in one pair of
 * quotes and passed verbatim: Node would otherwise escape embedded quotes with backslashes, which
 * cmd.exe does not understand.
 */
export function buildInvocation(
  command: SavedCommand,
  host: SshHost | null,
  platform: NodeJS.Platform = process.platform,
  sshPath: string = resolveSshPath(platform)
): Invocation | { error: string } {
  const display = describeInvocation(command, host);
  const base: SpawnOptions = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };

  if (command.where.kind === 'ssh') {
    if (!host) return { error: 'The SSH host for this command no longer exists.' };
    return { file: sshPath, args: sshArgs(host, command.command), options: base, display, isSsh: true };
  }

  const cwd = command.cwd?.trim() || undefined;
  if (cwd && !fs.existsSync(cwd)) return { error: `Working folder does not exist: ${cwd}` };
  if (platform === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', `"${command.command}"`],
      options: { ...base, cwd, windowsVerbatimArguments: true },
      display,
      isSsh: false,
    };
  }
  return { file: '/bin/sh', args: ['-c', command.command], options: { ...base, cwd }, display, isSsh: false };
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g;

/** Make process output safe and tidy to show: no escape codes, CRLF as LF. */
export function cleanOutput(text: string): string {
  return text.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\0/g, '');
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 3000).unref();
}

export interface RunnerDeps {
  spawn?: typeof spawn;
  kill?: (child: ChildProcess) => void;
  platform?: NodeJS.Platform;
  sshPath?: string;
  flushMs?: number;
  maxConcurrent?: number;
}

interface ActiveRun {
  commandId: string;
  runId: string;
  startedAt: string;
  startMs: number;
  display: string;
  isSsh: boolean;
  child: ChildProcess;
  tail: string;
  pending: string;
  flushTimer: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout;
  timedOut: boolean;
  cancelled: boolean;
  finished: boolean;
  done: Promise<LastRun>;
}

export class CommandRunner {
  private active = new Map<string, ActiveRun>();
  private readonly spawnFn: typeof spawn;
  private readonly kill: (child: ChildProcess) => void;
  private readonly platform: NodeJS.Platform;
  private readonly sshPath: string;
  private readonly flushMs: number;
  private readonly maxConcurrent: number;

  constructor(
    private readonly emit: (event: CommandEvent) => void,
    private readonly onEnd: (commandId: string, run: LastRun) => void,
    deps: RunnerDeps = {}
  ) {
    this.spawnFn = deps.spawn ?? spawn;
    this.kill = deps.kill ?? killTree;
    this.platform = deps.platform ?? process.platform;
    this.sshPath = deps.sshPath ?? resolveSshPath(this.platform);
    this.flushMs = deps.flushMs ?? FLUSH_MS;
    this.maxConcurrent = deps.maxConcurrent ?? MAX_CONCURRENT;
  }

  running(): RunningCommand[] {
    return [...this.active.values()].map((r) => ({
      commandId: r.commandId,
      runId: r.runId,
      startedAt: r.startedAt,
    }));
  }

  /** Start a run. Resolves nothing about the outcome: watch events, or use `runAndWait`. */
  start(command: SavedCommand, host: SshHost | null): RunRequestResult {
    return this.begin(command, host).result;
  }

  /** Start and wait for the end. */
  async runAndWait(command: SavedCommand, host: SshHost | null): Promise<LastRun | { error: string }> {
    const { result, run } = this.begin(command, host);
    if (result.status !== 'started' || !run) {
      return { error: result.status === 'error' ? result.message : 'Not started.' };
    }
    return run.done;
  }

  cancel(runId: string): void {
    for (const run of this.active.values()) {
      if (run.runId === runId && !run.finished) {
        run.cancelled = true;
        this.kill(run.child);
      }
    }
  }

  cancelAll(): void {
    for (const run of this.active.values()) this.cancel(run.runId);
  }

  private begin(
    command: SavedCommand,
    host: SshHost | null
  ): { result: RunRequestResult; run?: ActiveRun } {
    if (this.active.has(command.id)) {
      return { result: { status: 'error', message: 'This command is already running.' } };
    }
    if (this.active.size >= this.maxConcurrent) {
      return {
        result: { status: 'error', message: `Too many commands running (${this.maxConcurrent}). Wait for one to finish.` },
      };
    }
    const invocation = buildInvocation(command, host, this.platform, this.sshPath);
    if ('error' in invocation) return { result: { status: 'error', message: invocation.error } };

    let child: ChildProcess;
    try {
      child = this.spawnFn(invocation.file, invocation.args, invocation.options);
    } catch (e) {
      return { result: { status: 'error', message: e instanceof Error ? e.message : String(e) } };
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    let resolveDone!: (run: LastRun) => void;
    const done = new Promise<LastRun>((resolve) => {
      resolveDone = resolve;
    });
    const run: ActiveRun = {
      commandId: command.id,
      runId,
      startedAt,
      startMs: Date.now(),
      display: invocation.display,
      isSsh: invocation.isSsh,
      child,
      tail: '',
      pending: '',
      flushTimer: null,
      timeoutTimer: setTimeout(() => {
        run.timedOut = true;
        this.kill(child);
      }, command.timeoutSec * 1000),
      timedOut: false,
      cancelled: false,
      finished: false,
      done,
    };
    this.active.set(command.id, run);
    this.emit({ kind: 'start', commandId: command.id, runId, startedAt, display: invocation.display });

    const attach = (stream: NodeJS.ReadableStream | null) => {
      if (!stream) return;
      const decoder = new StringDecoder('utf8');
      stream.on('data', (chunk: Buffer | string) => {
        this.append(run, cleanOutput(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
      });
      stream.on('end', () => this.append(run, cleanOutput(decoder.end())));
    };
    attach(child.stdout);
    attach(child.stderr);

    child.on('error', (err: NodeJS.ErrnoException) => {
      const message =
        err.code === 'ENOENT' && run.isSsh
          ? "The OpenSSH client (ssh) was not found. On Windows, add the optional feature 'OpenSSH Client'."
          : err.message;
      this.finish(run, null, message, resolveDone);
    });
    child.on('close', (code) => this.finish(run, code, null, resolveDone));

    return { result: { status: 'started', runId }, run };
  }

  private append(run: ActiveRun, text: string): void {
    if (!text) return;
    run.tail = (run.tail + text).slice(-MAX_RUN_OUTPUT);
    run.pending += text;
    if (!run.flushTimer) run.flushTimer = setTimeout(() => this.flush(run), this.flushMs);
  }

  private flush(run: ActiveRun): void {
    if (run.flushTimer) clearTimeout(run.flushTimer);
    run.flushTimer = null;
    if (!run.pending) return;
    const text = run.pending;
    run.pending = '';
    this.emit({ kind: 'output', commandId: run.commandId, runId: run.runId, text });
  }

  private finish(run: ActiveRun, code: number | null, errorMessage: string | null, resolve: (run: LastRun) => void): void {
    if (run.finished) return;
    run.finished = true;
    clearTimeout(run.timeoutTimer);
    this.flush(run);
    this.active.delete(run.commandId);

    let outcome: RunOutcome;
    if (errorMessage) outcome = 'error';
    else if (run.timedOut) outcome = 'timeout';
    else if (run.cancelled) outcome = 'cancelled';
    else outcome = code === 0 ? 'ok' : 'failed';

    const result: LastRun = {
      runId: run.runId,
      startedAt: run.startedAt,
      durationMs: Date.now() - run.startMs,
      exitCode: errorMessage ? null : code,
      outcome,
      outputTail: (errorMessage ?? run.tail).slice(-MAX_STORED_OUTPUT),
      display: run.display,
    };
    this.emit({ kind: 'end', commandId: run.commandId, runId: run.runId, run: result });
    try {
      this.onEnd(run.commandId, result);
    } finally {
      resolve(result);
    }
  }
}
