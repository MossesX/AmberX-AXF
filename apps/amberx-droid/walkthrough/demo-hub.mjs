// The demo layer of the AmberX walkthrough recorder: every request the recording browser makes to axHub or the AmberX
// server goes through here first. Data (notes, voice notes, approvals) comes from the seed (seed.mts), never from the
// real hub; every write is answered here and never leaves the browser; the signed-in name is the demo one. Only the
// look (shared appearance settings) and the static app are read live. Anything else is logged and answered with an
// empty reply, so a page we didn't plan for shows an empty state rather than real data.
//
//   import { installDemoHub } from './demo-hub.mjs'; await installDemoHub(context, seed, log)

export const HUB = 'https://axhub.amberxai.com';
export const APP = 'https://amberx.amberxai.com';

const json = (route, body, status = 200, headers = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });

/** Demo answers for the AmberX server's own API (shapes from server/main.py). */
function appApi(seed) {
  const user = { name: seed.user, role: 'admin', perms: '*' };
  return {
    'GET /api/me': () => ({ wall: true, hub: HUB, user, admin: true }),
    'GET /api/health': () => ({ ok: true, app: 'amberx-droid' }),
    'GET /api/ai/status': () => ({ ok: true, provider: 'claude', model: 'claude (demo)', reason: '', checkedAt: new Date().toISOString(), answeredBy: 'demo' }),
    'GET /api/ai/config': () => ({
      profiles: [{ id: 'demo-claude', kind: 'claude-code', label: 'Claude plan', model: 'claude', baseUrl: '', enabled: true, hasKey: true, keySource: 'saved', pair: false, expiresAt: null, refreshError: null, health: { ok: true, at: new Date().toISOString(), ms: 900 } }],
      order: ['demo-claude'], active: 'demo-claude', claude: 'plan', keepAliveMin: 0, kinds: [],
    }),
    'GET /api/ai/molly/status': () => ({ ok: true, reason: '' }),
    'POST /api/ai/ask': () => ({ answer: 'You have two work tasks: send the launch email today (high priority) and review the landing page tomorrow. The launch moved to the 14th.' }),
    'POST /api/ai/summarize': () => ({ title: 'Print shop flyers', summary: 'Call the print shop about the flyers before Friday.', tags: ['errand'] }),
    'POST /api/ai/prompt': () => ({ answer: 'Here you go: a short, friendly reminder for the team about the launch on the 14th.' }),
    'POST /api/ai/molly': () => ({ answer: 'Sure. Open Settings, then Plugins, then Command center to change what I listen for. I can walk you through it.' }),
  };
}

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** A made-up stand-in for the hub's own approval page (shown inside AmberX's approval popup). */
function approvalPage(seed, id) {
  const a = seed.approvals.pending.find((p) => p.id === id) ?? {};
  return `<!doctype html><meta name="viewport" content="width=device-width"><title>Approval</title>
<style>body{font:15px system-ui,sans-serif;margin:0;padding:16px;background:#f6f6f8;color:#1c1c28}h1{font-size:18px;margin:0 0 8px}
.k{color:#666;font-size:13px;margin:12px 0 4px}pre{background:#1c1c28;color:#f3f3f7;padding:10px;border-radius:8px;white-space:pre-wrap}
.b{display:inline-block;padding:8px 14px;border-radius:8px;margin:12px 8px 0 0;font-weight:600}.ok{background:#2fbf71;color:#fff}.no{background:#e5484d;color:#fff}</style>
<h1>${esc(a.title || a.tool)}</h1><div class="k">Who asked</div><div>${esc(a.source?.who || 'Demo')}</div>
<div class="k">What it does</div><div>${esc(a.summary)}</div><div class="k">The code that runs</div><pre>${esc(a.tool)} ${esc(a.summary)}</pre>
<span class="b ok">Approve</span><span class="b no">Decline</span>`;
}

export async function installDemoHub(context, seed, log = []) {
  const files = new Map(Object.entries(seed.files).map(([k, v]) => [k, JSON.stringify(v)]));
  const tags = new Map();
  let ver = 1;
  const blocked = [];
  const note = (what) => { blocked.push(what); log.push(`  demo-hub: ${what}`); };

  await context.route(`${HUB}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const path = url.pathname;
    // the look is read live (no private data in it); every other data file is the seed
    if (path.startsWith('/data/shared/settings/')) {
      if (m === 'GET') return route.continue();
      note(`write kept in the browser: ${m} ${path}`);
      return json(route, { ok: true }, 200, { etag: `"demo-${ver++}"` });
    }
    if (path.startsWith('/data/')) {
      const key = path.slice('/data/'.length);
      if (m === 'GET') {
        if (!files.has(key)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: tags.get(key) ?? '"seed"' }, body: files.get(key) });
      }
      if (m === 'PUT' || m === 'POST') {
        files.set(key, req.postData() ?? '{}');
        const tag = `"demo-${ver++}"`;
        tags.set(key, tag);
        note(`saved in the demo store only: ${key}`);
        return json(route, { ok: true }, 200, { etag: tag });
      }
      return json(route, { ok: true });
    }
    if (path === '/auth/admin/approvals.json' || path === '/auth/api/approvals') return json(route, seed.approvals);
    const one = path.match(/^\/auth\/admin\/approvals\/([0-9a-f-]{36})$/);
    if (one && m === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: approvalPage(seed, one[1]) });
    if (path === '/auth/api/session') return json(route, { signedIn: true, admin: true, user: seed.user, csrf: 'demo' });
    if (path === '/data-events' || path.startsWith('/auth/api/jobs/')) return route.fulfill({ status: 204, body: '' });
    if (m !== 'GET' && m !== 'HEAD') { note(`blocked: ${m} ${path}`); return json(route, { ok: true, state: 'denied' }); }
    // fonts, icons and the hub's static pieces are fine; any other hub page would be real data: never shown
    if (/\.(css|js|woff2?|png|svg|ico)$/.test(path)) return route.continue();
    note(`hub page answered empty: ${path}`);
    return json(route, {});
  });

  const api = appApi(seed);
  await context.route(`${APP}/api/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    if (api[key]) return json(route, api[key]());
    // the walkthrough's own files are real (the published video; nothing private in them)
    if (req.method() === 'GET' && url.pathname.startsWith('/api/walkthrough/')) return route.continue();
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { note(`blocked: ${key}`); return json(route, { ok: true }); }
    // console plugins seen from AmberX (agents, chats, builds…): their real data never shows; the page gets an empty answer
    note(`api answered empty: ${key}`);
    return json(route, url.pathname.endsWith('/store') ? {} : []);
  });
  return { blocked, files };
}
