import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ActionResult, ManagedService, ServiceAction } from '../shared/types';
import { appendCommandLog } from './commandLog';
import { readConfig, writeConfig, getOllamaLaunchDir, getChatterboxLaunchDir } from './config';
import { stopLocalServer } from './localServerProcess';
import {
  startOllama,
  stopOllama,
  startChatterbox,
  stopChatterbox,
  resolveOllamaLaunchDir,
} from './launch';
import { getEffectiveOllamaHost, getEffectiveChatterboxHost } from './config';

const BUILTIN_PREVIEWS: Record<string, string> = {
  'ollama-start': 'shell.openPath(<ollama.exe>)  OR  ollama serve',
  'ollama-stop':
    'taskkill listeners on :11434 + Ollama.exe tray (Windows respawns llama-server otherwise)',
  'chatterbox-start':
    'cmd /c start … python_embedded\\python.exe start.py --portable --nvidia-cu128 --verbose',
  'chatterbox-stop': 'taskkill listeners on Chatterbox port + processes under install folder',
};

function defaultServices(): ManagedService[] {
  const ollamaDir = getOllamaLaunchDir() ?? resolveOllamaLaunchDir();
  const chatterDir = getChatterboxLaunchDir();
  return [
    {
      id: 'ollama',
      name: 'Ollama',
      kind: 'ollama',
      hostUrl: getEffectiveOllamaHost(),
      workingDir: ollamaDir,
      actions: [
        {
          id: 'start',
          label: 'Start',
          commandPreview: BUILTIN_PREVIEWS['ollama-start'],
          runner: { type: 'builtin', builtin: 'ollama-start' },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: BUILTIN_PREVIEWS['ollama-stop'],
          runner: { type: 'builtin', builtin: 'ollama-stop' },
        },
      ],
    },
    {
      id: 'chatterbox',
      name: 'Chatterbox',
      kind: 'chatterbox',
      hostUrl: getEffectiveChatterboxHost(),
      workingDir: chatterDir,
      actions: [
        {
          id: 'start',
          label: 'Start',
          commandPreview: BUILTIN_PREVIEWS['chatterbox-start'],
          runner: { type: 'builtin', builtin: 'chatterbox-start' },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: BUILTIN_PREVIEWS['chatterbox-stop'],
          runner: { type: 'builtin', builtin: 'chatterbox-stop' },
        },
      ],
    },
    {
      id: 'comfyui',
      name: 'ComfyUI',
      kind: 'generic',
      hostUrl: 'http://localhost:8000',
      workingDir: null,
      actions: [
        {
          id: 'start',
          label: 'Start',
          commandPreview: '(set working dir + start command in Edit)',
          runner: {
            type: 'shell',
            command: 'echo Set a Start command for ComfyUI in Hardpoint service settings',
          },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: 'taskkill processes listening on TCP 8000',
          runner: { type: 'stop-port', port: 8000 },
        },
      ],
    },
  ];
}

function mergeWorkingDirs(services: ManagedService[]): ManagedService[] {
  return services.map((s) => {
    if (s.id === 'ollama') {
      return {
        ...s,
        workingDir: getOllamaLaunchDir() ?? resolveOllamaLaunchDir() ?? s.workingDir,
        hostUrl: getEffectiveOllamaHost(),
      };
    }
    if (s.id === 'chatterbox') {
      return {
        ...s,
        workingDir: getChatterboxLaunchDir() ?? s.workingDir,
        hostUrl: getEffectiveChatterboxHost(),
      };
    }
    return s;
  });
}

export function listManagedServices(): ManagedService[] {
  const stored = readConfig().services;
  if (!stored || stored.length === 0) {
    const seeded = defaultServices();
    writeConfig({ ...readConfig(), services: seeded });
    return mergeWorkingDirs(seeded);
  }
  return mergeWorkingDirs(stored);
}

export function saveManagedService(
  service: ManagedService
): { status: 'ok' } | { status: 'error'; message: string } {
  const id = service.id?.trim();
  if (!id) return { status: 'error', message: 'Service id is required.' };
  if (!service.name?.trim()) return { status: 'error', message: 'Service name is required.' };
  const services = listManagedServices().filter((s) => s.id !== id);
  services.push({ ...service, id, name: service.name.trim() });
  writeConfig({ ...readConfig(), services });
  return { status: 'ok' };
}

export function deleteManagedService(
  serviceId: string
): { status: 'ok' } | { status: 'error'; message: string } {
  const id = serviceId.trim();
  if (id === 'ollama' || id === 'chatterbox') {
    return { status: 'error', message: 'Built-in Ollama/Chatterbox cards cannot be deleted (edit actions instead).' };
  }
  const services = listManagedServices().filter((s) => s.id !== id);
  writeConfig({ ...readConfig(), services });
  return { status: 'ok' };
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
      child.on('close', (code) => {
        resolve(out.trim() || `exit ${code ?? '?'}`);
      });
    });
    const ok = !/^exit [1-9]/.test(detail) && !/ENOENT|not recognized/i.test(detail);
    return { ok, detail, preview };
  }

  const detail = await new Promise<string>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
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

