/**
 * Browser sessions on the VPS. One session per workspace = one persistent Chromium profile (cookies and logins kept in
 * <data>/profiles/<workspace>), with tabs, a device size, a CDP screencast of the active tab sent to every viewer, and
 * one command dispatcher (`run`) shared by REST, the live view's websocket and, later, the recorder and the runner.
 */
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { blockedReason, normaliseUrl, allowPrivate } from './netguard.mjs';

export const DEVICES = {
  desktop: { width: 1280, height: 800, scale: 1, mobile: false, ua: '' },
  phone: {
    width: 390, height: 844, scale: 2, mobile: true,
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  },
  tablet: { width: 820, height: 1180, scale: 2, mobile: true, ua: '' },
};

const WS_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MAX_BUFFERED = 2 * 1024 * 1024; // skip frames for a viewer that can't keep up
const SELECTOR_TIMEOUT = 10_000;

export function workspaceId(raw) {
  const id = String(raw || 'default').toLowerCase();
  if (!WS_ID.test(id)) throw httpError(400, 'workspace must be 1-40 characters: a-z, 0-9, - or _');
  return id;
}

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

export class Sessions {
  /** @param {{ chromium: any, dataDir: string, max?: number, idleMinutes?: number, log?: (s: string) => void }} o */
  constructor(o) {
    this.chromium = o.chromium;
    this.dataDir = o.dataDir;
    this.max = o.max ?? 3;
    this.idleMs = (o.idleMinutes ?? 30) * 60_000;
    this.log = o.log ?? (() => {});
    /** @type {Map<string, Session>} */
    this.map = new Map();
    this.opening = new Map();
    this.timer = setInterval(() => this.reap(), 60_000);
    this.timer.unref?.();
  }

  list() { return [...this.map.values()].map((s) => s.summary()); }

  get(id) {
    const s = this.map.get(workspaceId(id));
    if (!s) throw httpError(404, `no open browser for workspace "${id}"`);
    return s;
  }

  /** Open (or return) the session for a workspace. */
  async open(id, opts = {}) {
    const ws = workspaceId(id);
    if (this.map.has(ws)) return this.map.get(ws);
    if (this.opening.has(ws)) return this.opening.get(ws);
    if (this.map.size >= this.max) throw httpError(429, `at most ${this.max} browsers run at once; close one first`);
    const p = (async () => {
      const dir = join(this.dataDir, 'profiles', ws);
      const downloads = join(this.dataDir, 'downloads', ws);
      const partial = join(this.dataDir, 'tmp', ws); // Playwright's own temp files, so the downloads list stays clean
      for (const d of [dir, downloads, partial]) mkdirSync(d, { recursive: true, mode: 0o700 });
      const dev = DEVICES[opts.device] ?? DEVICES.desktop;
      const context = await this.chromium.launchPersistentContext(dir, {
        headless: true,
        viewport: { width: dev.width, height: dev.height },
        deviceScaleFactor: 1,
        acceptDownloads: true,
        downloadsPath: partial,
        args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
      });
      const s = new Session(ws, context, { downloads, log: this.log, device: opts.device in DEVICES ? opts.device : 'desktop' });
      await s.init(opts.url);
      this.map.set(ws, s);
      context.on('close', () => { this.map.delete(ws); s.closed = true; s.broadcast({ t: 'closed' }); });
      this.log(`open ${ws}`);
      return s;
    })();
    this.opening.set(ws, p);
    try { return await p; } finally { this.opening.delete(ws); }
  }

  async close(id) {
    const s = this.get(id);
    this.map.delete(s.id);
    await s.close();
    this.log(`close ${s.id}`);
  }

  async closeAll() { await Promise.all([...this.map.keys()].map((id) => this.close(id).catch(() => {}))); clearInterval(this.timer); }

  /** Close sessions nobody watched or drove for idleMinutes. */
  reap() {
    const now = Date.now();
    for (const s of this.map.values()) {
      if (s.viewers.size === 0 && now - s.lastUsed > this.idleMs) { this.log(`idle close ${s.id}`); void this.close(s.id).catch(() => {}); }
    }
  }
}

