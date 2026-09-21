import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import * as fs from 'fs';
import type { ActionResult, MountTemplateInfo } from '../shared/types';
import type { Mount, MountPanel, MountPanelRuntime } from '../shared/mountSchema';
import {
  blankMount,
  canStartMount,
  getByPath,
  normalizeMount,
  portFromHostUrl,
  substituteTemplates,
} from '../shared/mountSchema';
import { appendCommandLog } from './commandLog';
import { getSeedsPath, readMounts, writeMounts } from './config';
import { stopLocalServer } from './localServerProcess';

export function listMounts(): Mount[] {
  return readMounts();
}

interface SeedFileEntry {
  id: string;
  name: string;
  description: string;
  mount: unknown;
}

function loadSeedFile(): SeedFileEntry[] {
  try {
    const p = getSeedsPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as unknown;
    return Array.isArray(raw) ? (raw as SeedFileEntry[]) : [];
  } catch {
    return [];
  }
}

export function listMountTemplates(): MountTemplateInfo[] {
  return loadSeedFile().map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    defaultHostUrl:
      (normalizeMount(s.mount)?.hostUrl ??
        (typeof (s.mount as { hostUrl?: string })?.hostUrl === 'string'
          ? (s.mount as { hostUrl: string }).hostUrl
          : 'http://127.0.0.1:8080')) || 'http://127.0.0.1:8080',
  }));
}

export function getTemplateMount(templateId: string): Mount | null {
  const entry = loadSeedFile().find((s) => s.id === templateId);
  if (!entry) return null;
  const mount = normalizeMount(entry.mount);
  if (!mount) return null;
  return {
    ...mount,
    id: `${mount.id}-${Date.now().toString(36)}`,
  };
}

export function addFromTemplate(
  templateId: string,
  overrides?: Partial<Pick<Mount, 'name' | 'hostUrl'>>
): { status: 'ok'; mount: Mount } | { status: 'error'; message: string } {
  const base = getTemplateMount(templateId);
  if (!base) return { status: 'error', message: `Unknown template: ${templateId}` };
  const mount: Mount = {
    ...base,
    name: overrides?.name?.trim() || base.name,
    hostUrl: overrides?.hostUrl?.trim() || base.hostUrl,
  };
  if (mount.stop?.type === 'port' && mount.hostUrl) {
    mount.stop = { ...mount.stop, port: portFromHostUrl(mount.hostUrl, mount.stop.port ?? 8080) };
  }
  const saved = saveMount(mount);
  if (saved.status === 'error') return saved;
  return { status: 'ok', mount };
}

export function saveMount(mount: Mount): { status: 'ok' } | { status: 'error'; message: string } {
  const normalized = normalizeMount(mount);
  if (!normalized) return { status: 'error', message: 'Invalid mount (need id and name).' };
  if (normalized.launch.mode === 'path') {
    normalized.launch = { mode: 'path', cwd: null };
  } else if (normalized.launch.mode === 'folder' && !normalized.launch.cwd?.trim()) {
    return { status: 'error', message: 'Folder launch mode needs a launch folder.' };
  }
  const mounts = listMounts().filter((m) => m.id !== normalized.id);
  mounts.push(normalized);
  writeMounts(mounts);
  return { status: 'ok' };
}

export function deleteMount(mountId: string): { status: 'ok' } | { status: 'error'; message: string } {
  const id = mountId.trim();
  if (!id) return { status: 'error', message: 'Mount id is required.' };
  writeMounts(listMounts().filter((m) => m.id !== id));
  return { status: 'ok' };
}

export function createBlankMount(partial?: Partial<Mount>): Mount {
  return blankMount(partial);
}

function runIgnore(file: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const out = `${stdout ?? ''}${stderr ?? ''}`.trim();
      resolve(error ? `${error.message}${out ? `: ${out}` : ''}` : out || 'ok');
    });
  });
}

