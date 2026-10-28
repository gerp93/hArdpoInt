/**
 * The command board: saved one-click commands, run on this PC or over the system `ssh` with keys.
 * Pure types and helpers shared by the main process and the renderer. Nothing here runs anything.
 */

export interface SshHost {
  id: string;
  /** Shown in the UI. */
  label: string;
  /** Hostname, IP, or a `~/.ssh/config` alias. */
  host: string;
  /** Null = let ssh (or its config) decide. */
  user: string | null;
  /** Null = ssh's default / config. */
  port: number | null;
  /** Path to a private key file (the path only, never its contents). */
  identityFile: string | null;
}

export type CommandWhere = { kind: 'local' } | { kind: 'ssh'; hostId: string };

export interface SavedCommand {
  id: string;
  name: string;
  group: string | null;
  note: string | null;
  where: CommandWhere;
  /** One line. Local: run by cmd.exe (sh on other systems). SSH: run by the remote login shell. */
  command: string;
  /** Local only. */
  cwd: string | null;
  timeoutSec: number;
  /** Ask in a native dialog before every run. Risky commands ask regardless. */
  confirm: boolean;
}

export type RunOutcome = 'ok' | 'failed' | 'timeout' | 'cancelled' | 'error';

export interface LastRun {
  runId: string;
  startedAt: string;
  durationMs: number;
  /** Null when the process was killed or never started. */
  exitCode: number | null;
  outcome: RunOutcome;
  /** The end of the output (capped), or the error message when it never started. */
  outputTail: string;
  /** What actually ran, as shown to the user. */
  display: string;
}

export interface RunningCommand {
  commandId: string;
  runId: string;
  startedAt: string;
}

export interface CommandsState {
  commands: SavedCommand[];
  hosts: SshHost[];
  runs: Record<string, LastRun>;
  running: RunningCommand[];
}

/** Streamed from the main process while a command runs. */
export type CommandEvent =
  | { kind: 'start'; commandId: string; runId: string; startedAt: string; display: string }
  | { kind: 'output'; commandId: string; runId: string; text: string }
  | { kind: 'end'; commandId: string; runId: string; run: LastRun };

export type CommandResult = { status: 'ok' } | { status: 'error'; message: string };

export type RunRequestResult =
  | { status: 'started'; runId: string }
  | { status: 'declined' }
  | { status: 'error'; message: string };

export interface CommandsApi {
  list: () => Promise<CommandsState>;
  save: (command: SavedCommand) => Promise<CommandResult>;
  delete: (id: string) => Promise<CommandResult>;
  saveHost: (host: SshHost) => Promise<CommandResult>;
  deleteHost: (id: string) => Promise<CommandResult>;
  /** Run a saved command by id. The command text always comes from the saved copy in the main process. */
  run: (id: string) => Promise<RunRequestResult>;
  cancel: (runId: string) => Promise<void>;
  /** Connect with the host's settings and run `echo`, to check keys and the host key. */
  testHost: (hostId: string) => Promise<{ status: 'ok' | 'error'; message: string }>;
  clearRun: (id: string) => Promise<void>;
  onEvent: (listener: (event: CommandEvent) => void) => () => void;
}

/** Output kept after a run (live output in the window is allowed to be longer). */
export const MAX_STORED_OUTPUT = 16 * 1024;
export const DEFAULT_TIMEOUT_SEC = 60;
export const MAX_TIMEOUT_SEC = 3600;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** ASCII only: this rejects look-alikes such as the fullwidth "＠" (U+FF20). */
const SSH_USER = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const IPV6 = /^[0-9A-Fa-f:]+(%[A-Za-z0-9]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strOrNull(value: unknown): string | null {
  const s = str(value);
  return s ? s : null;
}

export function normalizeHost(raw: unknown): SshHost | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const host = str(raw.host);
  if (!id || !host) return null;
  const port = typeof raw.port === 'number' && Number.isInteger(raw.port) ? raw.port : null;
  return {
    id,
    label: str(raw.label) || host,
    host,
    user: strOrNull(raw.user),
    port,
    identityFile: strOrNull(raw.identityFile),
  };
}

