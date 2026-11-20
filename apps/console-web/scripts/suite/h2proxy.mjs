/**
 * An HTTP/2 TLS front for the sandboxed console, as the live console has (Traefik, h2): the browser then gets one
 * multiplexed connection instead of HTTP/1.1's six per host, so long-lived streams don't starve the page's calls in the
 * test when they wouldn't on the live console. Self-signed certificate (the suite's browser ignores HTTPS errors).
 * Streams responses through as they come (event streams stay open).
 */
import http2 from 'node:http2';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'host', 'http2-settings', 'te']);

export async function startH2Proxy(target, port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-suite-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=127.0.0.1', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' });
  const t = new URL(target);
  const server = http2.createSecureServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')), allowHTTP1: true }, (req, res) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!k.startsWith(':') && !HOP.has(k)) headers[k] = v;
    headers.host = t.host;
    const up = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers }, (ur) => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(ur.statusCode ?? 502, out);
      ur.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } });
    res.on('close', () => up.destroy()); // the browser went away (or the answer is done)
    req.pipe(up);
  });
  const sessions = new Set();
  server.on('session', (x) => { sessions.add(x); x.on('close', () => sessions.delete(x)); });
  const sockets = new Set();
  server.on('secureConnection', (x) => { sockets.add(x); x.on('close', () => sockets.delete(x)); });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  // close: stop listening and drop what is still open (held-open event streams never end on their own)
  const close = () => new Promise((r) => { server.close(() => r()); for (const x of sessions) x.destroy(); for (const x of sockets) x.destroy(); setTimeout(r, 2000).unref(); });
  return { url: `https://127.0.0.1:${server.address().port}`, close };
}