async function runShellCommand(
  command: string,
  cwd?: string
): Promise<{ ok: boolean; detail: string; preview: string }> {
  const preview = cwd ? `(cd ${cwd}) ${command}` : command;
  if (process.platform === 'win32') {
    const detail = await new Promise<string>((resolve) => {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
        cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
        windowsHide: false,
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', (err) => resolve(err.message));
      // Detached start — don't wait for the long-running server
      child.unref();
      resolve('started');
    });
    const ok = !/ENOENT|not recognized/i.test(detail);
    return { ok, detail, preview };
  }

  const detail = await new Promise<string>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => resolve(err.message));
    child.unref();
    resolve('started');
  });
  return { ok: true, detail, preview };
}

async function runShellWait(
  command: string,
  cwd?: string
): Promise<{ ok: boolean; detail: string; preview: string }> {
  const preview = cwd ? `(cd ${cwd}) ${command}` : command;
  if (process.platform === 'win32') {
    const detail = await new Promise<string>((resolve) => {
      const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
        cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout?.on('data', (d) => {
        out += String(d);
      });
      child.stderr?.on('data', (d) => {
        out += String(d);
      });
      child.on('error', (err) => resolve(err.message));
      child.on('close', (code) => resolve(out.trim() || `exit ${code ?? '?'}`));
    });
    return { ok: true, detail, preview };
  }
  const detail = await runIgnore('/bin/sh', ['-c', command]);
  return { ok: true, detail, preview };
}

