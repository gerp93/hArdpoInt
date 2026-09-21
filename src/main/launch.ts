import { spawn } from 'node:child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow, dialog, shell } from 'electron';
import {
  clearChatterboxLaunchDir,
  clearOllamaLaunchDir,
  getChatterboxLaunchDir,
  getEffectiveChatterboxHost,
  getEffectiveOllamaHost,
  getOllamaLaunchDir,
  setChatterboxLaunchDir,
  setOllamaLaunchDir,
} from './config';
import { isReachable as isChatterboxReachable } from './chatterbox';
import { isReachable as isOllamaReachable } from './ollama';
import { stopLocalServer } from './localServerProcess';

let ollamaLaunchedThisSession = false;
let chatterboxLaunchedThisSession = false;

const WINDOWS_START_ARGS = ['--portable', '--nvidia-cu128', '--verbose'] as const;

function ollamaBinaryName(): string {
  return process.platform === 'win32' ? 'ollama.exe' : 'ollama';
}

/** Resolve a bare command name via PATH (`where` / `which`). */
export function findExecutableOnPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const checker = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(checker, [command], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const first = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      resolve(first ?? null);
    });
  });
}

function binaryInDir(dir: string): string | null {
  const binary = path.join(dir, ollamaBinaryName());
  if (!fs.existsSync(binary)) return null;
  try {
    if (!fs.statSync(binary).isFile()) return null;
  } catch {
    return null;
  }
  return binary;
}

export function detectDefaultOllamaLaunchDir(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (local) candidates.push(path.join(local, 'Programs', 'Ollama'));
    const pf = process.env.ProgramFiles;
    if (pf) candidates.push(path.join(pf, 'Ollama'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Ollama.app/Contents/Resources');
    candidates.push('/usr/local/bin');
  } else {
    candidates.push('/usr/local/bin');
    candidates.push('/usr/bin');
  }
  for (const dir of candidates) {
    try {
      if (binaryInDir(dir)) return path.resolve(dir);
    } catch {
      // try next
    }
  }
  return null;
}

export function resolveOllamaLaunchDir(): string | null {
  return getOllamaLaunchDir() ?? detectDefaultOllamaLaunchDir();
}

export function assertOllamaLaunchDir(dir: string): string {
  const trimmed = dir.trim();
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) throw new Error('Ollama folder must be an absolute path.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("That folder isn't on this computer.");
  }
  if (!binaryInDir(resolved)) {
    throw new Error(`That folder doesn't look like an Ollama install (no ${ollamaBinaryName()}).`);
  }
  return resolved;
}

