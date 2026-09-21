import type { CommandLogEntry } from '../shared/types';
import { randomUUID } from 'node:crypto';

const MAX_ENTRIES = 80;
const entries: CommandLogEntry[] = [];

export function appendCommandLog(input: {
  serviceId?: string | null;
  actionId?: string | null;
  command: string;
  ok: boolean;
  detail?: string | null;
}): CommandLogEntry {
  const entry: CommandLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    serviceId: input.serviceId ?? null,
    actionId: input.actionId ?? null,
    command: input.command,
    ok: input.ok,
    detail: input.detail ?? null,
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return entry;
}

export function getCommandLog(): CommandLogEntry[] {
  return [...entries];
}

export function clearCommandLog(): void {
  entries.length = 0;
}
