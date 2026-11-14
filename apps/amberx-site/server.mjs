#!/usr/bin/env node
/**
 * AmberX public site: landing page + waitlist API. Zero dependencies (plain Node ≥ 20).
 *
 *   PORT=8080 DATA_DIR=./data SITE_ADMIN_TOKEN=… PUBLIC_URL=https://amberxai.com node apps/amberx-site/server.mjs
 *
 * Public:  GET /  ·  GET /theme.css[?color=&style=]  ·  GET /api/site  ·  GET /api/health
 *          POST /api/waitlist {email, ref?}  ·  GET /api/waitlist/:code
 * Admin (Authorization: Bearer $SITE_ADMIN_TOKEN): see README.md (settings, waitlist list / export / remove).
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createSettings, bad } from './lib/settings.mjs';
import { loadThemes, themeList, themeCss } from './lib/theme.mjs';
import { createWaitlist } from './lib/waitlist.mjs';
import { renderPage } from './src/page.mjs';
import { renderAdmin } from './src/admin-page.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function createSite({ dataDir, bakedDir = join(HERE, 'baked'), adminToken = '', publicUrl = '' } = {}) {
  const themes = loadThemes(bakedDir);
  const settings = createSettings(dataDir, { themes });
  const waitlist = createWaitlist(dataDir, { boost: () => settings.get().referralBoost });
  const statics = {
    '/axf.css': [join(bakedDir, 'axf.css'), 'text/css'],
    '/site.css': [join(HERE, 'src/site.css'), 'text/css'],
    '/site.js': [join(HERE, 'src/site.js'), 'text/javascript'],
    '/admin.js': [join(HERE, 'src/admin.js'), 'text/javascript'],
  };
  const tokenHash = adminToken ? createHash('sha256').update(adminToken).digest() : null;
  const isAdmin = (req) => {
    if (!tokenHash) return false;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    return Boolean(m) && timingSafeEqual(createHash('sha256').update(m[1]).digest(), tokenHash);
  };
  const origin = (req) => publicUrl || `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const send = (status, body, type = 'application/json', extra = {}) => {
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const json = (status, body) => send(status, body);
    const body = async () => {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) throw Object.assign(new Error('body too large'), { status: 413 }); }
      try { return raw ? JSON.parse(raw) : {}; } catch { throw bad('body must be JSON'); }
    };

    try {
      // ---------- public ----------
      if (req.method === 'GET' && path === '/') {
        const tq = new URLSearchParams();
        for (const k of ['color', 'style']) if (url.searchParams.get(k)) tq.set(k, url.searchParams.get(k));
        return send(200, renderPage(settings.get(), { ref: url.searchParams.get('ref') ?? '', themeQuery: tq.toString() }), 'text/html');
      }
      if (req.method === 'GET' && statics[path]) {
        const [file, type] = statics[path];
        return send(200, readFileSync(file), type, { 'cache-control': 'public, max-age=300' });
      }
      if (req.method === 'GET' && path === '/theme.css') {
        const s = settings.get();
        return send(200, themeCss(themes, url.searchParams.get('color') ?? s.colorTheme, url.searchParams.get('style') ?? s.styleTheme, s), 'text/css');
      }
      if (req.method === 'GET' && path === '/api/health') return json(200, { ok: true });
      if (req.method === 'GET' && path === '/api/site') {
        const { referralBoost, ...pub } = settings.get();
        return json(200, { settings: pub, themes: themeList(themes), waitlist: { total: waitlist.count() } });
      }
      if (req.method === 'POST' && path === '/api/waitlist') {
        if (!settings.get().waitlistOpen) return json(403, { error: 'the waitlist is closed' });
        const b = await body();
        const r = waitlist.join({ email: b.email, ref: b.ref, ip: req.socket.remoteAddress });
        return json(r.created ? 201 : 200, publicStatus(r.entry, origin(req)));
      }
      let m = /^\/api\/waitlist\/([\w-]{4,32})$/.exec(path);
      if (req.method === 'GET' && m) {
        const e = waitlist.byCode(m[1]);
        return e ? json(200, publicStatus(e, origin(req))) : json(404, { error: 'unknown code' });
      }

      // ---------- admin ----------
      if (req.method === 'GET' && path === '/admin') return send(200, renderAdmin(), 'text/html');
      if (path.startsWith('/api/admin/')) {
        if (!tokenHash) return json(503, { error: 'admin API disabled: SITE_ADMIN_TOKEN is not set' });
        if (!isAdmin(req)) return json(401, { error: 'admin token required' });
        if (req.method === 'GET' && path === '/api/admin/settings') return json(200, { settings: settings.get(), themes: themeList(themes) });
        if (req.method === 'PUT' && path === '/api/admin/settings') return json(200, { settings: settings.set(await body()) });
        if (req.method === 'POST' && path === '/api/admin/settings/reset') return json(200, { settings: settings.reset() });
        if (req.method === 'GET' && path === '/api/admin/waitlist') {
          const q = url.searchParams.get('q') ?? '';
          const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 500);
          return json(200, { total: waitlist.count(), entries: waitlist.ranked({ q }).slice(0, limit).map((e) => adminEntry(e, origin(req))) });
        }
        if (req.method === 'GET' && path === '/api/admin/waitlist/stats') return json(200, waitlist.stats());
        if (req.method === 'GET' && path === '/api/admin/waitlist.csv') {
          return send(200, waitlist.csv(origin(req)), 'text/csv', { 'content-disposition': `attachment; filename="amberx-waitlist-${new Date().toISOString().slice(0, 10)}.csv"` });
        }
        m = /^\/api\/admin\/waitlist\/([\w-]{4,32})$/.exec(path);
        if (m && req.method === 'GET') { const e = waitlist.byCode(m[1]); return e ? json(200, adminEntry(e, origin(req))) : json(404, { error: 'unknown code' }); }
        if (m && req.method === 'DELETE') return waitlist.remove(m[1]) ? json(200, { removed: m[1] }) : json(404, { error: 'unknown code' });
        if (m && req.method === 'PATCH') {
          const b = await body();
          const e = waitlist.update(m[1], b);
          return e ? json(200, adminEntry(e, origin(req))) : json(404, { error: 'unknown code' });
        }
      }
      return json(404, { error: 'not found' });
    } catch (err) {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      return json(status, { error: status === 500 ? 'server error' : err.message });
    }
  }

  const publicStatus = (e, base) => ({
    code: e.code, position: waitlist.position(e.code), total: waitlist.count(), referrals: e.referrals,
    link: `${base}/?ref=${e.code}`,
  });
  const adminEntry = (e, base) => ({ ...publicStatus(e, base), email: e.email, joinedAt: e.joinedAt, referredBy: e.referredBy, status: e.status });

  return { handle, settings, waitlist, themes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bakedDir = process.env.BAKED_DIR ?? join(HERE, 'baked');
  if (!existsSync(join(bakedDir, 'themes.json'))) {
    console.error(`no baked themes in ${bakedDir}: run node apps/amberx-site/bake.mjs first`);
    process.exit(1);
  }
  const site = createSite({
    dataDir: process.env.DATA_DIR ?? join(HERE, 'data'),
    bakedDir,
    adminToken: process.env.SITE_ADMIN_TOKEN ?? '',
    publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  });
  const port = Number(process.env.PORT ?? 8080);
  createServer(site.handle).listen(port, () => console.log(`amberx-site on :${port}`));
}
