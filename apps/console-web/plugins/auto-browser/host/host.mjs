#!/usr/bin/env node
/**
 * Browser host: headless Chromium on the VPS behind a small HTTP + WebSocket API. The console plugin's server part is
 * its only client (it relays the live view and exposes REST/MCP/CLI). Runs in its own container (Dockerfile here) or
 * locally: `node host.mjs` with playwright-core resolvable (or AXF_PLAYWRIGHT=<path to playwright-core/index.mjs>).
 *
 *   GET    /health                               status, sessions, memory
 *   GET    /sessions                             open browsers
 *   POST   /sessions                {workspace, device?, url?}   open (or return) a workspace's browser
 *   DELETE /sessions/<ws>                        close it (the profile stays on disk)
 *   POST   /sessions/<ws>/<command> {args}       run a command (navigate, click, type, extract, screenshot, …)
 *   GET    /sessions/<ws>/screenshot.png         the active tab as PNG (password fields masked)
 *   GET    /sessions/<ws>/downloads[/<name>]     downloaded files
 *   WS     /sessions/<ws>/live?device=           live view: frames + state out, input and commands in
 *
 * Env: PORT (7095), AXF_BROWSER_DATA (./data), AXF_BROWSER_TOKEN (bearer; required when set), AXF_BROWSER_MAX (3),
 * AXF_BROWSER_IDLE_MIN (30), AXF_BROWSER_ALLOW_PRIVATE (off).
 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { accept } from './ws.mjs';
import { Sessions, httpError, COMMAND_NAMES } from './sessions.mjs';

const MAX_BODY = 4 * 1024 * 1024;

export async function startHost(o = {}) {
  const port = Number(o.port ?? process.env.PORT ?? 7095);
  const token = o.token ?? process.env.AXF_BROWSER_TOKEN ?? '';
  const dataDir = resolve(o.dataDir ?? process.env.AXF_BROWSER_DATA ?? './data');
  const log = o.log ?? ((s) => console.log(`[browser-host] ${s}`));
  const pw = await import(o.playwright ?? process.env.AXF_PLAYWRIGHT ?? 'playwright-core');
  const chromium = pw.chromium ?? pw.default?.chromium;
  const sessions = new Sessions({ chromium, dataDir, max: Number(process.env.AXF_BROWSER_MAX || o.max || 3), idleMinutes: Number(process.env.AXF_BROWSER_IDLE_MIN || 30), log });
  const startedAt = new Date().toISOString();
  if (!token) log('AXF_BROWSER_TOKEN is not set: keep this port on a private network');

  const authed = (req, url) => {
    if (!token) return true;
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    const a = Buffer.from(got), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://host');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === '/health') return send(200, health());
      if (!authed(req, url)) return send(401, { detail: 'browser host token required' });
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[0] !== 'sessions') return send(404, { detail: 'not found' });
      if (parts.length === 1) {
        if (req.method === 'GET') return send(200, { sessions: sessions.list() });
        if (req.method === 'POST') { const b = await body(req); const s = await sessions.open(b.workspace, b); return send(200, { session: s.summary(), state: await s.snapshot() }); }
      }
      const ws = parts[1];
      if (parts.length === 2) {
        if (req.method === 'DELETE') { await sessions.close(ws); return send(200, { ok: true }); }
        if (req.method === 'GET') { const s = sessions.get(ws); return send(200, { session: s.summary(), state: await s.snapshot() }); }
      }
      const s = sessions.get(ws);
      if (parts[2] === 'screenshot.png' && req.method === 'GET') {
        const r = await s.run('screenshot', { fullPage: url.searchParams.get('full') === '1' });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        return res.end(Buffer.from(r.data, 'base64'));
      }
      if (parts[2] === 'downloads' && req.method === 'GET') {
        if (parts.length === 3) return send(200, { items: s.downloads() });
        const file = s.downloadPath(parts[3]);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(file).size, 'content-disposition': `attachment; filename="${parts[3].replace(/"/g, '')}"` });
        return createReadStream(file).pipe(res);
      }
      if (parts.length === 3 && req.method === 'POST') return send(200, await s.run(parts[2], await body(req)));
      send(404, { detail: 'not found' });
    } catch (e) {
      send(e.status || 500, { detail: e.message || String(e) });
    }
  });

  server.on('upgrade', async (req, socket) => {
    const url = new URL(req.url, 'http://host');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (!authed(req, url) || parts[0] !== 'sessions' || parts[2] !== 'live') { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    let s;
    try { s = await sessions.open(parts[1], { device: url.searchParams.get('device') || undefined }); }
    catch (e) { socket.end(`HTTP/1.1 ${e.status || 500} Error\r\n\r\n`); return; }
    const ws = accept(req, socket);
    if (!ws) return socket.destroy();
    ws.on('message', async (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      const cmd = m.t === 'cmd' ? m.cmd : m.t;
      if (!COMMAND_NAMES.includes(cmd)) return ws.send({ t: 'error', id: m.id, error: `unknown command "${cmd}"` });
      try {
        const result = await s.run(cmd, m.t === 'cmd' ? m.args : m);
        if (m.id) ws.send({ t: 'result', id: m.id, result });
      } catch (e) {
        ws.send({ t: 'error', id: m.id, cmd, error: e.message.split('\n')[0] });
      }
    });
    s.addViewer(ws);
  });

  function health() {
    const mem = process.memoryUsage();
    return { ok: true, service: 'axf-browser-host', startedAt, sessions: sessions.list().length, max: sessions.max, rssMb: Math.round(mem.rss / 1048576), commands: COMMAND_NAMES };
  }

  await new Promise((ok) => server.listen(port, o.host ?? '0.0.0.0', ok));
  log(`listening on ${server.address().port}, data ${dataDir}`);
  const stop = async () => { await sessions.closeAll(); await new Promise((ok) => server.close(ok)); };
  return { server, sessions, port: server.address().port, stop };
}

function body(req) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { fail(httpError(413, 'body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { fail(httpError(400, 'body must be JSON')); } });
    req.on('error', fail);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const h = await startHost();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => void h.stop().finally(() => process.exit(0)));
}
