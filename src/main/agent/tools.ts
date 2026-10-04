import * as fs from 'fs';
import { z } from 'zod';
import type { Mount } from '../../shared/mountSchema';
import { canStartMount, isHttpUrl, normalizeMount } from '../../shared/mountSchema';
import { getCommandLog } from '../commandLog';
import { entriesRunningUnder } from '../localServerProcess';
import { scanLocalhostServices } from '../scan';
import {
  deleteMount,
  listMounts,
  readTemplateExamples,
  runMountAction,
  saveMount,
} from '../services';
import { probeMount, probeTcp } from '../statusSnapshot';
import { dangerousCommandReason } from './policy';
import type { AgentSdk } from './sdk';

export const SERVER_NAME = 'hardpoint';

/** Tools that only read state — no approval needed. */
export const READ_ONLY_TOOLS = [
  'list_mounts',
  'get_mount_status',
  'scan_services',
  'list_templates',
  'validate_mount',
  'check_url',
  'check_tcp_port',
  'list_processes_under',
  'get_command_log',
].map((name) => `mcp__${SERVER_NAME}__${name}`);

const mountShape = {
  id: z.string().describe('Short unique slug, e.g. "comfyui". Reusing an existing id updates that mount.'),
  name: z.string().describe('Card title shown on the dashboard.'),
  hostUrl: z
    .string()
    .nullable()
    .describe('http(s) URL on this PC, or null for servers without HTTP (e.g. UDP game servers).'),
  launch: z.object({
    mode: z.enum(['folder', 'path', 'unset']),
    cwd: z.string().nullable().describe('Folder Start runs from (mode "folder"); null otherwise.'),
  }),
  start: z
    .object({
      type: z.literal('shell'),
      command: z.string().describe('Run through cmd.exe /c, detached, with cwd = launch.cwd.'),
      preview: z.string().optional(),
      cwdRequired: z.boolean().optional().describe('True when the command needs launch.cwd (relative paths).'),
    })
    .nullable(),
  stop: z
    .object({
      type: z.enum(['port', 'process', 'shell']),
      port: z.number().int().optional().describe('For type "port": TCP port to free.'),
      command: z.string().optional().describe('For type "shell".'),
      preview: z.string().optional(),
      afterShell: z.array(z.string()).optional().describe('Extra shell commands run after a port stop.'),
    })
    .nullable(),
  probe: z
    .object({
      type: z.enum(['process', 'tcp']),
      port: z.number().int().optional().describe('For type "tcp".'),
    })
    .nullable()
    .describe('How the card knows it is up. null = HTTP GET on hostUrl.'),
  open: z
    .object({
      url: z.string().describe('http(s) URL the Open button opens, e.g. the service web UI.'),
      label: z.string().optional(),
    })
    .nullable()
    .describe('Adds an Open button to the card. null when the service has no web UI.'),
  help: z
    .object({ when: z.enum(['startMissing', 'launchUnset', 'always']), text: z.string() })
    .nullable(),
  panels: z.array(
    z.object({
      id: z.string(),
      when: z.enum(['reachable', 'always']).optional(),
      list: z.object({
        method: z.literal('GET'),
        path: z.string(),
        items: z.string().describe('Dot path to the array in the JSON response.'),
        columns: z
          .array(
            z.object({
              header: z.string(),
              from: z.string(),
              format: z.enum(['bytes', 'text']).optional(),
            })
          )
          .min(1),
        emptyText: z.string().optional(),
      }),
      actions: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          scope: z.enum(['row', 'panel']),
          method: z.enum(['GET', 'POST', 'DELETE']),
          path: z.string(),
          body: z.unknown().optional(),
          foreach: z.literal('row').optional(),
          enabledWhen: z.literal('panelHasRows').optional(),
        })
      ),
    })
  ),
};

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * Normalize a mount and list problems. `warnings` are things that would make it not work;
 * `blockers` are commands the Assistant is not allowed to put in a mount at all.
 */
