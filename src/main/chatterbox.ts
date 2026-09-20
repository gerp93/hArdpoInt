import * as fs from 'fs';
import * as path from 'path';
import { getChatterboxLaunchDir, getEffectiveChatterboxHost } from './config';

const REACH_TIMEOUT_MS = 2_500;

function host(): string {
  return getEffectiveChatterboxHost().replace(/\/+$/, '');
}

export async function isReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${host()}/`, { method: 'GET', signal: AbortSignal.timeout(REACH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reads device from Chatterbox config.yaml when a launch folder is configured. */
export function readDeviceHint(launchDir: string | null): string | null {
  if (!launchDir) return null;
  const configPath = path.join(launchDir, 'config.yaml');
  if (!fs.existsSync(configPath)) return null;
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const match = text.match(/^\s*device\s*:\s*(\S+)/im);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function getChatterboxHostForStatus(): string {
  return host();
}

export function getChatterboxLaunchDirForStatus(): string | null {
  return getChatterboxLaunchDir();
}
