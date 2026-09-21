import { execFile } from 'node:child_process';
import type { ActionResult, GpuProcess, GpuSnapshot } from '../shared/types';
import { appendCommandLog } from './commandLog';
import { killProcessByPid } from './localServerProcess';

function run(file: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(typeof stdout === 'string' ? stdout : String(stdout));
      }
    );
  });
}

function emptySnapshot(): GpuSnapshot {
  return {
    available: false,
    name: null,
    memoryUsedMiB: null,
    memoryTotalMiB: null,
    utilizationGpu: null,
    temperatureC: null,
    processes: [],
  };
}

function parseNumber(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/** Basename for display; keep full path in name for clarity when useful. */
function displayProcessName(raw: string): string {
  const trimmed = raw.trim().replace(/\u0000/g, '');
  if (!trimmed) return trimmed;
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

function parseProcessType(raw: string): GpuProcess['type'] {
  const t = raw.trim().toUpperCase();
  if (t === 'C' || t === 'G' || t === 'C+G') return t;
  return null;
}

/**
 * Desktop / overlay clients that hold a WDDM GPU context for compositing
 * without meaningfully driving utilization. Matched against basename.
 */
const UI_NAME_RE =
  /^(explorer|dwm|sihost|shellexperiencehost|shellhost|searchhost|startmenuexperiencehost|textinputhost|applicationframehost|systemsettings|lockapp|crossdeviceresume|searchapp|widgetservice|widgets|gamebar|gamingservices|msedgewebview2|microsoft\.cmdpal\.ui|powertoys[\w.]*|logi[\w.]*|lghub[\w.]*|streamdeck|lgmonitorappmanager|nvidia[\w.]*|nvcontainer|nvdisplay|securityhealthsystray|taskmgr|chnotificationux|phoneexperiencehost)\.exe$/i;

/**
 * Names that usually mean real GPU work even when WDDM hides VRAM/SM stats.
 */
const ACTIVE_NAME_RE =
  /^(ollama[\w.]*|llama[\w.]*|python[\w.]*|pythonw|comfyui[\w.]*|ffmpeg|handbrake|obs[\w.]*|blender|davinci|unity|unreal|nvenc|cuda[\w.]*)/i;

const ACTIVE_MEMORY_MIB = 64;

function classifyProcess(input: {
  name: string;
  type: GpuProcess['type'];
  memoryMiB: number | null;
  smPercent: number | null;
}): GpuProcess['kind'] {
  if (input.smPercent != null && input.smPercent > 0) return 'active';
  if (input.memoryMiB != null && input.memoryMiB >= ACTIVE_MEMORY_MIB) return 'active';
  if (input.type === 'C') return 'active';

  const base = displayProcessName(input.name);
  if (ACTIVE_NAME_RE.test(base)) return 'active';
  if (UI_NAME_RE.test(base)) return 'ui';

  // Browsers / Electron shells: UI unless they already tripped memory/SM above.
  if (
    /^(chrome|msedge|opera|firefox|brave|cursor|code|hardpoint|roleplaymate|kvgenius|discord|slack|spotify|steam|epicgameslauncher)\.exe$/i.test(
      base
    )
  ) {
    return 'ui';
  }

  // Unknown C+G / G with no stats → UI noise on Windows; unknown bare C already handled.
  if (input.type === 'G' || input.type === 'C+G') return 'ui';

  // Unknown with no type: keep on Active so we don't hide a surprise consumer.
  return 'active';
}

interface PmonRow {
  pid: number;
  type: GpuProcess['type'];
  smPercent: number | null;
  name: string;
}

/** One sample of nvidia-smi pmon (type + SM% when the driver exposes it). */
async function readPmonRows(): Promise<Map<number, PmonRow>> {
  const map = new Map<number, PmonRow>();
  try {
    const out = await run('nvidia-smi', ['pmon', '-c', '1']);
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // gpu pid type sm mem enc dec [jpg ofa] command…
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;
      const pid = parseNumber(parts[1] ?? '');
      if (pid == null) continue;
      const type = parseProcessType(parts[2] ?? '');
      const smRaw = parts[3] ?? '-';
      const smPercent = smRaw === '-' ? null : parseNumber(smRaw);
      // Older pmon: gpu pid type sm mem enc dec command
      // Newer:      gpu pid type sm mem enc dec jpg ofa command
      const nameStart = parts.length >= 10 ? 9 : 7;
      const name = displayProcessName(parts.slice(nameStart).join(' ') || 'unknown');
      map.set(pid, { pid, type, smPercent, name });
    }
  } catch {
    // pmon unavailable — fall back to compute-apps only
  }
  return map;
}

export async function getGpuSnapshot(): Promise<GpuSnapshot> {
  try {
    const gpuCsv = await run('nvidia-smi', [
      '--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu',
      '--format=csv,noheader,nounits',
    ]);
    const firstLine = gpuCsv.split(/\r?\n/).find((line) => line.trim())?.trim();
    if (!firstLine) return emptySnapshot();

    const parts = firstLine.split(',').map((p) => p.trim());
    const name = parts[0] ?? null;
    const memoryUsedMiB = parts[1] != null ? parseNumber(parts[1]) : null;
    const memoryTotalMiB = parts[2] != null ? parseNumber(parts[2]) : null;
    const utilizationGpu = parts[3] != null ? parseNumber(parts[3]) : null;
    const temperatureC = parts[4] != null ? parseNumber(parts[4]) : null;

    const pmonByPid = await readPmonRows();
    const byPid = new Map<number, GpuProcess>();

    // Seed from pmon (has type / SM%).
    for (const row of pmonByPid.values()) {
      const kind = classifyProcess({
        name: row.name,
        type: row.type,
        memoryMiB: null,
        smPercent: row.smPercent,
      });
      byPid.set(row.pid, {
        pid: row.pid,
        name: row.name,
        memoryMiB: null,
        type: row.type,
        smPercent: row.smPercent,
        kind,
      });
    }

    // Merge compute-apps for VRAM when the driver reports it (Linux / TCC).
    try {
      const procCsv = await run('nvidia-smi', [
        '--query-compute-apps=pid,process_name,used_gpu_memory',
        '--format=csv,noheader,nounits',
      ]);
      for (const line of procCsv.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const cols = trimmed.split(',').map((p) => p.trim());
        const pid = parseNumber(cols[0] ?? '');
        const procName = displayProcessName(cols[1] ?? '');
        if (pid == null || !procName) continue;
        const memoryRaw = cols[2] ?? '';
        const memoryMiB =
          memoryRaw && memoryRaw !== '[N/A]' && memoryRaw.toUpperCase() !== 'N/A'
            ? parseNumber(memoryRaw)
            : null;

        const existing = byPid.get(pid);
        if (existing) {
          existing.memoryMiB = memoryMiB ?? existing.memoryMiB;
          if (!existing.name || existing.name === '[Insufficient Permissions]') {
            existing.name = procName;
          }
          existing.kind = classifyProcess({
            name: existing.name,
            type: existing.type,
            memoryMiB: existing.memoryMiB,
            smPercent: existing.smPercent,
          });
        } else {
          const type = null;
          const smPercent = null;
          byPid.set(pid, {
            pid,
            name: procName,
            memoryMiB,
            type,
            smPercent,
            kind: classifyProcess({ name: procName, type, memoryMiB, smPercent }),
          });
        }
      }
    } catch {
      // compute-apps query can fail when nothing is running
    }

    const processes = [...byPid.values()].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'active' ? -1 : 1;
      return (b.memoryMiB ?? 0) - (a.memoryMiB ?? 0) || a.name.localeCompare(b.name);
    });

    return {
      available: true,
      name,
      memoryUsedMiB,
      memoryTotalMiB,
      utilizationGpu,
      temperatureC,
      processes,
    };
  } catch {
    return emptySnapshot();
  }
}

