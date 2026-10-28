/**
 * Who may talk to the loopback API on 127.0.0.1:3921.
 *
 * Binding to loopback keeps other machines out, but not web pages in the user's browser or other
 * local programs. Two checks close that:
 *  - Host must be a loopback name on our port (stops DNS rebinding: a hostile site pointing its own
 *    name at 127.0.0.1 would otherwise be treated as same-origin).
 *  - A request that changes anything must come from no browser at all (no Origin header: Node, Python,
 *    Electron main) or from a page served from loopback (the embedded UI). Any other Origin, including
 *    `null` (sandboxed iframes, data: URLs), is refused.
 * Reads may also come from `null` (packaged host apps load their renderer from file://).
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface GuardInput {
  method: string | undefined;
  host: string | undefined;
  origin: string | undefined;
  port: number;
}

export type GuardResult = { ok: true } | { ok: false; status: number; message: string };

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return LOOPBACK_HOSTS.has(url.hostname) && url.port === String(port);
  } catch {
    return false;
  }
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export function guardRequest(input: GuardInput): GuardResult {
  if (!hostAllowed(input.host, input.port)) {
    return { ok: false, status: 403, message: 'Forbidden: unexpected Host header.' };
  }
  const { origin } = input;
  if (origin === undefined) return { ok: true };

  const method = (input.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (isLoopbackOrigin(origin) || (readOnly && origin === 'null')) return { ok: true };
  return { ok: false, status: 403, message: 'Forbidden: this page may not use the Hardpoint API.' };
}
