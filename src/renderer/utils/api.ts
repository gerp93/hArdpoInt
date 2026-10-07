import type {
  ActionResult,
  DashboardStatus,
  DirPickerResult,
  HardpointApi,
  MountTemplateInfo,
  ScanHit,
} from '../../shared/types';

const HTTP_API_ROOT = 'http://127.0.0.1:3921';

function hasIpc(): boolean {
  return typeof window !== 'undefined' && window.hardpoint != null;
}

function emptyStatus(): DashboardStatus {
  return {
    gpu: {
      available: false,
      name: null,
      memoryUsedMiB: null,
      memoryTotalMiB: null,
      utilizationGpu: null,
      temperatureC: null,
      processes: [],
    },
    cpu: {
      available: false,
      name: null,
      utilizationPercent: null,
      memoryUsedMiB: null,
      memoryTotalMiB: null,
    },
    mounts: [],
    commandLog: [],
  };
}

function normalizeStatus(raw: Partial<DashboardStatus> | null | undefined): DashboardStatus {
  const base = emptyStatus();
  if (!raw) return base;
  return {
    ...base,
    ...raw,
    gpu: { ...base.gpu, ...(raw.gpu ?? {}) },
    cpu: { ...base.cpu, ...(raw.cpu ?? {}) },
    mounts: raw.mounts ?? [],
    commandLog: raw.commandLog ?? [],
  };
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${HTTP_API_ROOT}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Hardpoint API ${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

const folderOnlyInApp: DirPickerResult = {
  status: 'error',
  message: 'Choose folder only works in the Hardpoint desktop window (not in an embed/browser).',
};

export const hardpointClient: HardpointApi = {
  getStatus: async () => {
    if (hasIpc()) return normalizeStatus(await window.hardpoint.getStatus());
    return normalizeStatus(await httpJson<DashboardStatus>('/api/status'));
  },
  chooseMountDir: async () => {
    if (hasIpc()) return window.hardpoint.chooseMountDir();
    return folderOnlyInApp;
  },
  runMountAction: async (mountId, action) => {
    if (hasIpc()) return window.hardpoint.runMountAction(mountId, action);
    return httpJson<ActionResult>('/api/mounts/action', {
      method: 'POST',
      body: JSON.stringify({ mountId, action }),
    });
  },
  listMounts: async () => {
    if (hasIpc()) return window.hardpoint.listMounts();
    const status = await hardpointClient.getStatus();
    return status.mounts;
  },
  listMountTemplates: async () => {
    if (hasIpc()) return window.hardpoint.listMountTemplates();
    return httpJson<MountTemplateInfo[]>('/api/mounts/templates');
  },
  scanServices: async () => {
    if (hasIpc()) return window.hardpoint.scanServices();
    return httpJson<ScanHit[]>('/api/services/scan');
  },
  addFromTemplate: async (templateId, overrides) => {
    if (hasIpc()) return window.hardpoint.addFromTemplate(templateId, overrides);
    return httpJson('/api/mounts/add-template', {
      method: 'POST',
      body: JSON.stringify({ templateId, ...(overrides ?? {}) }),
    });
  },
  saveMount: async (mount) => {
    if (hasIpc()) return window.hardpoint.saveMount(mount);
    return httpJson('/api/mounts/save', { method: 'POST', body: JSON.stringify(mount) });
  },
  deleteMount: async (mountId) => {
    if (hasIpc()) return window.hardpoint.deleteMount(mountId);
    return httpJson('/api/mounts/delete', {
      method: 'POST',
      body: JSON.stringify({ mountId }),
    });
  },
  clearCommandLog: async () => {
    if (hasIpc()) return window.hardpoint.clearCommandLog();
    return httpJson('/api/log/clear', { method: 'POST', body: '{}' });
  },
  killGpuProcess: async (pid) => {
    if (hasIpc()) return window.hardpoint.killGpuProcess(pid);
    return httpJson('/api/gpu/kill', {
      method: 'POST',
      body: JSON.stringify({ pid }),
    });
  },
  getAppVersion: async () => {
    if (hasIpc()) return window.hardpoint.getAppVersion();
    return 'embed';
  },
  listMcpServers: async () => {
    if (hasIpc()) return window.hardpoint.listMcpServers();
    return { running: [], configured: [], sources: [] };
  },
  addMcpConfigFile: async () => {
    if (hasIpc()) return window.hardpoint.addMcpConfigFile();
    return { status: 'error' as const, message: 'Adding a config file needs the Hardpoint desktop window.' };
  },
  removeMcpConfigFile: async (file) => {
    if (hasIpc()) return window.hardpoint.removeMcpConfigFile(file);
    return { status: 'error' as const, message: 'Needs the Hardpoint desktop window.' };
  },
  stopMcpServer: async (pid) => {
    if (hasIpc()) return window.hardpoint.stopMcpServer(pid);
    return { status: 'error' as const, message: 'Stopping MCP servers needs the Hardpoint desktop window.' };
  },
  checkForUpdates: async () => {
    if (hasIpc()) return window.hardpoint.checkForUpdates();
    return {
      status: 'unsupported' as const,
      message: 'Update checks need the Hardpoint desktop window.',
    };
  },
};

/** Embed only: version of an update the desktop app has found, or null. */
export async function getPendingUpdateVersion(): Promise<string | null> {
  try {
    const result = await httpJson<{ version: string | null }>('/api/update');
    return result.version ?? null;
  } catch {
    return null;
  }
}

/** Embed only: bring the Hardpoint desktop window to the front. */
export async function showHardpointWindow(): Promise<void> {
  await httpJson('/api/window/show', { method: 'POST', body: '{}' });
}

export function isEmbeddedHttpMode(): boolean {
  return !hasIpc();
}
