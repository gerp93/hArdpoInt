import { describe, expect, it } from 'vitest';
import { guardRequest } from './apiGuard';

const PORT = 3921;
const ok = (method: string, host: string | undefined, origin?: string) =>
  guardRequest({ method, host, origin, port: PORT }).ok;

describe('guardRequest', () => {
  it('allows programs with no Origin on loopback hosts', () => {
    expect(ok('GET', '127.0.0.1:3921')).toBe(true);
    expect(ok('POST', 'localhost:3921')).toBe(true);
    expect(ok('POST', '[::1]:3921')).toBe(true);
  });

  it('rejects other Host headers (DNS rebinding) and a wrong or missing port', () => {
    expect(ok('GET', 'evil.example:3921')).toBe(false);
    expect(ok('GET', '127.0.0.1.evil.example:3921')).toBe(false);
    expect(ok('GET', '127.0.0.1:8080')).toBe(false);
    expect(ok('GET', '127.0.0.1')).toBe(false);
    expect(ok('GET', undefined)).toBe(false);
  });

  it('allows the embedded UI and dev server (loopback Origin) to read and write', () => {
    expect(ok('POST', '127.0.0.1:3921', 'http://127.0.0.1:3921')).toBe(true);
    expect(ok('POST', '127.0.0.1:3921', 'http://localhost:5174')).toBe(true);
    expect(ok('GET', '127.0.0.1:3921', 'http://127.0.0.1:5173')).toBe(true);
  });

  it('refuses writes from websites and from null origins', () => {
    expect(ok('POST', '127.0.0.1:3921', 'https://evil.example')).toBe(false);
    expect(ok('POST', '127.0.0.1:3921', 'null')).toBe(false);
    expect(ok('POST', '127.0.0.1:3921', 'http://127.0.0.1.evil.example')).toBe(false);
    expect(ok('POST', '127.0.0.1:3921', 'not a url')).toBe(false);
  });

  it('lets packaged file:// host apps read, but not websites', () => {
    expect(ok('GET', '127.0.0.1:3921', 'null')).toBe(true);
    expect(ok('OPTIONS', '127.0.0.1:3921', 'null')).toBe(true);
    expect(ok('GET', '127.0.0.1:3921', 'https://evil.example')).toBe(false);
    expect(ok('OPTIONS', '127.0.0.1:3921', 'https://evil.example')).toBe(false);
  });
});
