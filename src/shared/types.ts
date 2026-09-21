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

export type {
  DashboardMount,
  Mount,
  MountHelp,
  MountLaunch,
  MountPanel,
  MountPanelAction,
  MountPanelColumn,
  MountPanelList,
  MountPanelRuntime,
  MountStart,
  MountStop,
  MountTemplateInfo,
  LaunchMode,
} from './mountSchema';

import type { DashboardMount, Mount, MountTemplateInfo } from './mountSchema';

/** One open loopback port found by scan (not yet added to the dashboard). */
export interface ScanHit {
  port: number;
  hostUrl: string;
  open: boolean;
  httpStatus: number | null;
  suggestedTemplateId: string | null;
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  detail: string;
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
  mounts: DashboardMount[];
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
  chooseMountDir: () => Promise<DirPickerResult>;
  runMountAction: (
    mountId: string,
    action: 'start' | 'stop' | { panelId: string; actionId: string; row?: Record<string, unknown> }
  ) => Promise<ActionResult>;
  listMounts: () => Promise<Mount[]>;
  listMountTemplates: () => Promise<MountTemplateInfo[]>;
  scanServices: () => Promise<ScanHit[]>;
  addFromTemplate: (
    templateId: string,
    overrides?: Partial<Pick<Mount, 'name' | 'hostUrl'>>
  ) => Promise<{ status: 'ok'; mount: Mount } | { status: 'error'; message: string }>;
  saveMount: (mount: Mount) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  deleteMount: (mountId: string) => Promise<{ status: 'ok' } | { status: 'error'; message: string }>;
  clearCommandLog: () => Promise<{ status: 'ok' }>;
  killGpuProcess: (pid: number) => Promise<ActionResult>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}