export function normalizeCommand(raw: unknown): SavedCommand | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!id || !name || !command) return null;
  const where = isRecord(raw.where) ? raw.where : {};
  const hostId = str(where.hostId);
  const timeout = typeof raw.timeoutSec === 'number' && Number.isFinite(raw.timeoutSec) ? raw.timeoutSec : DEFAULT_TIMEOUT_SEC;
  return {
    id,
    name,
    group: strOrNull(raw.group),
    note: strOrNull(raw.note),
    where: where.kind === 'ssh' && hostId ? { kind: 'ssh', hostId } : { kind: 'local' },
    command,
    cwd: strOrNull(raw.cwd),
    timeoutSec: Math.min(MAX_TIMEOUT_SEC, Math.max(1, Math.round(timeout))),
    confirm: raw.confirm === true,
  };
}

/** Why a host can't be saved, or null. Strict: this is what ends up on the ssh command line. */
export function validateHost(host: SshHost): string | null {
  if (!SLUG.test(host.id)) return 'Host id must be letters, numbers, dots, dashes or underscores.';
  if (!host.label.trim()) return 'Give the host a name.';
  const name = host.host;
  if (!(SSH_HOST.test(name) || (IPV6.test(name) && name.includes(':')))) {
    return 'Host must be a plain ASCII hostname, IP address or ssh config alias (no spaces, no leading dash).';
  }
  if (host.user !== null && !SSH_USER.test(host.user)) {
    return 'User must be plain ASCII letters, numbers, dots, dashes or underscores (no @, spaces or leading dash).';
  }
  if (host.port !== null && !(Number.isInteger(host.port) && host.port >= 1 && host.port <= 65535)) {
    return 'Port must be 1-65535.';
  }
  if (host.identityFile !== null && /[\r\n\0]/.test(host.identityFile)) return 'Key path has invalid characters.';
  if (host.identityFile?.startsWith('-')) return 'Key path must not start with a dash.';
  return null;
}

/** Why a command can't be saved, or null. */
export function validateCommand(command: SavedCommand, hosts: SshHost[]): string | null {
  if (!SLUG.test(command.id)) return 'Command id must be letters, numbers, dots, dashes or underscores.';
  if (!command.name.trim()) return 'Give the command a name.';
  if (!command.command.trim()) return 'Enter the command to run.';
  if (/[\r\n\0]/.test(command.command)) return 'A command must be a single line.';
  if (command.where.kind === 'ssh') {
    const hostId = command.where.hostId;
    if (!hosts.some((h) => h.id === hostId)) return 'Choose a saved SSH host.';
    if (command.command.startsWith('-')) return 'A remote command must not start with a dash.';
  } else if (command.cwd && /[\r\n\0]/.test(command.cwd)) {
    return 'Working folder has invalid characters.';
  }
  if (!(command.timeoutSec >= 1 && command.timeoutSec <= MAX_TIMEOUT_SEC)) {
    return `Timeout must be 1-${MAX_TIMEOUT_SEC} seconds.`;
  }
  return null;
}

/** user@host, or just host when the user comes from ssh's own config. */
export function sshTarget(host: SshHost): string {
  return host.user ? `${host.user}@${host.host}` : host.host;
}

/**
 * The exact ssh arguments. BatchMode means ssh never prompts (a key that needs a passphrase must be in
 * ssh-agent), an unknown host key is an error rather than a question, and `--` ends option parsing so
 * a host can never be read as a flag. There is no local shell involved, so no local quoting.
 */
export function sshArgs(host: SshHost, remoteCommand: string): string[] {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ServerAliveInterval=15',
    '-T',
    ...(host.port !== null ? ['-p', String(host.port)] : []),
    ...(host.identityFile ? ['-i', host.identityFile] : []),
    '--',
    sshTarget(host),
    remoteCommand,
  ];
}

function quoteForDisplay(arg: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/** The full command line as it will run, for the confirmation and the preview. */
export function describeInvocation(command: SavedCommand, host: SshHost | null): string {
  if (command.where.kind === 'ssh' && host) {
    return ['ssh', ...sshArgs(host, command.command)].map(quoteForDisplay).join(' ');
  }
  return command.cwd ? `(in ${command.cwd}) ${command.command}` : command.command;
}

/** A short line you could paste into a terminal to do the same thing. */
export function copyableCommand(command: SavedCommand, host: SshHost | null): string {
  if (command.where.kind === 'ssh' && host) {
    const flags = [
      ...(host.port !== null ? ['-p', String(host.port)] : []),
      ...(host.identityFile ? ['-i', quoteForDisplay(host.identityFile)] : []),
    ];
    return ['ssh', ...flags, sshTarget(host), command.command].join(' ');
  }
  return command.command;
}
