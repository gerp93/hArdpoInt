import type { LoadedModel } from '../shared/types';
import { getEffectiveOllamaHost } from './config';

const REACH_TIMEOUT_MS = 2_500;
const REQUEST_TIMEOUT_MS = 30_000;

function host(): string {
  return getEffectiveOllamaHost().replace(/\/+$/, '');
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(`${host()}${path}`, { ...init, signal });
}

export async function isReachable(): Promise<boolean> {
  try {
    const response = await request('/api/tags', { method: 'GET' }, REACH_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

interface PsModel {
  name?: string;
  model?: string;
  size?: number;
  size_vram?: number;
  processor?: string;
  expires_at?: string;
}

export async function listLoaded(): Promise<LoadedModel[]> {
  try {
    const response = await request('/api/ps', { method: 'GET' }, REQUEST_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: PsModel[] };
    return (data.models ?? [])
      .map((m) => ({
        name: m.name ?? m.model ?? '',
        sizeVram: m.size_vram ?? m.size ?? null,
        processor: m.processor ?? null,
        expiresAt: m.expires_at ?? null,
      }))
      .filter((m) => m.name);
  } catch {
    return [];
  }
}

export async function unloadModel(tag: string): Promise<void> {
  try {
    await request(
      '/api/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: tag, prompt: '', keep_alive: 0 }),
      },
      REQUEST_TIMEOUT_MS
    );
  } catch {
    // best-effort
  }
}

export async function unloadAll(): Promise<void> {
  const loaded = await listLoaded();
  await Promise.all(loaded.map((m) => unloadModel(m.name)));
}

export function getOllamaHostForStatus(): string {
  return host();
}
