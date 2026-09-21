import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { ManagedService } from '../shared/types';

export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
export const DEFAULT_CHATTERBOX_HOST = 'http://localhost:8004';

export interface AppConfig {
  ollamaHost?: string;
  chatterboxHost?: string;
  ollamaLaunchDir?: string;
  chatterboxLaunchDir?: string;
  /** User-editable local services (Ollama/Chatterbox/ComfyUI/custom). */
  services?: ManagedService[];
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

export function readConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

export function writeConfig(config: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function getEffectiveOllamaHost(): string {
  const configured = readConfig().ollamaHost?.trim();
  return configured || DEFAULT_OLLAMA_HOST;
}

export function getEffectiveChatterboxHost(): string {
  const configured = readConfig().chatterboxHost?.trim();
  return configured || DEFAULT_CHATTERBOX_HOST;
}

export function getOllamaLaunchDir(): string | null {
  const configured = readConfig().ollamaLaunchDir?.trim();
  return configured || null;
}

export function setOllamaLaunchDir(dir: string): void {
  writeConfig({ ...readConfig(), ollamaLaunchDir: dir });
}

export function clearOllamaLaunchDir(): void {
  const config = readConfig();
  delete config.ollamaLaunchDir;
  writeConfig(config);
}

export function getChatterboxLaunchDir(): string | null {
  const configured = readConfig().chatterboxLaunchDir?.trim();
  return configured || null;
}

export function setChatterboxLaunchDir(dir: string): void {
  writeConfig({ ...readConfig(), chatterboxLaunchDir: dir });
}

export function clearChatterboxLaunchDir(): void {
  const config = readConfig();
  delete config.chatterboxLaunchDir;
  writeConfig(config);
}
