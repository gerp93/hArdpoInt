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

const DANGEROUS_COMMAND: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(rm|rmdir|rd|del|erase|remove-item|ri|format|diskpart|mkfs)\b/i,
    reason: 'deletes files or formats disks',
  },
  {
    pattern: /\b(reg(\.exe)?\s+(add|delete|import)|regedit|schtasks|bcdedit|netsh|icacls|takeown|setx|set-executionpolicy)\b/i,
    reason: 'changes system, registry, scheduler or security settings',
  },
  {
    pattern: /\b(sc(\.exe)?\s+(create|config|delete)|net(\.exe)?\s+(user|localgroup))\b/i,
    reason: 'creates or changes services or accounts',
  },
  {
    pattern: /\b(sudo|runas)\b|-verb\s+runas/i,
    reason: 'asks for administrator rights',
  },
  {
    pattern: /\b(invoke-expression|iex)\b|-enc(odedcommand)?\b|frombase64string/i,
    reason: 'runs obfuscated or dynamically built code',
  },
  {
    pattern: /\b(curl|wget|invoke-webrequest|iwr|irm)\b[^\n|]*\|\s*(sh|bash|iex|powershell|pwsh|cmd)/i,
    reason: 'downloads and runs code in one step',
  },
  {
    pattern: /\bgit\s+(push|reset\s+--hard|clean)\b/i,
    reason: 'sends data out or discards work',
  },
];

/** Why a Start/Stop command can't be saved by the Assistant, or null if it looks acceptable. */
export function dangerousCommandReason(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_COMMAND) {
    if (pattern.test(command)) return reason;
  }
  return null;
}
