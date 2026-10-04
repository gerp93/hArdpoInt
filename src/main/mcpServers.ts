import { execFile } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import type { ActionResult, McpConfiguredServer, McpScanResult, McpServerInfo } from '../shared/types';
import { killProcessByPid } from './localServerProcess';

/**
 * Finds MCP servers on this PC and lets the user stop them.
 *
 * A "server" here is a local process, usually a stdio helper that an MCP client (Claude Desktop,
 * Claude Code, Cursor, ...) launched. Two sources are combined:
 *  - the servers each client's config declares (name, command, args; env values are never read), and
 *    matched to running processes by command line;
 *  - processes that look like MCP servers but are not declared anywhere (detected).
 * A server whose launching client has exited is flagged as orphaned.
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
      const rows = JSON.parse(out) as { p: number; pp: number; n: string; e: string | null; c: string | null; s: string | null }[];
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
  const out = await run(process.platform === 'win32' ? 'netstat' : 'lsof', process.platform === 'win32' ? ['-ano', '-p', 'TCP'] : ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
  if (process.platform === 'win32') {
    for (const line of out.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5 || parts[0].toUpperCase() !== 'TCP' || parts[3].toUpperCase() !== 'LISTENING') continue;
      const port = Number(parts[1].slice(parts[1].lastIndexOf(':') + 1));
      const pid = Number(parts[4]);
      if (Number.isInteger(port) && Number.isInteger(pid)) ports.set(pid, [...new Set([...(ports.get(pid) ?? []), port])]);
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
function collect(servers: unknown, declaredIn: string, into: Declared[]): void {
  if (!isRecord(servers)) return;
  for (const [name, def] of Object.entries(servers)) {
    if (!isRecord(def) || typeof def.command !== 'string') continue;
    const args = Array.isArray(def.args) ? def.args.filter((a): a is string => typeof a === 'string') : [];
    into.push({ name, declaredIn, command: def.command, args });
  }
}

function readDeclared(): Declared[] {
  const out: Declared[] = [];
  const home = os.homedir();

  // Claude Desktop (appData is %APPDATA% on Windows).
  collect(
    (readJson(path.join(app.getPath('appData'), 'Claude', 'claude_desktop_config.json')) as Record<string, unknown> | null)?.mcpServers,
    'Claude Desktop',
    out
  );

  // Claude Code: user-level servers plus each project's servers.
  const claudeCode = readJson(path.join(home, '.claude.json'));
  if (isRecord(claudeCode)) {
    collect(claudeCode.mcpServers, 'Claude Code', out);
    if (isRecord(claudeCode.projects)) {
      for (const project of Object.values(claudeCode.projects)) {
        if (isRecord(project)) collect(project.mcpServers, 'Claude Code', out);
      }
    }
  }

  const others: [string, string[]][] = [
    ['Cursor', [path.join(home, '.cursor', 'mcp.json')]],
    ['Windsurf', [path.join(home, '.codeium', 'windsurf', 'mcp_config.json')]],
    ['VS Code', [path.join(app.getPath('appData'), 'Code', 'User', 'mcp.json')]],
  ];
  for (const [label, files] of others) {
    for (const file of files) {
      const json = readJson(file);
      if (isRecord(json)) {
        collect(json.mcpServers, label, out);
        collect(json.servers, label, out);
      }
    }
  }

  // The same server is often declared by several clients; keep one row per name+command.
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = `${d.name}|${d.command}|${d.args.join(' ')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const norm = (value: string) => value.replace(/\\/g, '/').toLowerCase();
const baseName = (value: string) => norm(value).split('/').pop() ?? '';

/** Processes that launch MCP servers (clients), never reported as servers themselves. */
const CLIENT_PROCESS = /^(claude|code|cursor|windsurf|hardpoint|hardpoint-dev|electron|crashpad_handler|conhost|git|powershell|pwsh|explorer)(\.exe)?$/i;

/** Command-line shapes that identify an undeclared MCP server. */
const MCP_LOOKS_LIKE =
  /(@modelcontextprotocol\/|mcp-server|mcp_server|fastmcp|mcp-remote|[\\/]mcp[\\/][^\\/\s"']*\.(c|m)?js|\bmcp\.(c|m)?js\b|\bmcp\.py\b|-m\s+mcp\b|\bserver-mcp\b)/i;

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

export async function scanMcpServers(): Promise<McpScanResult> {
  const [procs, portsByPid] = await Promise.all([listProcesses(), listeningPortsByPid()]);
  const declared = readDeclared();
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const self = new Set([process.pid, process.ppid]);

  // pid -> declared server it belongs to (or null for "detected").
  const matched = new Map<number, Declared | null>();

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
    if (MCP_LOOKS_LIKE.test(p.cmd)) matched.set(p.pid, null);
  }

  // One row per tree: a process is a root when its parent is not part of the same match.
  const running: McpServerInfo[] = [];
  for (const [pid, decl] of matched) {
    const p = byPid.get(pid)!;
    const parentMatched = matched.has(p.ppid) && (matched.get(p.ppid) ?? null) === decl;
    if (parentMatched) continue;

    const group = [...matched].filter(([id]) => id === pid || isDescendant(id, pid, byPid)).map(([id]) => id);
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
  return { running, configured };
}

function isDescendant(pid: number, ancestor: number, byPid: Map<number, Proc>): boolean {
  for (let cur = byPid.get(pid), depth = 0; cur && depth < 12; cur = byPid.get(cur.ppid), depth++) {
    if (cur.ppid === ancestor) return true;
  }
  return false;
}

function derivedName(p: Proc): string {
  const m = p.cmd.match(/(@modelcontextprotocol\/[\w.-]+|mcp[-_][\w.-]+|[\w.-]*mcp[\w.-]*\.(?:c|m)?js|[\w.-]*mcp[\w.-]*\.py)/i);
  return m ? m[1] : p.name;
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
