import { useEffect, useState } from 'react';
import type { CommandsApi, LastRun, RunOutcome, SavedCommand } from '../../shared/commandSchema';

/** The command board API, present only in the desktop window. */
export function getCommandsApi(): CommandsApi | undefined {
  return typeof window !== 'undefined' ? window.hardpoint?.commands : undefined;
}

export interface CommandView {
  query: string;
  group: string | null;
}

const STORAGE_KEY = 'hardpoint-command-view';
export const DEFAULT_COMMAND_VIEW: CommandView = { query: '', group: null };

export function loadCommandView(): CommandView {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<CommandView> | null;
    return {
      query: typeof raw?.query === 'string' ? raw.query : '',
      group: typeof raw?.group === 'string' ? raw.group : null,
    };
  } catch {
    return DEFAULT_COMMAND_VIEW;
  }
}

export function saveCommandView(view: CommandView): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch {
    /* storage unavailable */
  }
}

export function commandGroups(commands: SavedCommand[]): string[] {
  const groups = new Set<string>();
  for (const c of commands) if (c.group) groups.add(c.group);
  return [...groups].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function applyCommandView(commands: SavedCommand[], view: CommandView): SavedCommand[] {
  const q = view.query.trim().toLowerCase();
  return commands
    .filter((c) => view.group === null || c.group === view.group)
    .filter((c) => !q || [c.name, c.command, c.group, c.note].some((f) => f?.toLowerCase().includes(q)))
    .sort(
      (a, b) =>
        (a.group ?? '').localeCompare(b.group ?? '', undefined, { sensitivity: 'base' }) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  ok: 'OK',
  failed: 'Failed',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  error: 'Could not start',
};

/** "exit 3", or "ssh error" for ssh's own failure code. */
export function exitLabel(run: LastRun, viaSsh: boolean): string {
  if (run.exitCode === null) return OUTCOME_LABEL[run.outcome].toLowerCase();
  if (viaSsh && run.exitCode === 255) return 'exit 255 (ssh error)';
  return `exit ${run.exitCode}`;
}

/** How many commands last failed, for the tab badge. Updates as runs finish. */
export function useFailedCommandCount(): number {
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    const api = getCommandsApi();
    if (!api) return;
    let alive = true;
    const load = () =>
      void api
        .list()
        .then((state) => {
          if (!alive) return;
          const ids = new Set(state.commands.map((c) => c.id));
          setFailed(Object.entries(state.runs).filter(([id, r]) => ids.has(id) && r.outcome !== 'ok' && r.outcome !== 'cancelled').length);
        })
        .catch(() => undefined);
    load();
    const off = api.onEvent((event) => {
      if (event.kind === 'end') load();
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return failed;
}
