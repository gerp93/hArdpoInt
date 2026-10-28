const DEV_ORIGIN = 'http://localhost:5174';

/**
 * Is this the Hardpoint window's own page? Commands run only for it: a page that navigated away, an
 * iframe, or any other window must not be able to start one. Packaged builds load
 * `.../renderer/index.html` from disk; dev builds load the Vite server.
 */
export function isTrustedRendererUrl(url: string | undefined, packaged: boolean): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (packaged) {
      return parsed.protocol === 'file:' && decodeURIComponent(parsed.pathname).endsWith('/renderer/index.html');
    }
    return parsed.origin === DEV_ORIGIN;
  } catch {
    return false;
  }
}
