/**
 * Heuristics about what a command line might do. They are nudges, not barriers: the Assistant's
 * mount tools refuse the first list outright, and the command board forces a confirmation for
 * either list and warns about secrets. Whoever writes a command can still run it.
 */

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

const RISKY_COMMAND: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /\b(systemctl|service)\b[^\n]*\b(stop|restart|disable|mask|kill)\b/i,
    reason: 'stops or restarts a service',
  },
  { pattern: /\b(reboot|shutdown|poweroff|halt|init\s+[06])\b/i, reason: 'restarts or powers off the machine' },
  { pattern: /\b(dd|shred|truncate|wipefs|fdisk|parted)\b/i, reason: 'writes to disks or files in bulk' },
  { pattern: /\b(kill|killall|pkill)\b/i, reason: 'kills processes' },
  {
    pattern: /\b(apt(-get)?|dnf|yum|pip3?|npm)\s+(remove|purge|uninstall|autoremove)\b/i,
    reason: 'removes software',
  },
  { pattern: />\s*\/dev\/(sd|nvme|disk)/i, reason: 'writes to a disk device' },
  { pattern: /\b(chmod|chown)\s+(-R|--recursive)\b/i, reason: 'changes permissions recursively' },
  {
    pattern: /\b(taskkill|stop-process|stop-service|restart-computer|stop-computer)\b/i,
    reason: 'stops processes or services',
  },
];

/** Why running this command should always ask first, or null if nothing stands out. */
export function riskReason(command: string): string | null {
  const dangerous = dangerousCommandReason(command);
  if (dangerous) return dangerous;
  for (const { pattern, reason } of RISKY_COMMAND) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

const SECRET_PATTERNS: { pattern: RegExp; what: string }[] = [
  {
    pattern:
      /(--?(password|passwd|pwd|pass|token|secret|api[-_]?key)\b|\b(password|passwd|pwd|token|secret|api[-_]?key)\s*[=:])\s*\S+/i,
    what: 'a password, token or key',
  },
  { pattern: /\bsshpass\b/i, what: 'a password (sshpass)' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i, what: 'a bearer token' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, what: 'an AWS access key' },
  { pattern: /\b(sk|ghp|gho|github_pat|xox[bp])[-_][A-Za-z0-9_-]{16,}/, what: 'an API token' },
  { pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, what: 'a password inside a URL' },
];

/** A warning when a command line looks like it contains a secret, or null. */
export function secretWarning(command: string): string | null {
  for (const { pattern, what } of SECRET_PATTERNS) {
    if (pattern.test(command)) {
      return `This looks like it contains ${what}. Use an SSH key or the server's own config instead of putting secrets in a saved command.`;
    }
  }
  return null;
}
