import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from './trust';

const mainDir = path.resolve(__dirname, '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(mainDir, ...parts), 'utf-8');

describe('isTrustedRendererUrl', () => {
  it('accepts only the app page', () => {
    expect(isTrustedRendererUrl('file:///C:/Program%20Files/Hardpoint/resources/app.asar/dist/renderer/index.html', true)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5174/', false)).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5174/#/x', false)).toBe(true);
  });

  it('rejects other pages, other ports, other hosts and junk', () => {
    expect(isTrustedRendererUrl('https://evil.example/renderer/index.html', true)).toBe(false);
    expect(isTrustedRendererUrl('file:///C:/Users/x/Downloads/page.html', true)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5174/', true)).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:3921/', false)).toBe(false);
    expect(isTrustedRendererUrl('http://localhost:5175/', false)).toBe(false);
    expect(isTrustedRendererUrl('http://evil.example:5174/', false)).toBe(false);
    expect(isTrustedRendererUrl(undefined, false)).toBe(false);
    expect(isTrustedRendererUrl('not a url', true)).toBe(false);
  });
});

// Crude on purpose: these fail loudly if someone wires saved commands to the HTTP API or the
// Assistant, which is the one thing this feature must never allow.
describe('saved commands stay in the app window', () => {
  it('has no route for them on the loopback HTTP API', () => {
    const api = read('apiServer.ts');
    expect(api).not.toMatch(/commands\//);
    expect(api).not.toMatch(/commandSchema/);
    expect(api).not.toMatch(/\/api\/commands?/);
  });

  it('gives the Assistant no way to run, list or change them', () => {
    for (const file of fs.readdirSync(path.join(mainDir, 'agent')).filter((f) => f.endsWith('.ts'))) {
      const source = read('agent', file);
      expect(source, file).not.toMatch(/commands\/(runner|ipc|store)/);
      expect(source, file).not.toMatch(/commandSchema/);
      expect(source, file).not.toMatch(/\b(run|save|list)_command/);
    }
    expect(read('agent', 'policy.ts')).toMatch(/'command-runs\.json'/);
    expect(read('agent', 'policy.ts')).toMatch(/'app-config\.json'/);
  });

  it('registers every command IPC handler through the trusted-sender check', () => {
    const ipc = read('commands', 'ipc.ts');
    expect(ipc.match(/ipcMain\.handle\(/g)).toHaveLength(1);
    expect(ipc).toMatch(/isTrustedRendererUrl\(event\.senderFrame\?\.url/);
    expect(read('main.ts')).not.toMatch(/ipcMain\.handle\(\s*'commands:/);
  });

  it('never takes command text from the renderer when running', () => {
    const ipc = read('commands', 'ipc.ts');
    const runHandler = ipc.slice(ipc.indexOf("handle('commands:run'"), ipc.indexOf("handle('commands:cancel'"));
    expect(runHandler).toMatch(/readBoard\(\)/);
    expect(runHandler).not.toMatch(/normalizeCommand/);
  });
});
