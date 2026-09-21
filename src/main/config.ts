import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Mount } from '../shared/mountSchema';
import { migrateLegacyService, normalizeMount } from '../shared/mountSchema';

export interface AppConfig {
  /** @deprecated kept for one-release migration only */
  ollamaHost?: string;
  chatterboxHost?: string;
  ollamaLaunchDir?: string;
  chatterboxLaunchDir?: string;
  /** User mounts (JSON-driven cards). Legacy key `services` is migrated on read. */
  mounts?: Mount[];
  /** Legacy services array — migrated into mounts then cleared. */
  services?: unknown[];
  mountsMigrated?: boolean;
}

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'app-config.json');
}

export function getSeedsPath(): string {
  // Dev: repo assets/; packaged: resources/assets next to app or inside asarUnpack
  const candidates = [
    path.join(process.resourcesPath, 'assets', 'mount-seeds.json'),
    path.join(app.getAppPath(), 'assets', 'mount-seeds.json'),
    path.join(__dirname, '../../../assets/mount-seeds.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[candidates.length - 1];
}

export function readConfig(): AppConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '')) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

/** Load mounts from config, migrating legacy `services` once. */
export function readMounts(): Mount[] {
  const config = readConfig();
  let changed = false;
  const mounts: Mount[] = [];

  if (Array.isArray(config.mounts)) {
    for (const raw of config.mounts) {
      const m = normalizeMount(raw) ?? migrateLegacyService(raw);
      if (m) mounts.push(m);
    }
  }

  if (Array.isArray(config.services) && config.services.length > 0) {
    for (const raw of config.services) {
      const m = migrateLegacyService(raw);
      if (!m) continue;
      if (!mounts.some((x) => x.id === m.id)) mounts.push(m);
      changed = true;
    }
  }

  // Fold legacy launch dirs into matching mounts if still unset
  if (config.ollamaLaunchDir?.trim()) {
    const o = mounts.find((m) => /ollama/i.test(m.name) || m.id.includes('ollama'));
    if (o && o.launch.mode === 'unset') {
      o.launch = { mode: 'folder', cwd: config.ollamaLaunchDir.trim() };
      changed = true;
    }
  }
  if (config.chatterboxLaunchDir?.trim()) {
    const c = mounts.find((m) => /chatterbox/i.test(m.name) || m.id.includes('chatterbox'));
    if (c && c.launch.mode === 'unset') {
      c.launch = { mode: 'folder', cwd: config.chatterboxLaunchDir.trim() };
      changed = true;
    }
  }

  if (changed || (config.services && config.services.length > 0) || !config.mountsMigrated) {
    const next: AppConfig = {
      ...config,
      mounts,
      mountsMigrated: true,
    };
    delete next.services;
    writeConfig(next);
  }

  return mounts;
}

export function writeMounts(mounts: Mount[]): void {
  const config = readConfig();
  const next: AppConfig = { ...config, mounts, mountsMigrated: true };
  delete next.services;
  writeConfig(next);
}
