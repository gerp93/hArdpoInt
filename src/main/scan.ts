import * as net from 'node:net';
import { SERVICE_PRESETS, scanPortList, type ServicePreset } from '../shared/presets';
import type { ScanHit } from '../shared/types';

function tcpOpen(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function httpSnippet(
  port: number,
  path: string
): Promise<{ status: number; body: string; server: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_200);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });
    const body = (await response.text()).slice(0, 4_000);
    return {
      status: response.status,
      body,
      server: response.headers.get('server') ?? '',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function matchPreset(
  port: number,
  sample: { status: number; body: string; server: string } | null
): { preset: ServicePreset; confidence: 'high' | 'medium' | 'low' } | null {
  const byPort = SERVICE_PRESETS.filter((p) => p.defaultPort === port || (p.id === 'comfyui' && port === 8000));
  if (sample) {
    const blob = `${sample.server}\n${sample.body}`;
    for (const preset of SERVICE_PRESETS) {
      if (preset.fingerprint?.test(blob)) {
        return { preset, confidence: 'high' };
      }
    }
  }
  if (byPort.length === 1) {
    return { preset: byPort[0], confidence: sample ? 'medium' : 'low' };
  }
  if (byPort.length > 1 && sample) {
    for (const preset of byPort) {
      if (preset.fingerprint?.test(`${sample.server}\n${sample.body}`)) {
        return { preset, confidence: 'high' };
      }
    }
    return { preset: byPort[0], confidence: 'low' };
  }
  return null;
}

async function probePort(port: number): Promise<ScanHit | null> {
  const open = await tcpOpen(port);
  if (!open) return null;

  const candidates = SERVICE_PRESETS.filter(
    (p) => p.defaultPort === port || (p.id === 'comfyui' && (port === 8000 || port === 8188))
  );
  const paths = new Set<string>(['/']);
  for (const c of candidates) {
    for (const path of c.probePaths) paths.add(path);
  }
  // Always try a few generic API paths
  paths.add('/api/tags');
  paths.add('/system_stats');
  paths.add('/docs');

  let sample: { status: number; body: string; server: string } | null = null;
  for (const path of paths) {
    sample = await httpSnippet(port, path);
    if (sample && (sample.status < 500 || sample.body.length > 0)) break;
  }

  const matched = matchPreset(port, sample);
  const hostUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    hostUrl,
    open: true,
    httpStatus: sample?.status ?? null,
    suggestedPresetId: matched?.preset.id ?? null,
    suggestedName: matched?.preset.name ?? `Port ${port}`,
    confidence: matched?.confidence ?? 'low',
    detail: sample
      ? `HTTP ${sample.status}${sample.server ? ` (${sample.server})` : ''}`
      : 'TCP open (no HTTP response)',
  };
}

/** Probe known local AI / tool ports on 127.0.0.1. Does not mutate config. */
export async function scanLocalhostServices(): Promise<ScanHit[]> {
  const ports = scanPortList();
  const hits: ScanHit[] = [];
  // Parallel but capped — avoid opening dozens of sockets at once.
  const concurrency = 8;
  for (let i = 0; i < ports.length; i += concurrency) {
    const chunk = ports.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((port) => probePort(port)));
    for (const hit of results) {
      if (hit) hits.push(hit);
    }
  }
  return hits.sort((a, b) => a.port - b.port);
}
