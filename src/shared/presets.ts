/** Scan fingerprint catalog only — live mounts come from userData JSON seeds/templates. */

export interface ServicePreset {
  id: string;
  name: string;
  description: string;
  defaultHostUrl: string;
  defaultPort: number;
  probePaths: string[];
  fingerprint?: RegExp;
}

export const SERVICE_PRESETS: ServicePreset[] = [
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local LLM server (default :11434).',
    defaultHostUrl: 'http://127.0.0.1:11434',
    defaultPort: 11434,
    probePaths: ['/api/tags', '/'],
    fingerprint: /ollama|"models"/i,
  },
  {
    id: 'chatterbox',
    name: 'Chatterbox TTS',
    description: 'Local TTS server (default :8004).',
    defaultHostUrl: 'http://127.0.0.1:8004',
    defaultPort: 8004,
    probePaths: ['/', '/docs', '/health'],
    fingerprint: /chatterbox|fastapi|swagger/i,
  },
  {
    id: 'comfyui',
    name: 'ComfyUI',
    description: 'Node-based image UI (common ports 8188 / 8000).',
    defaultHostUrl: 'http://127.0.0.1:8188',
    defaultPort: 8188,
    probePaths: ['/system_stats', '/object_info', '/'],
    fingerprint: /comfy|pytorch|queue_remaining/i,
  },
  {
    id: 'open-webui',
    name: 'Open WebUI',
    description: 'Chat UI often on :8080 / :3000.',
    defaultHostUrl: 'http://127.0.0.1:8080',
    defaultPort: 8080,
    probePaths: ['/', '/api/v1/auths/', '/health'],
    fingerprint: /open.?webui|ollama/i,
  },
  {
    id: 'a1111',
    name: 'Automatic1111 / Forge',
    description: 'Stable Diffusion WebUI (default :7860).',
    defaultHostUrl: 'http://127.0.0.1:7860',
    defaultPort: 7860,
    probePaths: ['/', '/sdapi/v1/sd-models'],
    fingerprint: /stable.?diffusion|gradio|forge/i,
  },
  {
    id: 'custom',
    name: 'Custom HTTP service',
    description: 'Any loopback URL.',
    defaultHostUrl: 'http://127.0.0.1:8080',
    defaultPort: 8080,
    probePaths: ['/'],
  },
];

export const EXTRA_SCAN_PORTS = [1234, 5000, 5001, 5173, 5174, 3000, 3001, 8888, 7861, 8000];

export function scanPortList(): number[] {
  const ports = new Set<number>();
  for (const p of SERVICE_PRESETS) ports.add(p.defaultPort);
  for (const p of EXTRA_SCAN_PORTS) ports.add(p);
  ports.add(8000);
  return [...ports].sort((a, b) => a - b);
}