class Session {
  constructor(id, context, o) {
    this.id = id;
    this.context = context;
    this.downloadsDir = o.downloads;
    this.log = o.log;
    this.device = o.device;
    this.tabs = new Map(); // tab id -> page
    this.nextTab = 1;
    this.active = '';
    this.viewers = new Set();
    this.listeners = new Set(); // in-process subscribers (recorder, runner)
    this.cdp = null;
    this.castPage = null;
    this.lastUsed = Date.now();
    this.createdAt = new Date().toISOString();
    this.closed = false;
    this.quality = 60;
  }

  async init(url) {
    if (!allowPrivate()) {
      await this.context.route('**/*', (route) => {
        const req = route.request();
        const why = blockedReason(req.url());
        if (!why) return route.continue();
        if (req.isNavigationRequest()) this.broadcast({ t: 'blocked', url: req.url(), reason: why });
        return route.abort('blockedbyclient');
      });
    }
    this.context.on('page', (page) => this.adopt(page, true));
    const pages = this.context.pages();
    for (const p of pages) this.adopt(p, false);
    if (!this.active) await this.context.newPage();
    await this.applyDevice(this.device);
    if (url) await this.run('navigate', { url });
  }

  adopt(page, activate) {
    if ([...this.tabs.values()].includes(page)) return;
    const id = `t${this.nextTab++}`;
    this.tabs.set(id, page);
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) this.state(); });
    page.on('load', () => this.state());
    page.on('close', () => {
      this.tabs.delete(id);
      if (this.active === id) { const next = [...this.tabs.keys()].pop() || ''; this.active = ''; if (next) void this.activate(next); }
      this.state();
    });
    page.on('download', (d) => void this.saveDownload(d));
    page.on('dialog', (d) => { this.broadcast({ t: 'dialog', tab: id, kind: d.type(), message: d.message() }); void d.dismiss().catch(() => {}); });
    page.on('console', (m) => this.emit({ t: 'console', tab: id, level: m.type(), text: m.text().slice(0, 2000) }));
    page.on('pageerror', (e) => this.emit({ t: 'console', tab: id, level: 'error', text: String(e?.message || e).slice(0, 2000) }));
    if (activate || !this.active) void this.activate(id);
    else this.state();
  }

  page(tab) {
    const id = tab || this.active;
    const p = this.tabs.get(id);
    if (!p) throw httpError(404, `no tab "${id}"`);
    return p;
  }

  async activate(id) {
    const page = this.tabs.get(id);
    if (!page) throw httpError(404, `no tab "${id}"`);
    this.active = id;
    await page.bringToFront().catch(() => {});
    await this.applyDevice(this.device, page);
    if (this.viewers.size) await this.startCast();
    this.state();
  }

  async applyDevice(name, only) {
    const dev = DEVICES[name] ?? DEVICES.desktop;
    this.device = DEVICES[name] ? name : 'desktop';
    for (const page of only ? [only] : this.tabs.values()) {
      await page.setViewportSize({ width: dev.width, height: dev.height }).catch(() => {});
      const c = await this.context.newCDPSession(page).catch(() => null);
      if (!c) continue;
      const ua = dev.ua || (await page.evaluate(() => navigator.userAgent).catch(() => '')).replace(/HeadlessChrome/g, 'Chrome');
      await c.send('Emulation.setUserAgentOverride', { userAgent: ua }).catch(() => {});
      await c.send('Emulation.setTouchEmulationEnabled', { enabled: dev.mobile, maxTouchPoints: dev.mobile ? 5 : 0 }).catch(() => {});
      await c.detach().catch(() => {});
    }
  }

  // ---- live view ---------------------------------------------------------------------------------------------------

  addViewer(ws) {
    this.viewers.add(ws);
    this.lastUsed = Date.now();
    ws.on('close', () => { this.viewers.delete(ws); if (!this.viewers.size) void this.stopCast(); });
    ws.send({ t: 'hello', session: this.summary() });
    void this.startCast();
  }

  async startCast() {
    const page = this.tabs.get(this.active);
    if (!page || this.closed) return;
    if (this.castPage === page && this.cdp) return;
    await this.stopCast();
    const dev = DEVICES[this.device] ?? DEVICES.desktop;
    const cdp = await this.context.newCDPSession(page);
    this.cdp = cdp;
    this.castPage = page;
    cdp.on('Page.screencastFrame', (f) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      const m = f.metadata || {};
      const msg = JSON.stringify({ t: 'frame', tab: this.active, data: f.data, w: m.deviceWidth, h: m.deviceHeight, sx: m.scrollOffsetX, sy: m.scrollOffsetY });
      for (const v of this.viewers) if (v.buffered < MAX_BUFFERED) v.send(msg);
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.quality, maxWidth: dev.width * 2, maxHeight: dev.height * 2, everyNthFrame: 1 }).catch((e) => this.log(`screencast: ${e.message}`));
  }

  async stopCast() {
    const c = this.cdp;
    this.cdp = null; this.castPage = null;
    if (c) { await c.send('Page.stopScreencast').catch(() => {}); await c.detach().catch(() => {}); }
  }

  /** Something to every viewer (the live view) and every in-process listener. */
  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const v of this.viewers) v.send(s);
    this.emit(msg);
  }

  /** Something only in-process listeners need (console lines): viewers get it too, they are cheap. */
  emit(msg) {
    for (const fn of this.listeners) { try { fn(msg); } catch { /* a listener never breaks the session */ } }
    if (msg.t === 'console') { const s = JSON.stringify(msg); for (const v of this.viewers) v.send(s); }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  state() {
    if (this.closed) return;
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => void this.snapshot().then((st) => this.broadcast({ t: 'state', ...st })).catch(() => {}), 50);
  }

  async snapshot() {
    const tabs = [];
    for (const [id, p] of this.tabs) tabs.push({ id, url: p.url(), title: await p.title().catch(() => ''), active: id === this.active });
    return { session: this.id, device: this.device, active: this.active, tabs, url: this.tabs.get(this.active)?.url() || '' };
  }

  summary() {
    return { id: this.id, device: this.device, active: this.active, tabs: this.tabs.size, viewers: this.viewers.size, createdAt: this.createdAt, lastUsed: new Date(this.lastUsed).toISOString() };
  }

  async saveDownload(d) {
    const name = basename(d.suggestedFilename() || 'download').replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'download';
    let file = join(this.downloadsDir, name);
    for (let i = 1; existsSync(file); i++) file = join(this.downloadsDir, name.replace(/(\.[^.]*)?$/, ` (${i})$1`));
    try { await d.saveAs(file); this.broadcast({ t: 'download', name: basename(file), url: d.url() }); }
    catch (e) { this.broadcast({ t: 'download', name, error: e.message }); }
  }

  downloads() {
    if (!existsSync(this.downloadsDir)) return [];
    return readdirSync(this.downloadsDir).map((name) => { const st = statSync(join(this.downloadsDir, name)); return { name, size: st.size, at: st.mtime.toISOString() }; })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  downloadPath(name) {
    const file = join(this.downloadsDir, basename(String(name)));
    if (!existsSync(file)) throw httpError(404, 'no such download');
    return file;
  }

  async close() {
    this.closed = true;
    await this.stopCast();
    for (const v of this.viewers) v.close();
    await this.context.close().catch(() => {});
  }

  /** True when typing goes into a password field (by selector, or the focused element for live typing). */
  async isSecretTarget(a) {
    if (a.secret) return true;
    const page = this.tabs.get(a.tab || this.active);
    if (!page) return false;
    const test = (e) => !!e && ((e.type || '').toLowerCase() === 'password' || /password|one-time-code/i.test(e.getAttribute?.('autocomplete') || ''));
    if (a.selector) return page.locator(String(a.selector)).first().evaluate(test, undefined, { timeout: 1500 }).catch(() => false);
    return page.evaluate(`(${test})(document.activeElement)`).catch(() => false);
  }

  // ---- commands ----------------------------------------------------------------------------------------------------

  /**
   * Run one command on the session. Same names and arguments over REST (`POST /sessions/<ws>/<cmd>`), the live view's
   * websocket (`{t: 'cmd', cmd, args}`) and every later caller. Input events from the live view (`mouse`, `wheel`,
   * `key`, `text`) use viewport CSS pixels.
   */
  async run(cmd, a = {}) {
    if (this.closed) throw httpError(410, 'this browser was closed');
    this.lastUsed = Date.now();
    const fn = COMMANDS[cmd];
    if (!fn) throw httpError(400, `unknown command "${cmd}"`);
    const secret = TYPING.has(cmd) && await this.isSecretTarget(a ?? {});
    const result = await fn(this, a ?? {});
    this.emit({ t: 'command', cmd, args: redactArgs(cmd, a, secret), tab: this.active, at: new Date().toISOString() });
    return result ?? { ok: true };
  }
}

