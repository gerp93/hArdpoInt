import type { ManagedService, ServiceAction } from './types';

/** Catalog entry — templates only; never auto-added to the user's dashboard. */
export interface ServicePreset {
  id: string;
  name: string;
  description: string;
  /** Default loopback URL when adding from this preset. */
  defaultHostUrl: string;
  defaultPort: number;
  /** Paths to try when fingerprinting a live server (first hit wins). */
  probePaths: string[];
  /** Substring match against response body / server header (case-insensitive). */
  fingerprint?: RegExp;
  kind: ManagedService['kind'];
  /** Build start/stop (and extras) for a new ManagedService. */
  buildActions: (hostUrl: string, workingDir: string | null) => ServiceAction[];
}

function portFromUrl(hostUrl: string, fallback: number): number {
  try {
    return Number(new URL(hostUrl).port) || fallback;
  } catch {
    return fallback;
  }
}

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLM server (default :11434). Start/Stop use Hardpoint’s Ollama helpers.',
    defaultHostUrl: 'http://127.0.0.1:11434',
    defaultPort: 11434,
    probePaths: ['/api/tags', '/'],
    fingerprint: /ollama|"models"/i,
    kind: 'ollama',
    buildActions: () => [
      {
        id: 'start',
        label: 'Start',
        commandPreview: 'install folder ollama.exe, or `ollama` on PATH (`ollama serve`)',
        runner: { type: 'builtin', builtin: 'ollama-start' },
      },
      {
        id: 'stop',
        label: 'Stop',
        commandPreview: 'taskkill :11434 listeners + Ollama.exe tray',
        runner: { type: 'builtin', builtin: 'ollama-stop' },
      },
    ],
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox TTS',
    description: 'Local TTS server (default :8004). Start/Stop use Hardpoint’s Chatterbox helpers.',
    defaultHostUrl: 'http://127.0.0.1:8004',
    defaultPort: 8004,
    probePaths: ['/', '/docs', '/health'],
    fingerprint: /chatterbox|fastapi|swagger/i,
    kind: 'chatterbox',
    buildActions: () => [
      {
        id: 'start',
        label: 'Start',
        commandPreview: 'python_embedded\\python.exe start.py --portable …',
        runner: { type: 'builtin', builtin: 'chatterbox-start' },
      },
      {
        id: 'stop',
        label: 'Stop',
        commandPreview: 'taskkill Chatterbox port + install tree',
        runner: { type: 'builtin', builtin: 'chatterbox-stop' },
      },
    ],
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    description: 'Node-based image UI (common ports 8188 / 8000). Stop kills the port; set Start yourself.',
    defaultHostUrl: 'http://127.0.0.1:8188',
    defaultPort: 8188,
    probePaths: ['/system_stats', '/object_info', '/'],
    fingerprint: /comfy|pytorch|queue_remaining/i,
    kind: 'generic',
    buildActions: (hostUrl, workingDir) => {
      const port = portFromUrl(hostUrl, 8188);
      return [
        {
          id: 'start',
          label: 'Start',
          commandPreview: workingDir
            ? `(run your ComfyUI start command in ${workingDir})`
            : 'Set a launch folder and Start command after adding',
          runner: {
            type: 'shell',
            command: workingDir
              ? 'echo Configure the Start command for this ComfyUI install'
              : 'echo Set a launch folder and Start command',
            cwd: workingDir ?? undefined,
          },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: `taskkill listeners on TCP ${port}`,
          runner: { type: 'stop-port', port, launchDir: workingDir ?? undefined },
        },
      ];
    },
  },
  {
    id: 'open-webui',
    name: 'Open WebUI',
    description: 'Chat UI often on :8080 / :3000.',
    defaultHostUrl: 'http://127.0.0.1:8080',
    defaultPort: 8080,
    probePaths: ['/', '/api/v1/auths/', '/health'],
    fingerprint: /open.?webui|ollama/i,
    kind: 'generic',
    buildActions: (hostUrl) => {
      const port = portFromUrl(hostUrl, 8080);
      return [
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: `taskkill listeners on TCP ${port}`,
          runner: { type: 'stop-port', port },
        },
      ];
    },
  },
  {
    id: 'a1111',
    name: 'Automatic1111 / Forge',
    description: 'Stable Diffusion WebUI (default :7860).',
    defaultHostUrl: 'http://127.0.0.1:7860',
    defaultPort: 7860,
    probePaths: ['/', '/sdapi/v1/sd-models'],
    fingerprint: /stable.?diffusion|gradio|forge/i,
    kind: 'generic',
    buildActions: (hostUrl, workingDir) => {
      const port = portFromUrl(hostUrl, 7860);
      return [
        {
          id: 'start',
          label: 'Start',
          commandPreview: 'Set webui launch command after adding',
          runner: {
            type: 'shell',
            command: 'echo Set a Start command for this WebUI install',
            cwd: workingDir ?? undefined,
          },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: `taskkill listeners on TCP ${port}`,
          runner: { type: 'stop-port', port, launchDir: workingDir ?? undefined },
        },
      ];
    },
  },
  {
    id: 'custom',
    name: 'Custom HTTP service',
    description: 'Any loopback URL — you define Start/Stop.',
    defaultHostUrl: 'http://127.0.0.1:8080',
    defaultPort: 8080,
    probePaths: ['/'],
    kind: 'generic',
    buildActions: (hostUrl, workingDir) => {
      const port = portFromUrl(hostUrl, 8080);
      return [
        {
          id: 'start',
          label: 'Start',
          commandPreview: 'Set a shell Start command',
          runner: {
            type: 'shell',
            command: 'echo Set a Start command',
            cwd: workingDir ?? undefined,
          },
        },
        {
          id: 'stop',
          label: 'Stop',
          commandPreview: `taskkill listeners on TCP ${port}`,
          runner: { type: 'stop-port', port, launchDir: workingDir ?? undefined },
        },
      ];
    },
  },
];

/** Extra ports to probe even when no preset owns them (still reported as unknown). */
export const EXTRA_SCAN_PORTS = [1234, 5000, 5001, 5173, 5174, 3000, 3001, 8888, 7861, 8000];

export function getPreset(id: string): ServicePreset | undefined {
  return SERVICE_PRESETS.find((p) => p.id === id);
}

export function buildServiceFromPreset(
  presetId: string,
  overrides?: Partial<Pick<ManagedService, 'id' | 'name' | 'hostUrl' | 'workingDir'>>
): ManagedService | null {
  const preset = getPreset(presetId);
  if (!preset) return null;
  const hostUrl = overrides?.hostUrl?.trim() || preset.defaultHostUrl;
  const workingDir = overrides?.workingDir ?? null;
  const id =
    overrides?.id?.trim() ||
    `${preset.id}-${Date.now().toString(36)}`;
  return {
    id,
    name: overrides?.name?.trim() || preset.name,
    hostUrl,
    workingDir,
    kind: preset.kind,
    actions: preset.buildActions(hostUrl, workingDir),
  };
}

/** Ports we try during a localhost scan (presets + extras, unique). */
export function scanPortList(): number[] {
  const ports = new Set<number>();
  for (const p of SERVICE_PRESETS) ports.add(p.defaultPort);
  for (const p of EXTRA_SCAN_PORTS) ports.add(p);
  // Comfy often on 8000 as well as 8188
  ports.add(8000);
  return [...ports].sort((a, b) => a - b);
}