export async function startOllamaFromDir(
  dir: string
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (ollamaLaunchedThisSession) return { status: 'ok' };
  try {
    const resolved = assertOllamaLaunchDir(dir);
    const binary = binaryInDir(resolved);
    if (!binary) {
      return {
        status: 'error',
        message: `That folder doesn't look like an Ollama install (no ${ollamaBinaryName()}).`,
      };
    }
    ollamaLaunchedThisSession = true;
    if (process.platform === 'win32') {
      const err = await shell.openPath(binary);
      if (err) {
        ollamaLaunchedThisSession = false;
        return { status: 'error', message: err };
      }
      return { status: 'ok' };
    }
    const child = spawn(binary, ['serve'], {
      cwd: resolved,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => {
      ollamaLaunchedThisSession = false;
    });
    child.unref();
    return { status: 'ok' };
  } catch (error) {
    ollamaLaunchedThisSession = false;
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

async function startOllamaFromPath(
  binary: string
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (ollamaLaunchedThisSession) return { status: 'ok' };
  ollamaLaunchedThisSession = true;
  try {
    if (process.platform === 'win32') {
      // Prefer openPath for the tray app when where points at ollama.exe in Programs.
      const err = await shell.openPath(binary);
      if (!err) return { status: 'ok' };
      // Fall through to `ollama serve` if openPath fails (shim / console binary).
    }
    const child = spawn(binary, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    child.on('error', () => {
      ollamaLaunchedThisSession = false;
    });
    child.unref();
    return { status: 'ok' };
  } catch (error) {
    ollamaLaunchedThisSession = false;
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function startOllama(
  options?: { preferPath?: boolean }
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (!options?.preferPath) {
    const dir = resolveOllamaLaunchDir();
    if (dir) {
      if (!getOllamaLaunchDir()) setOllamaLaunchDir(dir);
      return startOllamaFromDir(dir);
    }
  }
  const onPath =
    (await findExecutableOnPath(ollamaBinaryName())) ??
    (await findExecutableOnPath('ollama'));
  if (onPath) return startOllamaFromPath(onPath);
  return {
    status: 'error',
    message:
      'Ollama not found. Choose an install folder, or install so `ollama` is on your PATH.',
  };
}

export async function stopOllama(): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const commands: string[] = [];
  if (!(await isOllamaReachable())) {
    ollamaLaunchedThisSession = false;
    // Still try to kill tray — user may have clicked Stop while it was mid-restart.
  } else {
    const hostUrl = getEffectiveOllamaHost();
    const result = await stopLocalServer({
      hostUrl,
      fallbackPort: Number(new URL(hostUrl).port) || 11434,
      launchDir: resolveOllamaLaunchDir(),
    });
    commands.push(`stopLocalServer(${hostUrl})`);
    if (result.status === 'error') {
      // continue to tray kill anyway
    }
  }

  if (process.platform === 'win32') {
    const { forceStopOllamaWindows } = await import('./services');
    commands.push(...(await forceStopOllamaWindows()));
  }

  ollamaLaunchedThisSession = false;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (await isOllamaReachable()) {
    return {
      status: 'error',
      message:
        'Ollama is still reachable. On Windows the tray app often respawns the server — quit Ollama from the system tray, or run Stop again.',
    };
  }
  return { status: 'ok' };
}

export async function chooseOllamaLaunchDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the Ollama folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  try {
    const dir = assertOllamaLaunchDir(result.filePaths[0]);
    setOllamaLaunchDir(dir);
    return { status: 'ok', dir };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** Generic install-folder picker (no Ollama/Chatterbox layout checks). */
export async function chooseServiceLaunchDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose service install folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  return { status: 'ok', dir: result.filePaths[0] };
}

function launcherInDir(dir: string): string | null {
  const bat = path.join(dir, 'start.bat');
  const py = path.join(dir, 'start.py');
  if (process.platform === 'win32' && fs.existsSync(bat)) return bat;
  if (fs.existsSync(py)) return py;
  if (fs.existsSync(bat)) return bat;
  return null;
}

function embeddedPython(dir: string): string | null {
  const exe = path.join(dir, 'python_embedded', process.platform === 'win32' ? 'python.exe' : 'python');
  return fs.existsSync(exe) ? exe : null;
}

export function assertChatterboxLaunchDir(dir: string): string {
  const trimmed = dir.trim();
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) throw new Error('Chatterbox folder must be an absolute path.');
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("That folder isn't on this computer.");
  }
  if (!launcherInDir(resolved)) {
    throw new Error("That folder doesn't look like Chatterbox TTS Server (no start.bat or start.py).");
  }
  return resolved;
}

function spawnDetached(command: string, args: string[], cwd: string): void {
  const child = spawn(command, args, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.on('error', () => {
    chatterboxLaunchedThisSession = false;
  });
  child.unref();
}

async function launchChatterbox(resolved: string): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const py = path.join(resolved, 'start.py');
  if (!fs.existsSync(py)) {
    return { status: 'error', message: "That folder doesn't look like Chatterbox TTS Server." };
  }

  if (process.platform === 'win32') {
    const embedded = embeddedPython(resolved);
    spawnDetached(
      'cmd.exe',
      [
        '/c',
        'start',
        'Chatterbox TTS',
        '/D',
        resolved,
        ...(embedded
          ? [embedded, 'start.py', ...WINDOWS_START_ARGS]
          : [path.join(resolved, 'start.bat'), ...WINDOWS_START_ARGS]),
      ],
      resolved
    );
    return { status: 'ok' };
  }

  spawnDetached('python', ['start.py', '--verbose'], resolved);
  return { status: 'ok' };
}

export async function startChatterboxFromDir(
  dir: string
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (chatterboxLaunchedThisSession) return { status: 'ok' };
  try {
    const resolved = assertChatterboxLaunchDir(dir);
    chatterboxLaunchedThisSession = true;
    const result = await launchChatterbox(resolved);
    if (result.status === 'error') chatterboxLaunchedThisSession = false;
    return result;
  } catch (error) {
    chatterboxLaunchedThisSession = false;
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function startChatterbox(): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  const dir = getChatterboxLaunchDir();
  if (!dir) {
    return { status: 'error', message: 'Choose a Chatterbox install folder first.' };
  }
  return startChatterboxFromDir(dir);
}

export async function stopChatterbox(): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  if (!(await isChatterboxReachable())) {
    chatterboxLaunchedThisSession = false;
    return { status: 'ok' };
  }
  const hostUrl = getEffectiveChatterboxHost();
  const result = await stopLocalServer({
    hostUrl,
    fallbackPort: Number(new URL(hostUrl).port) || 8004,
    launchDir: getChatterboxLaunchDir(),
  });
  chatterboxLaunchedThisSession = false;
  if (result.status === 'error') return result;
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (await isChatterboxReachable()) {
    return { status: 'error', message: 'Chatterbox is still running.' };
  }
  return { status: 'ok' };
}

export async function chooseChatterboxLaunchDir(
  window: BrowserWindow | null
): Promise<{ status: 'ok'; dir: string } | { status: 'cancelled' } | { status: 'error'; message: string }> {
  if (!window) return { status: 'error', message: 'No window to show the folder picker.' };
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose the Chatterbox TTS Server folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  try {
    const dir = assertChatterboxLaunchDir(result.filePaths[0]);
    setChatterboxLaunchDir(dir);
    return { status: 'ok', dir };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export function forgetOllamaLaunchDir(): void {
  clearOllamaLaunchDir();
}

export function forgetChatterboxLaunchDir(): void {
  clearChatterboxLaunchDir();
}
