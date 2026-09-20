import { execFile } from 'node:child_process';
import type { GpuProcess, GpuSnapshot } from '../shared/types';

const PROCESS_NAME_FILTERS = ['ollama', 'chatterbox', 'python_embedded', 'llama-server'];

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

function matchesFilter(processName: string): boolean {
  const lower = processName.toLowerCase();
  return PROCESS_NAME_FILTERS.some((token) => lower.includes(token));
}

function parseNumber(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
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

    let processes: GpuProcess[] = [];
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
        const procName = cols[1] ?? '';
        if (pid == null || !procName) continue;
        if (!matchesFilter(procName)) continue;
        processes.push({
          pid,
          name: procName,
          memoryMiB: cols[2] != null ? parseNumber(cols[2]) : null,
        });
      }
    } catch {
      // compute-apps query can fail when nothing is running
    }

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
