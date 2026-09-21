import { execFile } from 'node:child_process';
import * as os from 'os';
import type { CpuSnapshot } from '../shared/types';

function run(file: string, args: string[], timeoutMs = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(typeof stdout === 'string' ? stdout : String(stdout));
      }
    );
  });
}

function parseNumber(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

export async function getCpuSnapshot(): Promise<CpuSnapshot> {
  const memoryTotalMiB = Math.round(os.totalmem() / (1024 * 1024));
  const memoryUsedMiB = Math.round((os.totalmem() - os.freemem()) / (1024 * 1024));

  if (process.platform === 'win32') {
    try {
      const nameOut = await run('wmic', ['cpu', 'get', 'Name', '/value']);
      const loadOut = await run('wmic', ['cpu', 'get', 'LoadPercentage', '/value']);
      const nameMatch = nameOut.match(/Name=(.+)/i);
      const loadMatch = loadOut.match(/LoadPercentage=(\d+)/i);
      return {
        available: true,
        name: nameMatch?.[1]?.trim() || os.cpus()[0]?.model || null,
        utilizationPercent: loadMatch ? parseNumber(loadMatch[1]) : null,
        memoryUsedMiB,
        memoryTotalMiB,
      };
    } catch {
      // fall through
    }
  }

  const cpus = os.cpus();
  let utilizationPercent: number | null = null;
  if (cpus.length > 0) {
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }
    if (total > 0) utilizationPercent = Math.round(100 * (1 - idle / total));
  }

  return {
    available: true,
    name: cpus[0]?.model ?? null,
    utilizationPercent,
    memoryUsedMiB,
    memoryTotalMiB,
  };
}