function locate(s, a) {
  const page = s.page(a.tab);
  if (!a.selector) throw httpError(400, 'selector is required');
  return page.locator(String(a.selector)).first();
}

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const TYPING = new Set(['type', 'fill', 'text', 'key']);

/** Never echo what was typed into a password field (or anything marked secret) to listeners. */
function redactArgs(cmd, a, secret) {
  if (!a || typeof a !== 'object') return a;
  const out = { ...a, ...(secret ? { secret: true } : {}) };
  if (secret || /pass|secret|token/i.test(String(a.selector || ''))) {
    for (const k of ['text', 'value', 'key']) if (k in out) out[k] = '••••';
  }
  return out;
}

const COMMANDS = {
  state: (s) => s.snapshot(),
  navigate: async (s, a) => {
    const url = normaliseUrl(a.url);
    const why = blockedReason(url);
    if (why) throw httpError(403, `can't open ${url}: ${why}`);
    const page = s.page(a.tab);
    const r = await page.goto(url, { waitUntil: a.waitUntil || 'domcontentloaded', timeout: num(a.timeout, 30_000) }).catch((e) => { throw httpError(502, e.message.split('\n')[0]); });
    return { url: page.url(), status: r?.status() ?? null, title: await page.title().catch(() => '') };
  },
  back: async (s, a) => { await s.page(a.tab).goBack({ waitUntil: 'domcontentloaded' }).catch(() => null); return { url: s.page(a.tab).url() }; },
  forward: async (s, a) => { await s.page(a.tab).goForward({ waitUntil: 'domcontentloaded' }).catch(() => null); return { url: s.page(a.tab).url() }; },
  reload: async (s, a) => { await s.page(a.tab).reload({ waitUntil: 'domcontentloaded' }).catch(() => null); return { url: s.page(a.tab).url() }; },
  stop: async (s, a) => { await s.page(a.tab).evaluate(() => window.stop()).catch(() => {}); },
  newTab: async (s, a) => {
    const page = await s.context.newPage();
    const id = [...s.tabs].find(([, p]) => p === page)?.[0];
    if (a.url) await COMMANDS.navigate(s, { url: a.url, tab: id });
    return { tab: id };
  },
  closeTab: async (s, a) => {
    const page = s.page(a.tab);
    if (s.tabs.size === 1) { await page.goto('about:blank'); return { tab: s.active }; }
    await page.close();
  },
  activate: async (s, a) => { await s.activate(String(a.tab)); },
  device: async (s, a) => {
    if (!DEVICES[a.preset]) throw httpError(400, `device must be one of ${Object.keys(DEVICES).join(', ')}`);
    await s.applyDevice(a.preset);
    if (s.viewers.size) { await s.stopCast(); await s.startCast(); }
    s.state();
    return { device: s.device };
  },
  quality: async (s, a) => { s.quality = Math.max(20, Math.min(90, num(a.quality, 60))); if (s.viewers.size) { await s.stopCast(); await s.startCast(); } return { quality: s.quality }; },

  // live view input (viewport CSS pixels)
  mouse: async (s, a) => {
    const m = s.page(a.tab).mouse;
    const x = num(a.x, 0), y = num(a.y, 0), button = ['left', 'right', 'middle'].includes(a.button) ? a.button : 'left';
    if (a.action === 'move') return void (await m.move(x, y));
    if (a.action === 'down') { await m.move(x, y); return void (await m.down({ button, clickCount: num(a.clicks, 1) })); }
    if (a.action === 'up') { await m.move(x, y); return void (await m.up({ button, clickCount: num(a.clicks, 1) })); }
    await m.click(x, y, { button, clickCount: num(a.clicks, 1) });
  },
  wheel: async (s, a) => { const p = s.page(a.tab); await p.mouse.move(num(a.x, 0), num(a.y, 0)); await p.mouse.wheel(num(a.dx, 0), num(a.dy, 0)); },
  key: async (s, a) => {
    const k = s.page(a.tab).keyboard;
    if (!a.key) throw httpError(400, 'key is required');
    if (a.action === 'down') return void (await k.down(String(a.key)));
    if (a.action === 'up') return void (await k.up(String(a.key)));
    await k.press(String(a.key));
  },
  text: async (s, a) => { await s.page(a.tab).keyboard.insertText(String(a.text ?? '')); },

  // driving by selector (REST, MCP, CLI, later the runner)
  click: async (s, a) => {
    if (a.selector) return void (await locate(s, a).click({ timeout: num(a.timeout, SELECTOR_TIMEOUT), button: a.button || 'left', clickCount: num(a.clicks, 1) }));
    await COMMANDS.mouse(s, { ...a, action: 'click' });
  },
  hover: async (s, a) => { await locate(s, a).hover({ timeout: num(a.timeout, SELECTOR_TIMEOUT) }); },
  type: async (s, a) => {
    if (a.selector) return void (await locate(s, a).pressSequentially(String(a.text ?? ''), { delay: num(a.delay, 0), timeout: num(a.timeout, SELECTOR_TIMEOUT) }));
    await s.page(a.tab).keyboard.type(String(a.text ?? ''), { delay: num(a.delay, 0) });
  },
  fill: async (s, a) => { await locate(s, a).fill(String(a.value ?? a.text ?? ''), { timeout: num(a.timeout, SELECTOR_TIMEOUT) }); },
  press: async (s, a) => {
    if (a.selector) return void (await locate(s, a).press(String(a.key), { timeout: num(a.timeout, SELECTOR_TIMEOUT) }));
    await s.page(a.tab).keyboard.press(String(a.key));
  },
  select: async (s, a) => ({ selected: await locate(s, a).selectOption(a.values ?? a.value, { timeout: num(a.timeout, SELECTOR_TIMEOUT) }) }),
  check: async (s, a) => { await locate(s, a).setChecked(a.checked !== false, { timeout: num(a.timeout, SELECTOR_TIMEOUT) }); },
  scroll: async (s, a) => {
    if (a.selector) return void (await locate(s, a).scrollIntoViewIfNeeded({ timeout: num(a.timeout, SELECTOR_TIMEOUT) }));
    await s.page(a.tab).evaluate(([dx, dy]) => window.scrollBy(dx, dy), [num(a.dx, 0), num(a.dy, 400)]);
  },
  waitFor: async (s, a) => {
    if (a.selector) return void (await locate(s, a).waitFor({ state: a.state || 'visible', timeout: num(a.timeout, SELECTOR_TIMEOUT) }));
    if (a.url) return void (await s.page(a.tab).waitForURL(String(a.url), { timeout: num(a.timeout, SELECTOR_TIMEOUT) }));
    await s.page(a.tab).waitForTimeout(Math.min(num(a.ms, 1000), 60_000));
  },
  screenshot: async (s, a) => {
    const page = s.page(a.tab);
    const opt = { type: a.type === 'jpeg' ? 'jpeg' : 'png', fullPage: !!a.fullPage, timeout: num(a.timeout, 15_000) };
    if (opt.type === 'jpeg') opt.quality = num(a.quality, 70);
    // password fields are masked in every screenshot (recordings and thumbnails use this command too)
    opt.mask = [page.locator('input[type="password"]')];
    const buf = a.selector ? await locate(s, a).screenshot(opt) : await page.screenshot(opt);
    return { type: opt.type, data: buf.toString('base64') };
  },
  extract: async (s, a) => {
    const page = s.page(a.tab);
    const kind = a.kind || 'text';
    const sel = String(a.selector || 'body');
    await page.locator(sel).first().waitFor({ state: 'attached', timeout: num(a.timeout, SELECTOR_TIMEOUT) }).catch(() => {});
    const all = page.locator(sel);
    if (kind === 'count') return { value: await all.count() };
    if (kind === 'table') {
      return { value: await all.first().evaluate((t) => [...t.querySelectorAll('tr')].map((r) => [...r.querySelectorAll('th,td')].map((c) => c.textContent.trim()))) };
    }
    const one = async (l) => kind === 'attr' ? l.getAttribute(String(a.attr || 'href')) : kind === 'html' ? l.innerHTML() : kind === 'value' ? l.inputValue() : (await l.innerText()).trim();
    if (a.all) { const n = Math.min(await all.count(), num(a.limit, 500)); const out = []; for (let i = 0; i < n; i++) out.push(await one(all.nth(i))); return { value: out }; }
    return { value: await one(all.first()) };
  },
  downloads: (s) => ({ items: s.downloads() }),
};

export const COMMAND_NAMES = Object.keys(COMMANDS);
