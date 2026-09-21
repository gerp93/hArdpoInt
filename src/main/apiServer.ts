import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { app } from 'electron';
import { buildDashboardStatus } from './statusSnapshot';
import { clearCommandLog } from './commandLog';
import { killActiveGpuProcess } from './gpu';
import {
  addFromTemplate,
  deleteMount,
  listMountTemplates,
  runMountAction,
  saveMount,
} from './services';
import { scanLocalhostServices } from './scan';
import type { Mount } from '../shared/types';

const API_HOST = '127.0.0.1';
const API_PORT = 3921;

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.replace(/^::ffff:/i, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost';
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  // This server is loopback-only. Embeds (RolePlaymate / KVGenius) may send a
  // localhost Origin, a null/file Origin when packaged, or none — always allow.
  // Access-Control-Allow-Private-Network: Chromium's local-network access check
  // (embed hosts on :5173 → API on :3921) requires it on the preflight.
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Origin': origin && origin !== 'null' ? origin : '*',
    'Access-Control-Allow-Private-Network': 'true',
  };
  return headers;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(payload);
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

function rendererRoot(): string {
  return path.join(app.getAppPath(), 'dist', 'renderer');
}

function serveStaticFile(urlPath: string, res: http.ServerResponse): boolean {
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(rendererRoot(), safePath === '/' || safePath === '.' ? 'index.html' : safePath);
  if (!filePath.startsWith(rendererRoot())) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  res.writeHead(200, {
    'Content-Type': types[ext] ?? 'application/octet-stream',
    // Packaged embeds (RolePlaymate.exe / KVGenius) are file:// ancestors;
    // http://localhost:* does not cover those. Server is loopback-only, so *.
    ...(ext === '.html'
      ? { 'Content-Security-Policy': "frame-ancestors *" }
      : {}),
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

let server: http.Server | null = null;

export function getApiBaseUrl(): string {
  return `http://${API_HOST}:${API_PORT}`;
}

export function startApiServer(): void {
  if (server) return;

  server = http.createServer(async (req, res) => {
    const remote = req.socket.remoteAddress;
    if (!isLoopbackAddress(remote)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    const origin = req.headers.origin;
    const cors = corsHeaders(typeof origin === 'string' ? origin : undefined);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${API_HOST}`);

    try {
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const status = await buildDashboardStatus();
        sendJson(res, 200, status, cors);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/mounts/templates') {
        sendJson(res, 200, listMountTemplates(), cors);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/services/scan') {
        sendJson(res, 200, await scanLocalhostServices(), cors);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mounts/add-template') {
        const body = (await readJsonBody(req)) as {
          templateId?: string;
          name?: string;
          hostUrl?: string;
        };
        sendJson(
          res,
          200,
          addFromTemplate(body.templateId ?? '', {
            name: body.name,
            hostUrl: body.hostUrl,
          }),
          cors
        );
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mounts/action') {
        const body = (await readJsonBody(req)) as {
          mountId?: string;
          action?:
            | 'start'
            | 'stop'
            | { panelId: string; actionId: string; row?: Record<string, unknown> };
        };
        if (!body.action) {
          sendJson(res, 200, { status: 'error', message: 'action is required' }, cors);
          return;
        }
        sendJson(res, 200, await runMountAction(body.mountId ?? '', body.action), cors);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mounts/save') {
        const body = (await readJsonBody(req)) as Mount;
        sendJson(res, 200, saveMount(body), cors);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mounts/delete') {
        const body = (await readJsonBody(req)) as { mountId?: string };
        sendJson(res, 200, deleteMount(body.mountId ?? ''), cors);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/log/clear') {
        clearCommandLog();
        sendJson(res, 200, { status: 'ok' }, cors);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/gpu/kill') {
        const body = (await readJsonBody(req)) as { pid?: number };
        sendJson(res, 200, await killActiveGpuProcess(Number(body.pid)), cors);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/') {
        if (!app.isPackaged) {
          // Embed hosts iframe this URL; redirect to the Vite UI in dev.
          res.writeHead(302, {
            Location: 'http://127.0.0.1:5174/',
            ...cors,
            // Same as static HTML — allow file:// host apps to iframe the redirect target.
            'Content-Security-Policy': "frame-ancestors *",
          });
          res.end();
          return;
        }
        if (serveStaticFile('/index.html', res)) return;
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      if (req.method === 'GET' && app.isPackaged) {
        const assetPath = url.pathname;
        if (serveStaticFile(assetPath, res)) return;
      }

      res.writeHead(404, cors);
      res.end('Not found');
    } catch (error) {
      sendJson(
        res,
        500,
        { status: 'error', message: error instanceof Error ? error.message : String(error) },
        cors
      );
    }
  });

  server.listen(API_PORT, API_HOST, () => {
    console.log(`[hardpoint] API listening on http://${API_HOST}:${API_PORT}`);
  });
  server.on('error', (err) => {
    console.error(`[hardpoint] API failed to bind ${API_HOST}:${API_PORT}:`, err);
  });
}

export function stopApiServer(): void {
  if (!server) return;
  server.close();
  server = null;
}
