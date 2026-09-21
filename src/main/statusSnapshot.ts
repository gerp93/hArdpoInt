import type { DashboardService, DashboardStatus } from '../shared/types';
import {
  getChatterboxLaunchDirForStatus,
  isReachable as isChatterboxReachable,
  readDeviceHint,
} from './chatterbox';
import { getCommandLog } from './commandLog';
import { getCpuSnapshot } from './cpu';
import { getGpuSnapshot } from './gpu';
import {
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
  const [gpu, cpu] = await Promise.all([getGpuSnapshot(), getCpuSnapshot()]);

  const enriched: DashboardService[] = await Promise.all(
    services.map(async (s) => {
      let reachable: boolean | null = null;
      if (s.kind === 'ollama') {
        reachable = await isOllamaReachable();
      } else if (s.kind === 'chatterbox') {
        reachable = await isChatterboxReachable();
      } else {
        reachable = await probeHost(s.hostUrl);
      }

      const row: DashboardService = { ...s, reachable };

      if (s.kind === 'ollama' && reachable) {
        row.loadedModels = await listLoaded();
      }
      if (s.kind === 'chatterbox') {
        row.deviceHint = readDeviceHint(getChatterboxLaunchDirForStatus());
      }
      return row;
    })
  );

  return {
    gpu,
    cpu,
    services: enriched,
    commandLog: getCommandLog(),
  };
}
