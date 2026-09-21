import type { DashboardStatus } from '../shared/types';
import {
  getChatterboxHostForStatus,
  getChatterboxLaunchDirForStatus,
  isReachable as isChatterboxReachable,
  readDeviceHint,
} from './chatterbox';
import { getCommandLog } from './commandLog';
import { getCpuSnapshot } from './cpu';
import { getGpuSnapshot } from './gpu';
import { resolveOllamaLaunchDir } from './launch';
import {
  getOllamaHostForStatus,
  isReachable as isOllamaReachable,
  listLoaded,
} from './ollama';
import { listManagedServices } from './services';

async function probeHost(hostUrl: string | null): Promise<boolean | null> {
  if (!hostUrl?.trim()) return null;
  const base = hostUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(base, { method: 'GET', signal: AbortSignal.timeout(2_000) });
    // Many local UIs return 404 on / but are still up.
    return response.ok || (response.status >= 400 && response.status < 500);
  } catch {
    return false;
  }
}

export async function buildDashboardStatus(): Promise<DashboardStatus> {
  const services = listManagedServices();
  const [gpu, cpu, ollamaReachable, chatterboxReachable] = await Promise.all([
    getGpuSnapshot(),
    getCpuSnapshot(),
    isOllamaReachable(),
    isChatterboxReachable(),
  ]);

  const loadedModels = ollamaReachable ? await listLoaded() : [];

  const serviceReach = await Promise.all(
    services.map(async (s) => {
      if (s.kind === 'ollama') return ollamaReachable;
      if (s.kind === 'chatterbox') return chatterboxReachable;
      return probeHost(s.hostUrl);
    })
  );

  return {
    gpu,
    cpu,
    ollama: {
      reachable: ollamaReachable,
      host: getOllamaHostForStatus(),
      launchDir: resolveOllamaLaunchDir(),
      loadedModels,
    },
    chatterbox: {
      reachable: chatterboxReachable,
      host: getChatterboxHostForStatus(),
      launchDir: getChatterboxLaunchDirForStatus(),
      deviceHint: readDeviceHint(getChatterboxLaunchDirForStatus()),
    },
    services: services.map((s, i) => ({
      ...s,
      reachable: serviceReach[i] ?? null,
    })),
    commandLog: getCommandLog(),
  };
}
