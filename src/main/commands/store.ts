import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { LastRun, RunOutcome, SavedCommand, SshHost } from '../../shared/commandSchema';
import { MAX_STORED_OUTPUT, normalizeCommand, normalizeHost } from '../../shared/commandSchema';
import { readConfig, writeConfig } from '../config';

const OUTCOMES: RunOutcome[] = ['ok', 'failed', 'timeout', 'cancelled', 'error'];

export function readBoard(): { commands: SavedCommand[]; hosts: SshHost[] } {
  const config = readConfig();
  const commands = (Array.isArray(config.commands) ? config.commands : [])
    .map(normalizeCommand)
    .filter((c): c is SavedCommand => c !== null);
  const hosts = (Array.isArray(config.sshHosts) ? config.sshHosts : [])
    .map(normalizeHost)
    .filter((h): h is SshHost => h !== null);
  return { commands, hosts };
}

/** Replace the saved commands and/or hosts; every other key in the config is left alone. */
export function writeBoard(next: { commands?: SavedCommand[]; hosts?: SshHost[] }): void {
  const config = readConfig();
  writeConfig({
    ...config,
    ...(next.commands ? { commands: next.commands } : {}),
    ...(next.hosts ? { sshHosts: next.hosts } : {}),
  });
}

function runsPath(): string {
  return path.join(app.getPath('userData'), 'command-runs.json');
}

function asLastRun(raw: unknown): LastRun | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.runId !== 'string' || typeof r.startedAt !== 'string') return null;
  if (!OUTCOMES.includes(r.outcome as RunOutcome)) return null;
  return {
    runId: r.runId,
    startedAt: r.startedAt,
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
    exitCode: typeof r.exitCode === 'number' ? r.exitCode : null,
    outcome: r.outcome as RunOutcome,
    outputTail: typeof r.outputTail === 'string' ? r.outputTail.slice(-MAX_STORED_OUTPUT) : '',
    display: typeof r.display === 'string' ? r.display : '',
  };
}

/** Last run of each command, kept apart from the config so output never lands in app-config.json. */
export function readRuns(): Record<string, LastRun> {
  try {
    const raw = JSON.parse(fs.readFileSync(runsPath(), 'utf-8').replace(/^﻿/, '')) as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const runs: Record<string, LastRun> = {};
    for (const [id, value] of Object.entries(raw)) {
      const run = asLastRun(value);
      if (run) runs[id] = run;
    }
    return runs;
  } catch {
    return {};
  }
}

function writeRuns(runs: Record<string, LastRun>): void {
  const file = runsPath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(runs, null, 2));
  fs.renameSync(tmp, file);
}

export function saveRun(commandId: string, run: LastRun): void {
  const runs = readRuns();
  runs[commandId] = { ...run, outputTail: run.outputTail.slice(-MAX_STORED_OUTPUT) };
  writeRuns(runs);
}

export function clearRun(commandId: string): void {
  const runs = readRuns();
  if (commandId in runs) {
    delete runs[commandId];
    writeRuns(runs);
  }
}
