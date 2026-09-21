/**
 * Normalize loopback host URLs so `localhost` / `127.0.0.1` / `::1` compare equal
 * (scan hits use 127.0.0.1; config defaults often use localhost).
 */
export function loopbackHostKey(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    let host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host === '[::1]') {
      host = '127.0.0.1';
    }
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.protocol}//${host}:${port}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

/** Loopback TCP port from a host URL, or null if not parseable / not loopback. */
export function loopbackPortFromUrl(url: string | null | undefined): number | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]') {
      return null;
    }
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? '443' : '80'));
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}
