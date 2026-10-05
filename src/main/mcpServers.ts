import { execFile } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type {
  ActionResult,
  McpConfigSource,
  McpConfiguredServer,
  McpScanResult,
  McpServerInfo,
} from '../shared/types';
import { readConfig, writeConfig } from './config';
import { killProcessByPid } from './localServerProcess';

/**
 * Finds MCP servers on this PC and lets the user stop them.
 *
 * A "server" here is a local process, usually a stdio helper that an MCP client (Claude Desktop,
 * Claude Code, Cursor, ...) launched. Three sources are combined:
 *  - servers declared in config files (a built-in list of known apps, plus files the user adds),
 *    matched to running processes by command line (env values are never read);
 *  - processes whose command line looks like an MCP server;
 *  - helper processes (node, python, ...) launched directly by an MCP app that no config explains.
 * A server whose launching process has exited is flagged as orphaned.
 */

interface Proc {
  pid: number;
  ppid: number;
  name: string;
  exe: string;
  cmd: string;
  started: number | null;
}

interface Declared {
  name: string;
  declaredIn: string;
  command: string;
  args: string[];
}

type DetectedVia = 'pattern' | 'launcher';

function run(file: string, args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : typeof stdout === 'string' ? stdout : String(stdout))
    );
  });
}

async function listProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ p = $_.ProcessId; pp = $_.ParentProcessId; ' +
      'n = $_.Name; e = $_.ExecutablePath; c = $_.CommandLine; ' +
      's = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString("o") }) } } | ConvertTo-Json -Compress';
    const out = await run('powershell.exe', ['-NoProfile', '-Command', script], 25_000);
    try {
      const rows = JSON.parse(out) as {
        p: number;
        pp: number;
        n: string;
        e: string | null;
        c: string | null;
        s: string | null;
      }[];
      return (Array.isArray(rows) ? rows : [rows]).map((r) => ({
        pid: r.p,
        ppid: r.pp,
        name: r.n ?? '',
        exe: r.e ?? '',
        cmd: r.c ?? '',
        started: r.s ? Date.parse(r.s) : null,
      }));
    } catch {
      return [];
    }
  }
  const out = await run('ps', ['-eo', 'pid=,ppid=,comm=,args=']);
  return out.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), name: m[3], exe: '', cmd: m[4], started: null }] : [];
  });
}

async function listeningPortsByPid(): Promise<Map<number, number[]>> {
  const ports = new Map<number, number[]>();
  if (process.platform !== 'win32') return ports;
  const out = await run('netstat', ['-ano', '-p', 'TCP']);
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP' || parts[3].toUpperCase() !== 'LISTENING') continue;
    const port = Number(parts[1].slice(parts[1].lastIndexOf(':') + 1));
    const pid = Number(parts[4]);
    if (Number.isInteger(port) && Number.isInteger(pid)) {
      ports.set(pid, [...new Set([...(ports.get(pid) ?? []), port])]);
    }
  }
  return ports;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Collect name/command/args from an `mcpServers`-style object. Env values are deliberately ignored. */
function collect(servers: unknown, declaredIn: string, into: Declared[]): number {
  if (!isRecord(servers)) return 0;
  let added = 0;
  for (const [name, def] of Object.entries(servers)) {
    if (!isRecord(def) || typeof def.command !== 'string') continue;
    const args = Array.isArray(def.args) ? def.args.filter((a): a is string => typeof a === 'string') : [];
    into.push({ name, declaredIn, command: def.command, args });
    added++;
  }
  return added;
}

/** Servers from a config file in any of the common shapes (mcpServers, servers, Claude Code projects). */
function collectFrom(json: unknown, label: string, into: Declared[]): number {
  if (!isRecord(json)) return 0;
  let count = collect(json.mcpServers, label, into) + collect(json.servers, label, into);
  if (isRecord(json.projects)) {
    for (const project of Object.values(json.projects)) {
      if (isRecord(project)) count += collect(project.mcpServers, label, into);
    }
  }
  return count;
}

/** Where known apps keep their MCP server lists. Only locations that exist on this PC are read. */
function builtInConfigFiles(): [string, string][] {
  const home = os.homedir();
  const appData = app.getPath('appData');
  return [
    ['Claude Desktop', path.join(appData, 'Claude', 'claude_desktop_config.json')],
    ['Claude Code', path.join(home, '.claude.json')],
    ['Cursor', path.join(home, '.cursor', 'mcp.json')],
    ['Windsurf', path.join(home, '.codeium', 'windsurf', 'mcp_config.json')],
    ['VS Code', path.join(appData, 'Code', 'User', 'mcp.json')],
  ];
}

function customConfigFiles(): string[] {
  const files = readConfig().mcpConfigFiles;
  return Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
}