/** Kill Windows Ollama tray so it cannot respawn llama-server after we free the port. */
export async function forceStopOllamaWindows(): Promise<string[]> {
  const commands: string[] = [];
  if (process.platform !== 'win32') return commands;

  const images = ['Ollama.exe', 'ollama app.exe', 'ollama.exe', 'llama-server.exe'];
  for (const image of images) {
    const cmd = `taskkill /IM "${image}" /T /F`;
    commands.push(cmd);
    const detail = await runIgnore('taskkill', ['/IM', image, '/T', '/F']);
    appendCommandLog({
      serviceId: 'ollama',
      actionId: 'stop',
      command: cmd,
      ok: !/ERROR:/i.test(detail) || /not found/i.test(detail),
      detail,
    });
  }
  return commands;
}

async function runBuiltin(
  builtin: string,
  serviceId: string,
  actionId: string
): Promise<ActionResult> {
  if (builtin === 'ollama-start') {
    const preview = BUILTIN_PREVIEWS['ollama-start'];
    appendCommandLog({ serviceId, actionId, command: preview, ok: true, detail: 'starting…' });
    const result = await startOllama();
    appendCommandLog({
      serviceId,
      actionId,
      command: preview,
      ok: result.status === 'ok',
      detail: result.status === 'error' ? result.message : 'started (or already up)',
    });
    return result;
  }
  if (builtin === 'ollama-stop') {
    const commands: string[] = [];
    const hostUrl = getEffectiveOllamaHost();
    const portCmd = `stopLocalServer port listeners for ${hostUrl} + install tree`;
    commands.push(portCmd);
    appendCommandLog({ serviceId, actionId, command: portCmd, ok: true, detail: 'running…' });
    const portResult = await stopOllama();
    commands.push(...(await forceStopOllamaWindows()));
    // Re-check after tray kill
    await new Promise((r) => setTimeout(r, 1000));
    const { isReachable } = await import('./ollama');
    if (await isReachable()) {
      const msg = 'Ollama is still reachable — tray may have respawned. Check system tray.';
      appendCommandLog({ serviceId, actionId, command: 'verify reachable', ok: false, detail: msg });
      return { status: 'error', message: msg, commands };
    }
    appendCommandLog({
      serviceId,
      actionId,
      command: 'verify reachable',
      ok: true,
      detail: portResult.status === 'error' ? portResult.message : 'down',
    });
    return { status: 'ok', commands };
  }
  if (builtin === 'chatterbox-start') {
    const preview = BUILTIN_PREVIEWS['chatterbox-start'];
    appendCommandLog({ serviceId, actionId, command: preview, ok: true, detail: 'starting…' });
    const result = await startChatterbox();
    appendCommandLog({
      serviceId,
      actionId,
      command: preview,
      ok: result.status === 'ok',
      detail: result.status === 'error' ? result.message : 'started',
    });
    return result;
  }
  if (builtin === 'chatterbox-stop') {
    const preview = BUILTIN_PREVIEWS['chatterbox-stop'];
    appendCommandLog({ serviceId, actionId, command: preview, ok: true, detail: 'stopping…' });
    const result = await stopChatterbox();
    appendCommandLog({
      serviceId,
      actionId,
      command: preview,
      ok: result.status === 'ok',
      detail: result.status === 'error' ? result.message : 'stopped',
    });
    return result;
  }
  return { status: 'error', message: `Unknown builtin: ${builtin}` };
}

export async function runServiceAction(serviceId: string, actionId: string): Promise<ActionResult> {
  const service = listManagedServices().find((s) => s.id === serviceId);
  if (!service) return { status: 'error', message: `Unknown service: ${serviceId}` };
  const action = service.actions.find((a) => a.id === actionId);
  if (!action) return { status: 'error', message: `Unknown action: ${actionId}` };

  const runner = action.runner;
  if (runner.type === 'builtin') {
    return runBuiltin(runner.builtin, serviceId, actionId);
  }

  if (runner.type === 'shell') {
    const cwd = runner.cwd ?? service.workingDir ?? undefined;
    const result = await runShellCommand(runner.command, cwd ?? undefined);
    appendCommandLog({
      serviceId,
      actionId,
      command: result.preview,
      ok: result.ok,
      detail: result.detail,
    });
    return result.ok
      ? { status: 'ok', commands: [result.preview] }
      : { status: 'error', message: result.detail, commands: [result.preview] };
  }

  if (runner.type === 'stop-port') {
    const hostUrl = service.hostUrl ?? `http://127.0.0.1:${runner.port}`;
    const cmd = `stop-port ${runner.port} (${hostUrl})`;
    appendCommandLog({ serviceId, actionId, command: cmd, ok: true, detail: 'running…' });
    const result = await stopLocalServer({
      hostUrl,
      fallbackPort: runner.port,
      launchDir: runner.launchDir ?? service.workingDir,
    });
    appendCommandLog({
      serviceId,
      actionId,
      command: cmd,
      ok: result.status === 'ok',
      detail: result.status === 'error' ? result.message : 'ok',
    });
    return result.status === 'ok'
      ? { status: 'ok', commands: [cmd] }
      : { status: 'error', message: result.message, commands: [cmd] };
  }

  return { status: 'error', message: 'Unsupported runner' };
}

export function actionPreview(action: ServiceAction): string {
  return action.commandPreview || JSON.stringify(action.runner);
}