function isInsufficientPermissionsName(name: string): boolean {
  return /insufficient\s+permissions/i.test(name);
}

/**
 * Kill a process listed under Active / compute. Refuses UI-tab processes,
 * Hardpoint itself, and nvidia-smi "[Insufficient Permissions]" rows (no
 * usable handle / name — killing by PID alone would be a blind shot).
 */
export async function killActiveGpuProcess(pid: number): Promise<ActionResult> {
  const snapshot = await getGpuSnapshot();
  const target = snapshot.processes.find((p) => p.pid === pid);
  const cmd = `taskkill /PID ${pid} /T /F`;

  if (!target) {
    const message = `PID ${pid} is not on the current GPU process list.`;
    appendCommandLog({ command: cmd, ok: false, detail: message });
    return { status: 'error', message, commands: [cmd] };
  }
  if (target.kind !== 'active') {
    const message = 'Kill is only offered on Active / compute processes.';
    appendCommandLog({ command: cmd, ok: false, detail: message });
    return { status: 'error', message, commands: [cmd] };
  }
  if (isInsufficientPermissionsName(target.name)) {
    const message = 'Cannot kill processes nvidia-smi reports as [Insufficient Permissions].';
    appendCommandLog({ command: cmd, ok: false, detail: message });
    return { status: 'error', message, commands: [cmd] };
  }

  appendCommandLog({
    command: cmd,
    ok: true,
    detail: `killing ${target.name} (PID ${pid})…`,
  });
  const result = await killProcessByPid(pid);
  appendCommandLog({
    command: cmd,
    ok: result.status === 'ok',
    detail:
      result.status === 'ok'
        ? `killed ${target.name} (PID ${pid})`
        : result.message,
  });
  return result.status === 'ok'
    ? { status: 'ok', commands: [cmd] }
    : { status: 'error', message: result.message, commands: [cmd] };
}