function readDeclared(): { declared: Declared[]; sources: McpConfigSource[] } {
  const out: Declared[] = [];
  const sources: McpConfigSource[] = [];
  const all: [string, string, boolean][] = [
    ...builtInConfigFiles().map(([label, file]): [string, string, boolean] => [label, file, true]),
    ...customConfigFiles().map((file): [string, string, boolean] => [
      `Custom: ${path.basename(path.dirname(file))}${path.sep}${path.basename(file)}`,
      file,
      false,
    ]),
  ];
  for (const [label, file, builtIn] of all) {
    const exists = fs.existsSync(file);
    const servers = exists ? collectFrom(readJson(file), label, out) : 0;
    sources.push({ label, path: file, exists, servers, builtIn });
  }

  // The same server is often declared by several apps; keep one row per name+command.
  const seen = new Set<string>();
  const declared = out.filter((d) => {
    const key = `${d.name}|${d.command}|${d.args.join(' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { declared, sources };
}

const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase();
const baseName = (value: string) => norm(value).split('/').pop() ?? '';

/** Processes that launch MCP servers (clients), never reported as servers themselves. */
const CLIENT_PROCESS =
  /^(claude|code|cursor|windsurf|hardpoint|hardpoint-dev|electron|crashpad_handler|conhost|git|powershell|pwsh|explorer)(\.exe)?$/i;

/** Command-line shapes that identify an undeclared MCP server. */
const MCP_LOOKS_LIKE =
  /(@modelcontextprotocol\/|mcp-server|mcp_server|fastmcp|mcp-remote|[\\/]mcp[\\/][^\\/\s"']*\.(c|m)?js|\bmcp\.(c|m)?js\b|\bmcp\.py\b|-m\s+mcp\b|\bserver-mcp\b)/i;

/** Runtimes MCP servers are typically written for; a bridge like wsl.exe is not one. */
const SERVER_RUNTIME = /^(node|npx|npm|python|pythonw|py|uv|uvx|deno|bun|bunx|dotnet)(\.exe)?$/i;
const RUNTIME_WORD = /\b(npx|node|python|pythonw|py|uvx|uv|deno|bun|bunx|dotnet)\b/i;

function clientLabel(p: Proc): string | null {
  const name = p.name.toLowerCase();
  const exe = norm(p.exe);
  if (name === 'claude.exe' || name === 'claude') {
    return exe.includes('/claude-code/') ? 'Claude Code' : 'Claude Desktop';
  }
  if (name.startsWith('cursor')) return 'Cursor';
  if (name === 'code.exe' || name === 'code') return 'VS Code';
  if (name.startsWith('windsurf')) return 'Windsurf';
  return null;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isDescendant(pid: number, ancestor: number, byPid: Map<number, Proc>): boolean {
  for (let cur = byPid.get(pid), depth = 0; cur && depth < 12; cur = byPid.get(cur.ppid), depth++) {
    if (cur.ppid === ancestor) return true;
  }
  return false;
}

function derivedName(p: Proc): string {
  const m = p.cmd.match(
    /(@modelcontextprotocol\/[\w.-]+|mcp[-_][\w.-]+|[\w.-]*mcp[\w.-]*\.(?:c|m)?js|[\w.-]*mcp[\w.-]*\.py)/i
  );
  if (m) return m[1];
  const script = p.cmd.match(/([\w.-]+\.(?:c|m)?js|[\w.-]+\.py)(?=["'\s]|$)/i);
  return script ? script[1] : p.name;
}

export async function scanMcpServers(): Promise<McpScanResult> {
  const [procs, portsByPid] = await Promise.all([listProcesses(), listeningPortsByPid()]);
  const { declared, sources } = readDeclared();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const self = new Set([process.pid, process.ppid]);

  // pid -> declared server it belongs to (null when detected), and how detected ones were found.
  const matched = new Map<number, Declared | null>();
  const via = new Map<number, DetectedVia>();

  for (const d of declared) {
    const tokens = d.args.filter((a) => !a.startsWith('-') && a.length > 3).map(norm);
    const commandName = baseName(d.command).replace(/\.exe$/, '');
    for (const p of procs) {
      if (self.has(p.pid) || CLIENT_PROCESS.test(p.name)) continue;
      const cmd = norm(p.cmd);
      // Declared args that name a script or package are specific enough to identify the process
      // (this also catches wrappers like cmd /c npx ...). With no such args, match the binary.
      const hit =
        tokens.length > 0
          ? tokens.every((t) => cmd.includes(t))
          : baseName(p.exe || p.name).replace(/\.exe$/, '') === commandName;
      if (hit) matched.set(p.pid, d);
    }
  }

  for (const p of procs) {
    if (matched.has(p.pid) || self.has(p.pid) || CLIENT_PROCESS.test(p.name)) continue;
    if (/--mcp-config|--mcp-debug/.test(p.cmd)) continue;
    if (MCP_LOOKS_LIKE.test(p.cmd)) {
      matched.set(p.pid, null);
      via.set(p.pid, 'pattern');
    }
  }

  // Helpers started directly by an MCP app's main process that no config or pattern explains.
  // Only typical server runtimes (or a cmd /c wrapper around one) count; the app's own Electron
  // children, Claude Code sessions and bridges like wsl.exe do not.
  const clientMain = new Set(
    procs
      .filter((p) => {
        const parent = byPid.get(p.ppid);
        return (
          clientLabel(p) !== null &&
          !/--type=/.test(p.cmd) &&
          !norm(p.exe).includes('/claude-code/') &&
          parent?.name.toLowerCase() !== p.name.toLowerCase()
        );
      })
      .map((p) => p.pid)
  );
  for (const p of procs) {
    if (matched.has(p.pid) || self.has(p.pid) || CLIENT_PROCESS.test(p.name)) continue;
    if (!clientMain.has(p.ppid) || /--type=/.test(p.cmd)) continue;
    const isWrapper = /^cmd(\.exe)?$/i.test(p.name) && /\/c\b/i.test(p.cmd) && RUNTIME_WORD.test(p.cmd);
    if (SERVER_RUNTIME.test(p.name) || isWrapper) {
      matched.set(p.pid, null);
      via.set(p.pid, 'launcher');
    }
  }

  // One row per tree: a process is a root when its parent is not part of the same match.
  const running: McpServerInfo[] = [];
  for (const [pid, decl] of matched) {
    const p = byPid.get(pid)!;
    const parentMatched = matched.has(p.ppid) && (matched.get(p.ppid) ?? null) === decl;
    if (parentMatched) continue;

    const group = [...matched]
      .filter(([id]) => id === pid || isDescendant(id, pid, byPid))
      .map(([id]) => id);
    const parent = byPid.get(p.ppid);
    const orphaned = !parent || (parent.started != null && p.started != null && parent.started > p.started);

    let client: string | null = null;
    for (let cur = parent, depth = 0; cur && depth < 8 && !client; cur = byPid.get(cur.ppid), depth++) {
      client = clientLabel(cur);
    }

    running.push({
      id: String(pid),
      name: decl?.name ?? derivedName(p),
      source: decl ? 'configured' : 'detected',
      detectedVia: decl ? null : (via.get(pid) ?? 'pattern'),
      declaredIn: decl?.declaredIn ?? null,
      pid,
      processCount: group.length,
      startedAt: p.started ? new Date(p.started).toISOString() : null,
      commandLine: truncate(p.cmd, 400),
      client: orphaned ? null : client,
      orphaned,
      ports: [...new Set(group.flatMap((id) => portsByPid.get(id) ?? []))].sort((a, b) => a - b),
    });
  }

  const configured: McpConfiguredServer[] = declared.map((d) => ({
    name: d.name,
    declaredIn: d.declaredIn,
    command: truncate([d.command, ...d.args].join(' '), 200),
    running: running.some((r) => r.source === 'configured' && r.name === d.name),
  }));

  running.sort((a, b) => Number(b.orphaned) - Number(a.orphaned) || a.name.localeCompare(b.name));
  return { running, configured, sources };
}

/** Stop one server (its whole process tree). Only pids that a fresh scan reports are accepted. */
export async function stopMcpServer(pid: number): Promise<ActionResult> {
  const scan = await scanMcpServers();
  if (!scan.running.some((s) => s.pid === pid)) {
    return { status: 'error', message: 'That process is no longer a running MCP server (refresh the list).' };
  }
  const result = await killProcessByPid(pid);
  return result.status === 'ok' ? { status: 'ok' } : { status: 'error', message: result.message };
}

/** Remember a config file to read for MCP servers. It must be a readable JSON file. */
export function addMcpConfigFile(file: string): ActionResult {
  const resolved = path.resolve(file);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { status: 'error', message: 'That file does not exist.' };
  }
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
    return { status: 'error', message: 'Pick a JSON config file (under 5 MB).' };
  }
  if (readJson(resolved) === null) {
    return { status: 'error', message: "That file isn't valid JSON." };
  }
  const known = new Set(customConfigFiles().map((f) => f.toLowerCase()));
  if (known.has(resolved.toLowerCase())) return { status: 'ok' };
  writeConfig({ ...readConfig(), mcpConfigFiles: [...customConfigFiles(), resolved] });
  return { status: 'ok' };
}

export function removeMcpConfigFile(file: string): ActionResult {
  const next = customConfigFiles().filter((f) => f.toLowerCase() !== file.toLowerCase());
  writeConfig({ ...readConfig(), mcpConfigFiles: next });
  return { status: 'ok' };
}
