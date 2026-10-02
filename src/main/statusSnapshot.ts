import * as net from 'node:net';
import type { DashboardMount, DashboardStatus, Mount } from '../shared/types';
import { getCommandLog } from './commandLog';
import { getCpuSnapshot } from './cpu';
import { getGpuSnapshot } from './gpu';
import { pidsRunningUnder } from './localServerProcess';
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

function probeTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 2_000 });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function probeMount(m: Mount): Promise<boolean | null> {
  if (m.probe?.type === 'process') {
    const dir = m.launch.mode === 'folder' ? m.launch.cwd?.trim() : null;
    return dir ? (await pidsRunningUnder(dir)).length > 0 : null;
  }
  if (m.probe?.type === 'tcp') return probeTcp(m.probe.port);
  return probeHost(m.hostUrl);
}

export async function buildDashboardStatus(): Promise<DashboardStatus> {
  const mounts = listMounts();
  const [gpu, cpu] = await Promise.all([getGpuSnapshot(), getCpuSnapshot()]);

  const enriched: DashboardMount[] = await Promise.all(
    mounts.map(async (m) => {
      const reachable = await probeMount(m);
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
