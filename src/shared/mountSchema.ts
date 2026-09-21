/**
 * Mount JSON schema — data-driven service cards (no per-service `kind` in the runtime).
 */

export type LaunchMode = 'path' | 'folder' | 'unset';

export interface MountLaunch {
  mode: LaunchMode;
  cwd: string | null;
}

export interface MountStart {
  type: 'shell';
  command: string;
  preview?: string;
  /** When true, Start stays unavailable until launch.cwd is set. */
  cwdRequired?: boolean;
}

export interface MountStop {
  type: 'port' | 'shell';
  port?: number;
  command?: string;
  preview?: string;
  /** Optional shell commands run after a successful port stop (e.g. tray cleanup). */
  afterShell?: string[];
}

export interface MountHelp {
  when: 'startMissing' | 'launchUnset' | 'always';
  text: string;
}

export interface MountPanelColumn {
  header: string;
  /** Dot path into a row object, e.g. `name` or `details.family`. */
  from: string;
  format?: 'bytes' | 'text';
}

export interface MountPanelList {
  method: 'GET';
  /** Path on hostUrl, e.g. `/api/ps`. */
  path: string;
  /** Dot path to the array in the JSON response, e.g. `models`. */
  items: string;
  columns: MountPanelColumn[];
  emptyText?: string;
}

export interface MountPanelAction {
  id: string;
  label: string;
  scope: 'row' | 'panel';
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  /** When scope is panel and foreach is row, fire once per listed row. */
  foreach?: 'row';
  enabledWhen?: 'panelHasRows';
}

export interface MountPanel {
  id: string;
  when?: 'reachable' | 'always';
  list: MountPanelList;
  actions: MountPanelAction[];
}

/** One dashboard card — stored in userData app-config.json. */
export interface Mount {
  id: string;
  name: string;
  hostUrl: string | null;
  launch: MountLaunch;
  start: MountStart | null;
  stop: MountStop | null;
  help: MountHelp | null;
  panels: MountPanel[];
}

export interface MountPanelRuntime {
  rows: Record<string, unknown>[];
  error?: string;
}

export interface DashboardMount extends Mount {
  reachable: boolean | null;
  panelData: Record<string, MountPanelRuntime>;
}

export interface MountTemplateInfo {
  id: string;
  name: string;
  description: string;
  defaultHostUrl: string;
}

export function blankMount(partial?: Partial<Mount>): Mount {
  return {
    id: partial?.id?.trim() || `mount-${Date.now().toString(36)}`,
    name: partial?.name?.trim() || 'New mount',
    hostUrl: partial?.hostUrl ?? null,
    launch: partial?.launch ?? { mode: 'unset', cwd: null },
    start: partial?.start ?? null,
    stop: partial?.stop ?? null,
    help: partial?.help ?? null,
    panels: partial?.panels ?? [],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asLaunch(raw: unknown): MountLaunch {
  if (!isRecord(raw)) return { mode: 'unset', cwd: null };
  const mode = raw.mode === 'path' || raw.mode === 'folder' || raw.mode === 'unset' ? raw.mode : 'unset';
  const cwd = typeof raw.cwd === 'string' && raw.cwd.trim() ? raw.cwd.trim() : null;
  return { mode: cwd && mode === 'unset' ? 'folder' : mode, cwd };
}

function asStart(raw: unknown): MountStart | null {
  if (!isRecord(raw) || raw.type !== 'shell') return null;
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) return null;
  return {
    type: 'shell',
    command,
    preview: typeof raw.preview === 'string' ? raw.preview : undefined,
    cwdRequired: Boolean(raw.cwdRequired),
  };
}

function asStop(raw: unknown): MountStop | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'port') {
    const port = typeof raw.port === 'number' ? raw.port : Number(raw.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    return {
      type: 'port',
      port,
      preview: typeof raw.preview === 'string' ? raw.preview : undefined,
      afterShell: Array.isArray(raw.afterShell)
        ? raw.afterShell.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : undefined,
    };
  }
  if (raw.type === 'shell') {
    const command = typeof raw.command === 'string' ? raw.command.trim() : '';
    if (!command) return null;
    return {
      type: 'shell',
      command,
      preview: typeof raw.preview === 'string' ? raw.preview : undefined,
    };
  }
  return null;
}

function asHelp(raw: unknown): MountHelp | null {
  if (!isRecord(raw) || typeof raw.text !== 'string' || !raw.text.trim()) return null;
  const when =
    raw.when === 'startMissing' || raw.when === 'launchUnset' || raw.when === 'always'
      ? raw.when
      : 'always';
  return { when, text: raw.text.trim() };
}

