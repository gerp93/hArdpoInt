export interface GpuProcess {
  pid: number;
  name: string;
  /** WDDM on Windows usually cannot report this (null / N/A). */
  memoryMiB: number | null;
  /** From nvidia-smi pmon: C = compute, G = graphics, C+G = both. */
  type: 'C' | 'G' | 'C+G' | null;
  /** SM busy % from pmon when the driver reports it (often unavailable on WDDM). */
  smPercent: number | null;
  /**
   * active = likely real GPU work (models, encode, compute).
   * ui = desktop / browser / overlay clients that hold a GPU context idle.
   */
  kind: 'active' | 'ui';
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
  /** Extra UI hooks (loaded models, device hint). Presets set this; custom stays generic. */
  kind: 'generic' | 'ollama' | 'chatterbox';
  /** Launch folder for Start (cwd / binary location), or null when using PATH / not set. */
  workingDir: string | null;
  /**
   * When true, Start uses binaries/commands from PATH instead of a launch folder.
   * Stop still uses the host port and does not need a folder. Available on every card;
   * Chatterbox Start still needs its portable folder (PATH alone is not enough).
   */
  usePath?: boolean;
  actions: ServiceAction[];
}

/** One open loopback port found by scan (not yet added to the dashboard). */
export interface ScanHit {
  port: number;
  hostUrl: string;
  open: boolean;
  httpStatus: number | null;
  suggestedPresetId: string | null;
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  detail: string;
}

/** Serializable preset card for the Add UI (no runners / regex). */
export interface ServicePresetInfo {
  id: string;
  name: string;
  description: string;
  defaultHostUrl: string;
  defaultPort: number;
  kind: ManagedService['kind'];
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

export interface DashboardService extends ManagedService {
  reachable: boolean | null;
  /** Populated when kind === 'ollama' and the host answers. */
  loadedModels?: LoadedModel[];
  /** Populated when kind === 'chatterbox'. */
  deviceHint?: string | null;
}

export interface DashboardStatus {
  gpu: GpuSnapshot;
  cpu: CpuSnapshot;
  services: DashboardService[];
  commandLog: CommandLogEntry[];
}

export type ActionResult =
  | { status: 'ok'; commands?: string[] }
  | { status: 'error'; message: string; commands?: string[] };

export type DirPickerResult =
  | { status: 'ok'; dir: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export type UpdateCheckResult =
  | { status: 'available'; version?: string; message?: string }
  | { status: 'not-available'; version?: string; message?: string }
  | { status: 'error'; version?: string; message?: string }
  | { status: 'unsupported'; version?: string; message?: string };

export interface HardpointApi {
  getStatus: () => Promise<DashboardStatus>;
  ollamaStart: () => Promise<ActionResult>;
  ollamaStop: () => Promise<ActionResult>;
  ollamaUnload: (model?: string) => Promise<void>;
  chatterboxStart: () => Promise<ActionResult>;
  chatterboxStop: () => Promise<ActionResult>;
  chooseOllamaDir: () => Promise<DirPickerResult>;
  chooseChatterboxDir: () => Promise<DirPickerResult>;
  chooseServiceDir: () => Promise<DirPickerResult>;
  runServiceAction: (serviceId: string, actionId: string) => Promise<ActionResult>;
  listServices: () => Promise<ManagedService[]>;
  listPresets: () => Promise<ServicePresetInfo[]>;
  scanServices: () => Promise<ScanHit[]>;
  addFromPreset: (
    presetId: string,
    overrides?: Partial<Pick<ManagedService, 'name' | 'hostUrl' | 'workingDir'>>
  ) => Promise<{ status: 'ok'; service: ManagedService } | { status: 'error'; message: string }>;
  saveService: (service: ManagedService) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  deleteService: (serviceId: string) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  clearCommandLog: () => Promise<{ status: 'ok' }>;
  /** Force-kill a GPU Active/compute process by PID (not Insufficient Permissions rows). */
  killGpuProcess: (pid: number) => Promise<ActionResult>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}
