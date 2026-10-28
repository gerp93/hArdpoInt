import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LastRun } from '../../shared/commandSchema';
import { MAX_STORED_OUTPUT } from '../../shared/commandSchema';

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, dir: '' }));

vi.mock('electron', () => ({ app: { getPath: () => state.dir } }));
vi.mock('../config', () => ({
  readConfig: () => structuredClone(state.config),
  writeConfig: (c: Record<string, unknown>) => {
    state.config = structuredClone(c);
  },
}));

import { clearRun, readBoard, readRuns, saveRun, writeBoard } from './store';

const run = (over: Partial<LastRun> = {}): LastRun => ({
  runId: 'r1',
  startedAt: '2026-10-27T00:00:00.000Z',
  durationMs: 1200,
  exitCode: 0,
  outcome: 'ok',
  outputTail: 'done',
  display: 'ssh x',
  ...over,
});

beforeEach(() => {
  state.config = {};
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardpoint-store-'));
});

describe('board config', () => {
  it('reads as empty when the keys are absent', () => {
    expect(readBoard()).toEqual({ commands: [], hosts: [] });
  });

  it('drops invalid entries without failing', () => {
    state.config = {
      commands: [{ id: 'ok', name: 'OK', command: 'dir' }, { id: 'bad' }, 'junk'],
      sshHosts: [{ id: 'h', host: 'a.b' }, { host: 'no-id' }],
    };
    const board = readBoard();
    expect(board.commands.map((c) => c.id)).toEqual(['ok']);
    expect(board.hosts.map((h) => h.id)).toEqual(['h']);
  });

  it('keeps every other config key when writing', () => {
    state.config = { mounts: [{ id: 'm' }], agentWorkspace: 'C:\\w', mcpConfigFiles: ['x'] };
    writeBoard({ hosts: [{ id: 'h', label: 'h', host: 'a.b', user: null, port: null, identityFile: null }] });
    expect(state.config.mounts).toEqual([{ id: 'm' }]);
    expect(state.config.agentWorkspace).toBe('C:\\w');
    expect(state.config.mcpConfigFiles).toEqual(['x']);
    expect(state.config.commands).toBeUndefined();
    expect((state.config.sshHosts as unknown[]).length).toBe(1);
  });
});

describe('last runs', () => {
  it('round-trips, caps stored output and clears', () => {
    saveRun('a', run({ outputTail: 'y'.repeat(MAX_STORED_OUTPUT + 500) }));
    saveRun('b', run({ runId: 'r2' }));
    const runs = readRuns();
    expect(Object.keys(runs).sort()).toEqual(['a', 'b']);
    expect(runs.a.outputTail.length).toBe(MAX_STORED_OUTPUT);
    clearRun('a');
    expect(Object.keys(readRuns())).toEqual(['b']);
  });

  it('survives a corrupt or odd file', () => {
    fs.writeFileSync(path.join(state.dir, 'command-runs.json'), '{ not json');
    expect(readRuns()).toEqual({});
    fs.writeFileSync(path.join(state.dir, 'command-runs.json'), JSON.stringify({ a: { runId: 1 }, b: run() }));
    expect(Object.keys(readRuns())).toEqual(['b']);
  });
});