function asPanel(raw: unknown): MountPanel | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (!isRecord(raw.list)) return null;
  const list = raw.list;
  if (list.method !== 'GET' || typeof list.path !== 'string' || typeof list.items !== 'string') {
    return null;
  }
  if (!Array.isArray(list.columns) || list.columns.length === 0) return null;
  const columns: MountPanelColumn[] = [];
  for (const col of list.columns) {
    if (!isRecord(col) || typeof col.header !== 'string' || typeof col.from !== 'string') continue;
    columns.push({
      header: col.header,
      from: col.from.replace(/^\$\./, ''),
      format: col.format === 'bytes' ? 'bytes' : 'text',
    });
  }
  if (columns.length === 0) return null;

  const actions: MountPanelAction[] = [];
  if (Array.isArray(raw.actions)) {
    for (const a of raw.actions) {
      if (!isRecord(a) || typeof a.id !== 'string' || typeof a.label !== 'string') continue;
      if (a.scope !== 'row' && a.scope !== 'panel') continue;
      if (a.method !== 'GET' && a.method !== 'POST' && a.method !== 'DELETE') continue;
      if (typeof a.path !== 'string') continue;
      actions.push({
        id: a.id,
        label: a.label,
        scope: a.scope,
        method: a.method,
        path: a.path,
        body: a.body,
        foreach: a.foreach === 'row' ? 'row' : undefined,
        enabledWhen: a.enabledWhen === 'panelHasRows' ? 'panelHasRows' : undefined,
      });
    }
  }

  return {
    id: raw.id.trim(),
    when: raw.when === 'always' ? 'always' : 'reachable',
    list: {
      method: 'GET',
      path: list.path,
      items: String(list.items).replace(/^\$\./, ''),
      columns,
      emptyText: typeof list.emptyText === 'string' ? list.emptyText : undefined,
    },
    actions,
  };
}

/** Normalize / validate unknown JSON into a Mount (fills defaults). */
export function normalizeMount(raw: unknown): Mount | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;
  const hostUrl =
    typeof raw.hostUrl === 'string' && raw.hostUrl.trim() ? raw.hostUrl.trim() : null;
  const panels: MountPanel[] = [];
  if (Array.isArray(raw.panels)) {
    for (const p of raw.panels) {
      const panel = asPanel(p);
      if (panel) panels.push(panel);
    }
  }
  return {
    id,
    name,
    hostUrl,
    launch: asLaunch(raw.launch),
    start: asStart(raw.start),
    stop: asStop(raw.stop),
    help: asHelp(raw.help),
    panels,
  };
}

export function parseMountJson(text: string): { ok: true; mount: Mount } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text) as unknown;
    const mount = normalizeMount(parsed);
    if (!mount) return { ok: false, error: 'JSON must include id and name (and a valid mount shape).' };
    return { ok: true, mount };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Read a dotted path from an object (`models`, `details.family`). */
export function getByPath(obj: unknown, path: string): unknown {
  const clean = path.replace(/^\$\./, '').trim();
  if (!clean) return obj;
  let cur: unknown = obj;
  for (const part of clean.split('.')) {
    if (!isRecord(cur) && !Array.isArray(cur)) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

export function substituteTemplates(value: unknown, row: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{row\.([^}]+)\}\}/g, (_m, path: string) => {
      const v = getByPath(row, path.trim());
      return v == null ? '' : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteTemplates(v, row));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteTemplates(v, row);
    return out;
  }
  return value;
}

export function portFromHostUrl(hostUrl: string | null | undefined, fallback = 80): number {
  if (!hostUrl?.trim()) return fallback;
  try {
    const u = new URL(hostUrl.trim());
    if (u.port) return Number(u.port);
    return u.protocol === 'https:' ? 443 : 80;
  } catch {
    return fallback;
  }
}

/**
 * Migrate legacy ManagedService-shaped rows (kind / actions / workingDir) into Mount JSON.
 */
