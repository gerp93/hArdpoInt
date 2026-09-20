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

export interface DashboardStatus {
  gpu: GpuSnapshot;
  ollama: ServiceStatus & { loadedModels: LoadedModel[] };
  chatterbox: ServiceStatus & { deviceHint: string | null };
}

export type ActionResult = { status: 'ok' } | { status: 'error'; message: string };

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
}
