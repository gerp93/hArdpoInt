import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandsApi, CommandsState, SavedCommand } from '../../shared/commandSchema';
import { copyableCommand } from '../../shared/commandSchema';
import { riskReason } from '../../shared/commandRisk';
import {
  OUTCOME_LABEL,
  applyCommandView,
  commandGroups,
  exitLabel,
  loadCommandView,
  saveCommandView,
  timeAgo,
  type CommandView,
} from '../utils/commandView';
import { CommandEditor, blankCommand } from './CommandEditor';
import { CommandOutput, type LiveRun } from './CommandOutput';
import { HostEditor } from './HostEditor';

const MAX_LIVE_OUTPUT = 256 * 1024;

type Mode = { kind: 'list' } | { kind: 'edit'; command: SavedCommand } | { kind: 'hosts' };

/**
 * The command board: saved commands you run with one click, on this PC or over SSH. Everything runs
 * in the main process and is reached only through the window's IPC bridge.
 */
export function CommandsPanel({ api }: { api: CommandsApi }) {
  const [state, setState] = useState<CommandsState | null>(null);
  const [live, setLive] = useState<Record<string, LiveRun>>({});
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<CommandView>(loadCommandView);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await api.list();
      setState(next);
      setLive((prev) => {
        const merged = { ...prev };
        for (const r of next.running) {
          if (!merged[r.commandId]) merged[r.commandId] = { runId: r.runId, startedAt: r.startedAt, display: '', text: '' };
        }
        return merged;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => saveCommandView(view), [view]);

  useEffect(() => {
    void refresh();
    return api.onEvent((event) => {
      if (event.kind === 'start') {
        setLive((prev) => ({
          ...prev,
          [event.commandId]: { runId: event.runId, startedAt: event.startedAt, display: event.display, text: '' },
        }));
        setSelected(event.commandId);
      } else if (event.kind === 'output') {
        setLive((prev) => {
          const run = prev[event.commandId];
          if (!run || run.runId !== event.runId) return prev;
          return { ...prev, [event.commandId]: { ...run, text: (run.text + event.text).slice(-MAX_LIVE_OUTPUT) } };
        });
      } else {
        setLive((prev) => {
          const next = { ...prev };
          delete next[event.commandId];
          return next;
        });
        void refresh();
      }
    });
  }, [api, refresh]);

  const commands = state?.commands ?? [];
  const hosts = state?.hosts ?? [];
  const runs = state?.runs ?? {};
  const groups = useMemo(() => commandGroups(commands), [commands]);
  const visible = useMemo(() => applyCommandView(commands, view), [commands, view]);
  const hostOf = (c: SavedCommand) => {
    const where = c.where;
    return where.kind === 'ssh' ? (hosts.find((h) => h.id === where.hostId) ?? null) : null;
  };
  const hostLabel = (c: SavedCommand) => (c.where.kind === 'ssh' ? (hostOf(c)?.label ?? 'missing host') : 'This PC');
  const selectedCommand = commands.find((c) => c.id === selected) ?? null;

  async function run(command: SavedCommand) {
    setStarting(command.id);
    setError(null);
    try {
      const result = await api.run(command.id);
      if (result.status === 'error') setError(`${command.name}: ${result.message}`);
      else if (result.status === 'started') setSelected(command.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(null);
    }
  }

  async function remove(command: SavedCommand) {
    if (!window.confirm(`Delete “${command.name}”?`)) return;
    const result = await api.delete(command.id);
    if (result.status === 'error') setError(result.message);
    else {
      if (selected === command.id) setSelected(null);
      await refresh();
    }
  }

  function copy(command: SavedCommand) {
    void navigator.clipboard?.writeText(copyableCommand(command, hostOf(command))).catch(() => undefined);
  }

  if (!state) {
    return (
      <section className="card card-fill">
        <h2>Commands</h2>
        {error ? <p className="banner banner-error">{error}</p> : <p className="muted">Loading…</p>}
      </section>
    );
  }

  if (mode.kind === 'edit') {
    return (
      <CommandEditor
        api={api}
        initial={mode.command}
        hosts={hosts}
        groups={groups}
        onCancel={() => setMode({ kind: 'list' })}
        onSaved={() => {
          setMode({ kind: 'list' });
          void refresh();
        }}
        onManageHosts={() => setMode({ kind: 'hosts' })}
      />
    );
  }

  if (mode.kind === 'hosts') {
    return (
      <HostEditor
        api={api}
        hosts={hosts}
        commands={commands}
        onChanged={() => void refresh()}
        onDone={() => setMode({ kind: 'list' })}
      />
    );
  }

  return (
    <section className="card card-fill cb-card">
      <div className="card-header">
        <h2>
          Commands
          {commands.length > 0 && <span className="muted"> ({commands.length})</span>}
        </h2>
        <div className="btn-row btn-row-flush">
          <button type="button" className="btn btn-sm" onClick={() => setMode({ kind: 'hosts' })}>
            SSH hosts{hosts.length > 0 ? ` (${hosts.length})` : ''}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setMode({ kind: 'edit', command: blankCommand() })}>
            Add command
          </button>
        </div>
      </div>
      {error && <p className="banner banner-error">{error}</p>}

      {commands.length === 0 ? (
        <p className="muted">
          Save the commands you keep retyping, for example <code>ssh kvg@192.168.68.110 punctual sync</code>, and run them with one click.
          Add an SSH host first for anything that runs on another machine. Commands run only from this window, and risky ones always ask first.
        </p>
      ) : (
        <>
          <div className="mount-toolbar">
            {commands.length > 4 && (
              <input
                className="mount-search"
                type="search"
                placeholder="Search commands…"
                value={view.query}
                onChange={(e) => setView({ ...view, query: e.target.value })}
              />
            )}
            {groups.length > 0 && (
              <div className="mount-filters" role="group" aria-label="Filter by group">
                {[null, ...groups].map((g) => (
                  <button
                    key={g ?? '__all'}
                    type="button"
                    className={`filter-chip${view.group === g ? ' active' : ''}`}
                    aria-pressed={view.group === g}
                    onClick={() => setView({ ...view, group: g })}
                  >
                    {g ?? 'All'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="cb-body">
            <ul className="cb-list">
              {visible.map((c) => {
                const running = live[c.id] !== undefined;
                const last = runs[c.id];
                const risk = riskReason(c.command);
                return (
                  <li key={c.id} className={`cb-row${selected === c.id ? ' selected' : ''}`}>
                    <button type="button" className="cb-main" onClick={() => setSelected(c.id)} title={copyableCommand(c, hostOf(c))}>
                      <strong>{c.name}</strong>
                      <span className="muted cb-sub">
                        {hostLabel(c)}
                        {c.group ? ` · ${c.group}` : ''}
                        {c.confirm || risk ? ' · asks first' : ''}
                        {last && !running ? ` · ${exitLabel(last, c.where.kind === 'ssh')} · ${timeAgo(last.startedAt)}` : ''}
                      </span>
                    </button>
                    {running ? (
                      <span className="status-pill status-run">Running…</span>
                    ) : last ? (
                      <span className={`status-pill ${last.outcome === 'ok' ? 'status-ok' : last.outcome === 'cancelled' ? 'status-idle' : 'status-down'}`}>
                        {OUTCOME_LABEL[last.outcome]}
                      </span>
                    ) : (
                      <span className="status-pill status-idle">Never run</span>
                    )}
                    {running ? (
                      <button type="button" className="btn btn-sm" onClick={() => void api.cancel(live[c.id].runId)}>
                        Cancel
                      </button>
                    ) : (
                      <button type="button" className="btn btn-sm" disabled={starting !== null} onClick={() => void run(c)}>
                        Run
                      </button>
                    )}
                    <span className="cb-actions">
                      <button type="button" className="btn btn-sm" title="Copy the command" onClick={() => copy(c)}>
                        Copy
                      </button>
                      <button type="button" className="btn btn-sm" disabled={running} onClick={() => setMode({ kind: 'edit', command: c })}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          setMode({
                            kind: 'edit',
                            command: { ...c, id: blankCommand().id, name: `${c.name} (copy)` },
                          })
                        }
                      >
                        Duplicate
                      </button>
                      <button type="button" className="btn btn-sm" disabled={running} onClick={() => void remove(c)}>
                        Delete
                      </button>
                    </span>
                  </li>
                );
              })}
              {visible.length === 0 && <li className="muted">No commands match.</li>}
            </ul>

            {selectedCommand ? (
              <CommandOutput
                name={selectedCommand.name}
                viaSsh={selectedCommand.where.kind === 'ssh'}
                live={live[selectedCommand.id]}
                last={runs[selectedCommand.id]}
                onCancel={() => {
                  const run = live[selectedCommand.id];
                  if (run) void api.cancel(run.runId);
                }}
                onClear={() => void api.clearRun(selectedCommand.id).then(refresh)}
              />
            ) : (
              <p className="muted cb-empty-output">Select a command to see its output.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