export function migrateLegacyService(raw: unknown): Mount | null {
  if (!isRecord(raw)) return null;

  // Already a mount (has launch, no legacy kind).
  if (isRecord(raw.launch) && !('kind' in raw)) {
    return normalizeMount(raw);
  }
  // Mount-shaped even if kind sneaks in
  if (isRecord(raw.launch) && typeof raw.name === 'string' && typeof raw.id === 'string') {
    const n = normalizeMount({ ...raw, kind: undefined });
    if (n) return n;
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!id || !name) return null;

  const hostUrl =
    typeof raw.hostUrl === 'string' && raw.hostUrl.trim() ? raw.hostUrl.trim() : null;
  const kind = raw.kind === 'ollama' || raw.kind === 'chatterbox' || raw.kind === 'generic' ? raw.kind : 'generic';
  const workingDir =
    typeof raw.workingDir === 'string' && raw.workingDir.trim() ? raw.workingDir.trim() : null;
  const usePath = Boolean(raw.usePath);

  const launch: MountLaunch = usePath
    ? { mode: 'path', cwd: null }
    : workingDir
      ? { mode: 'folder', cwd: workingDir }
      : { mode: 'unset', cwd: null };

  if (kind === 'ollama') {
    return {
      id,
      name,
      hostUrl: hostUrl ?? 'http://localhost:11434',
      launch,
      start: {
        type: 'shell',
        command: 'ollama serve',
        preview: 'ollama on PATH (`ollama serve`), or open ollama.exe from launch folder',
      },
      stop: {
        type: 'port',
        port: portFromHostUrl(hostUrl, 11434),
        preview:
          'taskkill listeners on :11434 + Ollama.exe tray (Windows respawns llama-server otherwise)',
        afterShell:
          process.platform === 'win32'
            ? [
                'taskkill /IM "Ollama.exe" /T /F',
                'taskkill /IM "ollama.exe" /T /F',
                'taskkill /IM "llama-server.exe" /T /F',
              ]
            : undefined,
      },
      help: null,
      panels: [
        {
          id: 'loaded-models',
          when: 'reachable',
          list: {
            method: 'GET',
            path: '/api/ps',
            items: 'models',
            columns: [
              { header: 'Model', from: 'name', format: 'text' },
              { header: 'Processor', from: 'processor', format: 'text' },
              { header: 'VRAM', from: 'size_vram', format: 'bytes' },
            ],
            emptyText: 'No models loaded',
          },
          actions: [
            {
              id: 'unload',
              label: 'Unload',
              scope: 'row',
              method: 'POST',
              path: '/api/generate',
              body: { model: '{{row.name}}', prompt: '', keep_alive: 0 },
            },
            {
              id: 'unload-all',
              label: 'Unload all',
              scope: 'panel',
              foreach: 'row',
              enabledWhen: 'panelHasRows',
              method: 'POST',
              path: '/api/generate',
              body: { model: '{{row.name}}', prompt: '', keep_alive: 0 },
            },
          ],
        },
      ],
    };
  }

  if (kind === 'chatterbox') {
    return {
      id,
      name,
      hostUrl: hostUrl ?? 'http://localhost:8004',
      launch: usePath ? { mode: 'unset', cwd: null } : launch,
      start: {
        type: 'shell',
        command: 'python_embedded\\python.exe start.py --portable --nvidia-cu128 --verbose',
        preview:
          'cmd /c start … python_embedded\\python.exe start.py --portable --nvidia-cu128 --verbose',
        cwdRequired: true,
      },
      stop: {
        type: 'port',
        port: portFromHostUrl(hostUrl, 8004),
        preview: 'taskkill listeners on Chatterbox port + processes under launch folder',
      },
      help: {
        when: 'launchUnset',
        text: 'Choose a launch folder before Start is available. Stop still appears when the service is reachable.',
      },
      panels: [],
    };
  }

  // generic / unknown — try to salvage shell/stop-port from actions
  let start: MountStart | null = null;
  let stop: MountStop | null = null;
  if (Array.isArray(raw.actions)) {
    for (const a of raw.actions) {
      if (!isRecord(a) || !isRecord(a.runner)) continue;
      const runner = a.runner;
      const idLower = typeof a.id === 'string' ? a.id.toLowerCase() : '';
      if ((idLower === 'start' || a.label === 'Start') && runner.type === 'shell') {
        const command = typeof runner.command === 'string' ? runner.command : '';
        if (command && !/^\s*echo\b/i.test(command)) {
          start = {
            type: 'shell',
            command,
            preview: typeof a.commandPreview === 'string' ? a.commandPreview : undefined,
          };
        }
      }
      if ((idLower === 'stop' || a.label === 'Stop') && runner.type === 'stop-port') {
        const port = typeof runner.port === 'number' ? runner.port : portFromHostUrl(hostUrl, 8080);
        stop = {
          type: 'port',
          port,
          preview: typeof a.commandPreview === 'string' ? a.commandPreview : undefined,
        };
      }
    }
  }
  if (!stop && hostUrl) {
    stop = {
      type: 'port',
      port: portFromHostUrl(hostUrl, 8080),
      preview: `taskkill listeners on TCP ${portFromHostUrl(hostUrl, 8080)}`,
    };
  }

  return {
    id,
    name,
    hostUrl,
    launch,
    start,
    stop,
    help: start
      ? null
      : {
          when: 'startMissing',
          text: 'Start is a placeholder until you set a real shell command for this mount.',
        },
    panels: [],
  };
}

export function canStartMount(mount: Mount): boolean {
  if (!mount.start?.command.trim()) return false;
  if (/^\s*echo\b/i.test(mount.start.command)) return false;
  if (mount.start.cwdRequired && !mount.launch.cwd?.trim()) return false;
  if (mount.launch.mode === 'path') return true;
  if (mount.launch.mode === 'folder' && mount.launch.cwd?.trim()) return true;
  // Unset launch: only if Start does not require cwd
  if (mount.launch.mode === 'unset' && !mount.start.cwdRequired) return true;
  return false;
}

export function resolveHelpText(mount: Mount): string | null {
  if (!mount.help?.text) {
    if (!canStartMount(mount) && !mount.start) {
      return 'Start is unavailable until you set a shell command (Edit mount).';
    }
    if (mount.start?.cwdRequired && !mount.launch.cwd?.trim()) {
      return 'Choose a launch folder before Start is available. Stop still appears when the service is reachable.';
    }
    return null;
  }
  const { when, text } = mount.help;
  if (when === 'always') return text;
  if (when === 'launchUnset' && mount.launch.mode === 'unset') return text;
  if (when === 'startMissing' && !canStartMount(mount)) return text;
  return null;
}
