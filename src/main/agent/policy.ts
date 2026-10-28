import * as path from 'path';

/**
 * What the in-app Assistant may do.
 *
 * It can READ (files on this PC, the web) and MANAGE MOUNTS (Hardpoint's own config). It cannot write
 * files or run commands of its own: those built-in tools are not given to it at all. The one place a
 * command can run is a mount's Start/Stop command, which the user reviews in the save approval.
 */

/** Paths the Assistant is never allowed to read, even though reading is otherwise open. */
const SENSITIVE_PATH_PARTS = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker',
  '.claude',
  '.config/gcloud',
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.env',
  'id_rsa',
  'id_ed25519',
  'credentials',
  'secrets',
  'login data',
  'cookies',
  'wallet',
  'appdata/local/google',
  'appdata/local/microsoft/edge',
  'appdata/roaming/mozilla',
  'appdata/roaming/microsoft/credentials',
  'appdata/roaming/microsoft/protect',
  'keychain',
  // Hardpoint's own saved commands, hosts and last outputs.
  'app-config.json',
  'command-runs.json',
];

function slashes(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export function isSensitivePath(target: string): boolean {
  const normalized = slashes(path.normalize(target));
  return SENSITIVE_PATH_PARTS.some((part) => {
    const needle = part.toLowerCase();
    // Match whole path segments (or file names), not substrings of ordinary words.
    return normalized.split('/').some((segment) => segment === needle || segment.startsWith(`${needle}.`)) ||
      (needle.includes('/') && normalized.includes(needle));
  });
}

/** Path a read-only tool is about to touch, if the input names one. */
export function readTargetPath(toolName: string, input: Record<string, unknown>): string | null {
  const value =
    toolName === 'Read' ? input.file_path : toolName === 'Glob' || toolName === 'Grep' ? input.path : null;
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Hosts the Assistant may fetch docs from without asking (https GET only). */
const RESEARCH_HOSTS = [
  'github.com',
  'githubusercontent.com',
  'huggingface.co',
  'pypi.org',
  'npmjs.com',
  'readthedocs.io',
];

export function isResearchUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    return RESEARCH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// The blocklist itself lives in shared/commandRisk.ts so the command board can use it too.
export { dangerousCommandReason } from '../../shared/commandRisk';
