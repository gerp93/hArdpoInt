import type {
  ActionResult,
  DashboardStatus,
  DirPickerResult,
  HardpointApi,
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
    ollama: { reachable: false, host: '', launchDir: null, loadedModels: [] },
    chatterbox: { reachable: false, host: '', launchDir: null, deviceHint: null },
    services: [],
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
    ollama: { ...base.ollama, ...(raw.ollama ?? {}), loadedModels: raw.ollama?.loadedModels ?? [] },
    chatterbox: { ...base.chatterbox, ...(raw.chatterbox ?? {}) },
    services: raw.services ?? [],
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

/**
 * Prefer Electron IPC when running inside the Hardpoint app.
 * Fall back to the loopback HTTP API when embedded (KVGenius / RolePlaymate iframe)
 * or opened in a normal browser at :3921 / :5174.
 */
export const hardpointClient: HardpointApi = {
  getStatus: async () => {
    if (hasIpc()) return normalizeStatus(await window.hardpoint.getStatus());
    return normalizeStatus(await httpJson<DashboardStatus>('/api/status'));
  },
  ollamaStart: async () => {
    if (hasIpc()) return window.hardpoint.ollamaStart();
    return httpJson<ActionResult>('/api/ollama/start', { method: 'POST', body: '{}' });
  },
  ollamaStop: async () => {
    if (hasIpc()) return window.hardpoint.ollamaStop();
    return httpJson<ActionResult>('/api/ollama/stop', { method: 'POST', body: '{}' });
  },
  ollamaUnload: async (model?: string) => {
    if (hasIpc()) return window.hardpoint.ollamaUnload(model);
    await httpJson('/api/ollama/unload', {
      method: 'POST',
      body: JSON.stringify(model ? { model } : {}),
    });
  },
  chatterboxStart: async () => {
    if (hasIpc()) return window.hardpoint.chatterboxStart();
    return httpJson<ActionResult>('/api/chatterbox/start', { method: 'POST', body: '{}' });
  },
  chatterboxStop: async () => {
    if (hasIpc()) return window.hardpoint.chatterboxStop();
    return httpJson<ActionResult>('/api/chatterbox/stop', { method: 'POST', body: '{}' });
  },
  chooseOllamaDir: async () => {
    if (hasIpc()) return window.hardpoint.chooseOllamaDir();
    return folderOnlyInApp;
  },
  chooseChatterboxDir: async () => {
    if (hasIpc()) return window.hardpoint.chooseChatterboxDir();
    return folderOnlyInApp;
  },
  runServiceAction: async (serviceId, actionId) => {
    if (hasIpc()) return window.hardpoint.runServiceAction(serviceId, actionId);
    return httpJson<ActionResult>('/api/services/action', {
      method: 'POST',
      body: JSON.stringify({ serviceId, actionId }),
    });
  },
  listServices: async () => {
    if (hasIpc()) return window.hardpoint.listServices();
    const status = await hardpointClient.getStatus();
    return status.services;
  },
  saveService: async (service) => {
    if (hasIpc()) return window.hardpoint.saveService(service);
    return httpJson('/api/services/save', { method: 'POST', body: JSON.stringify(service) });
  },
  deleteService: async (serviceId) => {
    if (hasIpc()) return window.hardpoint.deleteService(serviceId);
    return httpJson('/api/services/delete', {
      method: 'POST',
      body: JSON.stringify({ serviceId }),
    });
  },
  clearCommandLog: async () => {
    if (hasIpc()) return window.hardpoint.clearCommandLog();
    return httpJson('/api/log/clear', { method: 'POST', body: '{}' });
  },
  getAppVersion: async () => {
    if (hasIpc()) return window.hardpoint.getAppVersion();
    return 'embed';
  },
  checkForUpdates: async () => {
    if (hasIpc()) return window.hardpoint.checkForUpdates();
    return {
      status: 'unsupported' as const,
      message: 'Update checks need the Hardpoint desktop window.',
    };
  },
};

export function isEmbeddedHttpMode(): boolean {
  return !hasIpc();
}