export async function fetchPanelData(
  mount: Mount,
  panel: MountPanel
): Promise<MountPanelRuntime> {
  if (!mount.hostUrl?.trim()) return { rows: [], error: 'No host URL' };
  const base = mount.hostUrl.replace(/\/+$/, '');
  const url = `${base}${panel.list.path.startsWith('/') ? '' : '/'}${panel.list.path}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { rows: [], error: `HTTP ${response.status}` };
    const json = (await response.json()) as unknown;
    const items = getByPath(json, panel.list.items);
    if (!Array.isArray(items)) return { rows: [], error: `No array at ${panel.list.items}` };
    const rows: Record<string, unknown>[] = [];
    for (const item of items) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const row = item as Record<string, unknown>;
        // Normalize common alternate keys
        if (row.name == null && typeof row.model === 'string') row.name = row.model;
        if (row.size_vram == null && typeof row.size === 'number') row.size_vram = row.size;
        rows.push(row);
      }
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function runHttpAction(
  mount: Mount,
  method: string,
  pathStr: string,
  body: unknown
): Promise<{ ok: boolean; detail: string }> {
  if (!mount.hostUrl?.trim()) return { ok: false, detail: 'No host URL' };
  const base = mount.hostUrl.replace(/\/+$/, '');
  const url = `${base}${pathStr.startsWith('/') ? '' : '/'}${pathStr}`;
  try {
    const response = await fetch(url, {
      method,
      headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}: ${text.slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function runMountAction(
  mountId: string,
  action: 'start' | 'stop' | { panelId: string; actionId: string; row?: Record<string, unknown> }
): Promise<ActionResult> {
  const mount = listMounts().find((m) => m.id === mountId);
  if (!mount) return { status: 'error', message: `Unknown mount: ${mountId}` };

  if (action === 'start') {
    if (!canStartMount(mount) || !mount.start) {
      const message = mount.start?.cwdRequired
        ? 'Error: this mount needs a launch folder before Start.'
        : 'Error: Start command is not configured for this mount.';
      appendCommandLog({
        serviceId: mountId,
        actionId: 'start',
        command: mount.start?.preview ?? mount.start?.command ?? 'start',
        ok: false,
        detail: message,
      });
      return { status: 'error', message };
    }
    const cwd =
      mount.launch.mode === 'path' ? undefined : mount.launch.cwd?.trim() || undefined;
    const preview = mount.start.preview ?? mount.start.command;
    appendCommandLog({
      serviceId: mountId,
      actionId: 'start',
      command: preview,
      ok: true,
      detail: 'starting…',
    });
    const result = await runShellCommand(mount.start.command, cwd);
    appendCommandLog({
      serviceId: mountId,
      actionId: 'start',
      command: result.preview,
      ok: result.ok,
      detail: result.detail,
    });
    return result.ok
      ? { status: 'ok', commands: [result.preview] }
      : { status: 'error', message: result.detail, commands: [result.preview] };
  }

  if (action === 'stop') {
    if (!mount.stop) {
      return { status: 'error', message: 'Stop is not configured for this mount.' };
    }
    if (mount.stop.type === 'shell' && mount.stop.command) {
      const preview = mount.stop.preview ?? mount.stop.command;
      const cwd = mount.launch.cwd?.trim() || undefined;
      appendCommandLog({
        serviceId: mountId,
        actionId: 'stop',
        command: preview,
        ok: true,
        detail: 'stopping…',
      });
      const result = await runShellWait(mount.stop.command, cwd);
      appendCommandLog({
        serviceId: mountId,
        actionId: 'stop',
        command: result.preview,
        ok: result.ok,
        detail: result.detail,
      });
      return result.ok
        ? { status: 'ok', commands: [result.preview] }
        : { status: 'error', message: result.detail, commands: [result.preview] };
    }

    const port = mount.stop.port ?? portFromHostUrl(mount.hostUrl, 8080);
    const hostUrl = mount.hostUrl ?? `http://127.0.0.1:${port}`;
    const cmd = mount.stop.preview ?? `stop-port ${port} (${hostUrl})`;
    appendCommandLog({ serviceId: mountId, actionId: 'stop', command: cmd, ok: true, detail: 'running…' });
    const result = await stopLocalServer({
      hostUrl,
      fallbackPort: port,
      launchDir: mount.launch.cwd,
    });
    const commands = [cmd];
    if (mount.stop.afterShell?.length) {
      for (const shellCmd of mount.stop.afterShell) {
        const r = await runShellWait(shellCmd);
        commands.push(r.preview);
        appendCommandLog({
          serviceId: mountId,
          actionId: 'stop',
          command: r.preview,
          ok: true,
          detail: r.detail,
        });
      }
    }
    appendCommandLog({
      serviceId: mountId,
      actionId: 'stop',
      command: cmd,
      ok: result.status === 'ok',
      detail: result.status === 'error' ? result.message : 'ok',
    });
    return result.status === 'ok'
      ? { status: 'ok', commands }
      : { status: 'error', message: result.message, commands };
  }

  // Panel action
  const panel = mount.panels.find((p) => p.id === action.panelId);
  if (!panel) return { status: 'error', message: `Unknown panel: ${action.panelId}` };
  const panelAction = panel.actions.find((a) => a.id === action.actionId);
  if (!panelAction) return { status: 'error', message: `Unknown panel action: ${action.actionId}` };

  const rows: Record<string, unknown>[] = [];
  if (panelAction.scope === 'panel' && panelAction.foreach === 'row') {
    const data = await fetchPanelData(mount, panel);
    rows.push(...data.rows);
  } else if (panelAction.scope === 'row') {
    if (!action.row) return { status: 'error', message: 'Row action needs a row.' };
    rows.push(action.row);
  } else {
    rows.push({});
  }

  if (panelAction.enabledWhen === 'panelHasRows' && rows.length === 0) {
    return { status: 'error', message: 'Nothing to run — panel has no rows.' };
  }

  const commands: string[] = [];
  for (const row of rows) {
    const body = substituteTemplates(panelAction.body ?? null, row);
    const pathStr = String(substituteTemplates(panelAction.path, row));
    const preview = `${panelAction.method} ${pathStr}`;
    appendCommandLog({
      serviceId: mountId,
      actionId: `${action.panelId}:${action.actionId}`,
      command: preview,
      ok: true,
      detail: 'running…',
    });
    const result = await runHttpAction(mount, panelAction.method, pathStr, body);
    commands.push(preview);
    appendCommandLog({
      serviceId: mountId,
      actionId: `${action.panelId}:${action.actionId}`,
      command: preview,
      ok: result.ok,
      detail: result.detail,
    });
    if (!result.ok) {
      return { status: 'error', message: result.detail, commands };
    }
  }
  return { status: 'ok', commands };
}

/** Suggest a seed template id from a scan fingerprint name (best-effort). */
export function suggestTemplateId(suggestedName: string, port: number): string | null {
  const n = suggestedName.toLowerCase();
  if (n.includes('ollama') || port === 11434) return 'seed-ollama';
  if (n.includes('chatterbox') || port === 8004) return 'seed-chatterbox';
  if (n.includes('comfy') || port === 8188 || port === 8000) return 'seed-comfyui';
  return 'seed-custom';
}
