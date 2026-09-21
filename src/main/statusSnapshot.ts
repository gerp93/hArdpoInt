import type { DashboardMount, DashboardStatus } from '../shared/types';
import { getCommandLog } from './commandLog';
import { getCpuSnapshot } from './cpu';
import { getGpuSnapshot } from './gpu';
import { fetchPanelData, listMounts } from './services';

async function probeHost(hostUrl: string | null): Promise<boolean | null> {
  if (!hostUrl?.trim()) return null;
  const base = hostUrl.replace(/\/+$/, '');
  try {
    const response = await fetch(base, { method: 'GET', signal: AbortSignal.timeout(2_000) });
    return response.ok || (response.status >= 400 && response.status < 500);
  } catch {
    return false;
  }
}

export async function buildDashboardStatus(): Promise<DashboardStatus> {
  const mounts = listMounts();
  const [gpu, cpu] = await Promise.all([getGpuSnapshot(), getCpuSnapshot()]);

  const enriched: DashboardMount[] = await Promise.all(
    mounts.map(async (m) => {
      const reachable = await probeHost(m.hostUrl);
      const panelData: DashboardMount['panelData'] = {};
      for (const panel of m.panels) {
        const when = panel.when ?? 'reachable';
        if (when === 'reachable' && reachable !== true) {
          panelData[panel.id] = { rows: [] };
          continue;
        }
        panelData[panel.id] = await fetchPanelData(m, panel);
      }
      return { ...m, reachable, panelData };
    })
  );

  return {
    gpu,
    cpu,
    mounts: enriched,
    commandLog: getCommandLog(),
  };
}
