export interface GpuProcess {
  pid: number;
  name: string;
  memoryMiB: number | null;
}

export interface GpuSnapshot {
  available: boolean;
  name: string | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
  utilizationGpu: number | null;
  temperatureC: number | null;
  processes: GpuProcess[];
}

export interface CpuSnapshot {
  available: boolean;
  name: string | null;
  utilizationPercent: number | null;
  memoryUsedMiB: number | null;
  memoryTotalMiB: number | null;
}

export interface LoadedModel {
  name: string;
  sizeVram: number | null;
  processor: string | null;
  expiresAt: string | null;
}

export interface ServiceStatus {
  reachable: boolean;
  host: string;
  launchDir: string | null;
}

/** One button on a managed service card. */
export interface ServiceAction {
  id: string;
  label: string;
  /** Shown next to the button so you can see what will run. */
  commandPreview: string;
  /** How Hardpoint runs it. */
  runner:
    | { type: 'builtin'; builtin: string }
    | { type: 'shell'; command: string; cwd?: string }
    | { type: 'stop-port'; port: number; launchDir?: string };
}

export interface ManagedService {
  id: string;
  name: string;
  /** http URL used for the Reachable/Down pill (optional). */
  hostUrl: string | null;
  /** Extra UI for Ollama loaded-models table. */
  kind: 'generic' | 'ollama' | 'chatterbox';
  workingDir: string | null;
  actions: ServiceAction[];
}

export interface CommandLogEntry {
  id: string;
  at: string;
  serviceId: string | null;
  actionId: string | null;
  command: string;
  ok: boolean;
  detail: string | null;
}

export interface DashboardStatus {
  gpu: GpuSnapshot;
  cpu: CpuSnapshot;
  ollama: ServiceStatus & { loadedModels: LoadedModel[] };
  chatterbox: ServiceStatus & { deviceHint: string | null };
  services: Array<ManagedService & { reachable: boolean | null }>;
  commandLog: CommandLogEntry[];
}

export type ActionResult =
  | { status: 'ok'; commands?: string[] }
  | { status: 'error'; message: string; commands?: string[] };

export type DirPickerResult =
  | { status: 'ok'; dir: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface HardpointApi {
  getStatus: () => Promise<DashboardStatus>;
  ollamaStart: () => Promise<ActionResult>;
  ollamaStop: () => Promise<ActionResult>;
  ollamaUnload: (model?: string) => Promise<void>;
  chatterboxStart: () => Promise<ActionResult>;
  chatterboxStop: () => Promise<ActionResult>;
  chooseOllamaDir: () => Promise<DirPickerResult>;
  chooseChatterboxDir: () => Promise<DirPickerResult>;
  runServiceAction: (serviceId: string, actionId: string) => Promise<ActionResult>;
  listServices: () => Promise<ManagedService[]>;
  saveService: (service: ManagedService) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  deleteService: (serviceId: string) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  clearCommandLog: () => Promise<{ status: 'ok' }>;
}
