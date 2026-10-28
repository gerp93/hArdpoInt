import { app, dialog, ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type {
  CommandEvent,
  CommandResult,
  CommandsState,
  LastRun,
  RunRequestResult,
  SavedCommand,
} from '../../shared/commandSchema';
import {
  describeInvocation,
  normalizeCommand,
  normalizeHost,
  sshTarget,
  validateCommand,
  validateHost,
} from '../../shared/commandSchema';
import { riskReason } from '../../shared/commandRisk';
import { appendCommandLog } from '../commandLog';
import { CommandRunner } from './runner';
import { clearRun, readBoard, readRuns, saveRun, writeBoard } from './store';
import { isTrustedRendererUrl } from './trust';

const TEST_PREFIX = '__test__:';

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Commands run only through these handlers, which only the app window can reach. They are
 * deliberately not on the loopback HTTP API and not offered to the Assistant. The renderer sends an
 * id; the command text is always read from the saved copy here.
 */
export function registerCommandIpc(getWindow: () => BrowserWindow | null): CommandRunner {
  const emit = (event: CommandEvent) => getWindow()?.webContents.send('commands:event', event);

  const onEnd = (commandId: string, run: LastRun) => {
    if (commandId.startsWith(TEST_PREFIX)) return;
    saveRun(commandId, run);
    const name = readBoard().commands.find((c) => c.id === commandId)?.name ?? commandId;
    appendCommandLog({
      serviceId: `command:${commandId}`,
      actionId: 'run',
      command: name,
      ok: run.outcome === 'ok',
      detail: `${run.outcome}${run.exitCode !== null ? ` · exit ${run.exitCode}` : ''} · ${seconds(run.durationMs)}`,
    });
  };

  const runner = new CommandRunner(emit, onEnd);

  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>
  ) => {
    ipcMain.handle(channel, (event, ...args) => {
      const win = getWindow();
      if (!win || event.sender !== win.webContents || !isTrustedRendererUrl(event.senderFrame?.url, app.isPackaged)) {
        throw new Error('Commands can only be used from the Hardpoint window.');
      }
      return fn(event, ...(args as A));
    });
  };

  const state = (): CommandsState => ({
    ...readBoard(),
    runs: readRuns(),
    running: runner.running(),
  });

  handle('commands:list', () => state());

  handle('commands:save', (_e, raw: unknown): CommandResult => {
    const command = normalizeCommand(raw);
    if (!command) return { status: 'error', message: 'Invalid command (needs an id, a name and a command).' };
    const board = readBoard();
    const problem = validateCommand(command, board.hosts);
    if (problem) return { status: 'error', message: problem };
    if (runner.running().some((r) => r.commandId === command.id)) {
      return { status: 'error', message: 'This command is running. Wait for it to finish before editing it.' };
    }
    writeBoard({ commands: [...board.commands.filter((c) => c.id !== command.id), command] });
    return { status: 'ok' };
  });

  handle('commands:delete', (_e, id: unknown): CommandResult => {
    const target = String(id ?? '');
    if (runner.running().some((r) => r.commandId === target)) {
      return { status: 'error', message: 'This command is running. Cancel it first.' };
    }
    writeBoard({ commands: readBoard().commands.filter((c) => c.id !== target) });
    clearRun(target);
    return { status: 'ok' };
  });

  handle('commands:saveHost', (_e, raw: unknown): CommandResult => {
    const host = normalizeHost(raw);
    if (!host) return { status: 'error', message: 'Invalid host (needs an id and a host).' };
    const problem = validateHost(host);
    if (problem) return { status: 'error', message: problem };
    const board = readBoard();
    writeBoard({ hosts: [...board.hosts.filter((h) => h.id !== host.id), host] });
    return { status: 'ok' };
  });

  handle('commands:deleteHost', (_e, id: unknown): CommandResult => {
    const target = String(id ?? '');
    const board = readBoard();
    const users = board.commands.filter((c) => c.where.kind === 'ssh' && c.where.hostId === target);
    if (users.length > 0) {
      return { status: 'error', message: `Still used by: ${users.map((c) => c.name).join(', ')}.` };
    }
    writeBoard({ hosts: board.hosts.filter((h) => h.id !== target) });
    return { status: 'ok' };
  });

  handle('commands:run', async (_e, id: unknown): Promise<RunRequestResult> => {
    const board = readBoard();
    const command = board.commands.find((c) => c.id === String(id ?? ''));
    if (!command) return { status: 'error', message: 'Unknown command.' };
    const where = command.where;
    const host = where.kind === 'ssh' ? (board.hosts.find((h) => h.id === where.hostId) ?? null) : null;
    if (where.kind === 'ssh' && !host) {
      return { status: 'error', message: 'The SSH host for this command no longer exists.' };
    }
    const problem = validateCommand(command, board.hosts) ?? (host ? validateHost(host) : null);
    if (problem) return { status: 'error', message: problem };

    const risk = riskReason(command.command);
    if (command.confirm || risk) {
      const display = describeInvocation(command, host);
      const win = getWindow();
      const options: Electron.MessageBoxOptions = {
        type: risk ? 'warning' : 'question',
        buttons: ['Run', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Run command',
        message: `Run “${command.name}”?`,
        detail: `${display}${risk ? `\n\nThis ${risk}.` : ''}`,
      };
      const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      if (answer.response !== 0) return { status: 'declined' };
    }
    return runner.start(command, host);
  });

  handle('commands:cancel', (_e, runId: unknown) => {
    runner.cancel(String(runId ?? ''));
  });

  handle('commands:testHost', async (_e, hostId: unknown) => {
    const host = readBoard().hosts.find((h) => h.id === String(hostId ?? ''));
    if (!host) return { status: 'error' as const, message: 'Unknown host.' };
    const probe: SavedCommand = {
      id: `${TEST_PREFIX}${host.id}`,
      name: 'Test connection',
      group: null,
      note: null,
      where: { kind: 'ssh', hostId: host.id },
      command: 'echo hardpoint-ok',
      cwd: null,
      timeoutSec: 20,
      confirm: false,
    };
    const result = await runner.runAndWait(probe, host);
    if ('error' in result) return { status: 'error' as const, message: result.error };
    if (result.outcome === 'ok' && result.outputTail.includes('hardpoint-ok')) {
      return { status: 'ok' as const, message: `Connected to ${sshTarget(host)} with no prompts.` };
    }
    const out = result.outputTail.trim();
    const hint = /host key verification failed|no matching host key/i.test(out)
      ? `\nTrust the host once from a terminal: ssh ${sshTarget(host)}`
      : /permission denied/i.test(out)
        ? '\nThe server did not accept your key. Add it to the server (ssh-copy-id) or load it into ssh-agent if it has a passphrase.'
        : '';
    return { status: 'error' as const, message: `${out || result.outcome}${hint}` };
  });

  handle('commands:clearRun', (_e, id: unknown) => {
    clearRun(String(id ?? ''));
  });

  return runner;
}