export function checkMount(raw: unknown): {
  mount: Mount | null;
  warnings: string[];
  blockers: string[];
} {
  const mount = normalizeMount(raw);
  if (!mount) return { mount: null, warnings: ['Not a valid mount (needs id and name).'], blockers: [] };

  const warnings: string[] = [];
  const blockers: string[] = [];
  const commands: [string, string | undefined][] = [
    ['start.command', mount.start?.command],
    ['stop.command', mount.stop?.command],
    ...(mount.stop?.afterShell ?? []).map((c): [string, string] => ['stop.afterShell', c]),
  ];
  for (const [field, command] of commands) {
    const reason = command ? dangerousCommandReason(command) : null;
    if (reason) blockers.push(`${field} is not allowed (${reason}): ${command}`);
  }
  const rawOpen = (raw as { open?: { url?: unknown } | null } | null)?.open;
  if (rawOpen && !mount.open) {
    warnings.push(`open.url must be an http(s) URL; got: ${String(rawOpen.url)}`);
  }
  if (mount.open && !isHttpUrl(mount.open.url)) {
    warnings.push('open.url is not an http(s) URL.');
  }
  const cwd = mount.launch.cwd?.trim();

  if (mount.launch.mode === 'folder') {
    if (!cwd) warnings.push('launch.mode is "folder" but launch.cwd is empty.');
    else if (!fs.existsSync(cwd)) warnings.push(`launch.cwd does not exist: ${cwd}`);
  }
  if (!mount.start) warnings.push('No start command: the card will have no Start button.');
  else {
    if (/^\s*echo\b/i.test(mount.start.command)) warnings.push('start.command is a placeholder (echo).');
    if (mount.start.cwdRequired && !cwd) warnings.push('start.cwdRequired is true but there is no launch.cwd.');
    if (!canStartMount(mount)) warnings.push('canStart is false: the Start button would be hidden as configured.');
  }
  if (!mount.stop) warnings.push('No stop method: the card will have no Stop button.');
  else if (mount.stop.type === 'process' && !cwd) {
    warnings.push('stop.type "process" needs launch.cwd (it kills processes running from that folder).');
  } else if (mount.stop.type === 'port' && !mount.stop.port && !mount.hostUrl) {
    warnings.push('stop.type "port" needs stop.port or a hostUrl with a port.');
  }
  if (mount.probe?.type === 'process' && (mount.launch.mode !== 'folder' || !cwd)) {
    warnings.push('probe "process" needs launch.mode "folder" with a launch.cwd; status would show unknown.');
  }
  if (!mount.probe && !mount.hostUrl) {
    warnings.push('No probe and no hostUrl: the card cannot tell whether the server is up.');
  }
  if (mount.hostUrl && !isLoopbackUrl(mount.hostUrl)) {
    warnings.push('hostUrl is not on this PC; Stop and the probe only make sense for local servers.');
  }
  return { mount, warnings, blockers };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The Hardpoint tools, hosted in-process so they call mount code directly. */
export function createHardpointServer(sdk: AgentSdk) {
  const { tool, createSdkMcpServer } = sdk;
  const readOnly = { annotations: { readOnlyHint: true } };

  const findMount = (id: string) => listMounts().find((m) => m.id === id);

  return createSdkMcpServer({
    name: SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        'list_mounts',
        'List the mounts (dashboard cards) already configured, with whether each is up right now (up: true/false/null = unknown).',
        {},
        async () => {
          const mounts = listMounts();
          const up = await Promise.all(mounts.map((m) => probeMount(m)));
          return ok(mounts.map((m, i) => ({ ...m, up: up[i] })));
        },
        readOnly
      ),
      tool(
        'get_mount_status',
        'Is this mount up? With waitSeconds, polls until it is up or the time runs out (use after start_mount).',
        { id: z.string(), waitSeconds: z.number().int().min(0).max(60).optional() },
        async ({ id, waitSeconds }) => {
          const mount = findMount(id);
          if (!mount) return fail(`No mount with id "${id}".`);
          const deadline = Date.now() + (waitSeconds ?? 0) * 1000;
          let up = await probeMount(mount);
          while (up !== true && Date.now() < deadline) {
            await sleep(1500);
            up = await probeMount(mount);
          }
          return ok({ id, up });
        },
        readOnly
      ),
      tool(
        'scan_services',
        'Scan well-known local ports on 127.0.0.1 for HTTP/TCP services that are running but not yet on the dashboard.',
        {},
        async () => ok(await scanLocalhostServices()),
        readOnly
      ),
      tool(
        'list_templates',
        'Worked examples of complete mounts (Ollama, Chatterbox, ComfyUI, a Wreckfest 2 UDP server, a generic one). Read these to match the schema and conventions.',
        {},
        async () => ok(readTemplateExamples()),
        readOnly
      ),
      tool(
        'validate_mount',
        'Check a mount without saving it. Returns the normalized mount plus warnings about anything that would not work. Always run this before save_mount.',
        { mount: z.object(mountShape) },
        async ({ mount }) => {
          const { mount: normalized, warnings, blockers } = checkMount(mount);
          return normalized
            ? ok({ ok: warnings.length === 0 && blockers.length === 0, warnings, blockers, mount: normalized })
            : fail(warnings.join('\n'));
        },
        readOnly
      ),
      tool(
        'check_url',
        'HTTP GET a URL on this PC (localhost/127.0.0.1 only) and return the status and the start of the body. Use it to confirm a port, a health path, or a list endpoint for a panel.',
        { url: z.string() },
        async ({ url }) => {
          if (!isLoopbackUrl(url)) return fail('check_url only works on localhost / 127.0.0.1.');
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
            const body = (await response.text().catch(() => '')).slice(0, 600);
            return ok({
              status: response.status,
              contentType: response.headers.get('content-type'),
              body,
            });
          } catch (e) {
            return ok({ reachable: false, error: e instanceof Error ? e.message : String(e) });
          }
        },
        readOnly
      ),
      tool(
        'check_tcp_port',
        'Is a TCP port on 127.0.0.1 accepting connections? (Cannot test UDP.)',
        { port: z.number().int().min(1).max(65535) },
        async ({ port }) => ok({ port, open: await probeTcp(port) }),
        readOnly
      ),
      tool(
        'list_processes_under',
        'List running processes whose executable lives under a folder. This is exactly what a "process" probe and a "process" stop act on, so use it to confirm they would find (and only find) the server.',
        { dir: z.string() },
        async ({ dir }) => ok(await entriesRunningUnder(dir, true)),
        readOnly
      ),
      tool(
        'get_command_log',
        'Recent Start/Stop commands Hardpoint ran and their results. Check this when a Start did not work.',
        { limit: z.number().int().min(1).max(50).optional() },
        async ({ limit }) => ok(getCommandLog().slice(-(limit ?? 15))),
        readOnly
      ),
      tool(
        'save_mount',
        'Create or update a mount (a dashboard card). Validates first and refuses an invalid mount. The user reviews and approves the JSON before it is saved.',
        { mount: z.object(mountShape) },
        async ({ mount }) => {
          const { mount: normalized, warnings, blockers } = checkMount(mount);
          if (!normalized) return fail(warnings.join('\n'));
          if (blockers.length > 0) return fail(`Not saved. ${blockers.join(' ')}`);
          const result = saveMount(normalized);
          return result.status === 'ok'
            ? ok({ saved: normalized.id, warnings })
            : fail(result.message);
        }
      ),
      tool(
        'delete_mount',
        'Remove a mount from the dashboard (does not touch the server or its files).',
        { id: z.string() },
        async ({ id }) => {
          const result = deleteMount(id);
          return result.status === 'ok' ? ok({ deleted: id }) : fail(result.message);
        },
        { annotations: { destructiveHint: true } }
      ),
      tool(
        'start_mount',
        "Run a mount's Start command. It returns right away; call get_mount_status with waitSeconds to see whether it came up.",
        { id: z.string() },
        async ({ id }) => {
          const result = await runMountAction(id, 'start');
          return result.status === 'ok' ? ok(result) : fail(result.message);
        }
      ),
      tool(
        'stop_mount',
        "Run a mount's Stop method (kills the server's process).",
        { id: z.string() },
        async ({ id }) => {
          const result = await runMountAction(id, 'stop');
          return result.status === 'ok' ? ok(result) : fail(result.message);
        },
        { annotations: { destructiveHint: true } }
      ),
    ],
  });
}
