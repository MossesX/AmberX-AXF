#!/usr/bin/env node
/**
 * Screenshots for the Molly Fable build: Molly's built dist served locally, the four apps replaced by stub guest pages
 * (Playwright routes on the real origins) that behave exactly as the guests do: they answer embed@1 `chrome-request`
 * with a chrome@1 bundle (nav sections, a toolbar, banner widgets), answer `host-catalog` by remembering it and, when
 * asked, post a `host-run` back (the console client's path). Desktop (1440×900) and phone (412×915), grouped by screen.
 *   node _claude/builds/reports/molly-fable-version-the-one-interface-for-amberx/shots.mjs <dist dir> <out dir>
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

// Playwright from any checkout that has it installed (PW_ROOT = a folder whose node_modules holds playwright-core)
const require = createRequire(join(process.env.PW_ROOT ?? '/root/axf-builds/appearance-skins-colour-themes-only-remove-design-packs/apps/console-web', 'package.json'));
const { chromium } = require('playwright-core');

const [dist, out] = process.argv.slice(2);
if (!dist || !out) { console.error('usage: shots.mjs <dist> <out>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const p = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = join(dist, p === '/' ? 'index.html' : p);
  if (!existsSync(file)) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/** A guest page: the same protocol as an AXF app inside Molly, with a label so the frame is recognisable in a shot. */
const guest = (app, label, nav, widgets) => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font:16px system-ui;background:#0f1419;color:#d7dde3}
.wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}
.tag{font-size:13px;opacity:.7}.big{font-size:28px;font-weight:600}</style></head><body><div class="wrap">
<div class="big">${label}</div><div class="tag">stub guest · <span id="where"></span> · <span id="page">home</span></div><div class="tag" id="host">no host catalog yet</div></div>
<script>
const APP=${JSON.stringify(app)};
document.getElementById('where').textContent=location.hostname+' '+(location.search||'');
const bundle={$axf:'chrome@1',app:APP,label:${JSON.stringify(label)},active:'nav:home',
  menus:[{id:APP+'-menu',label:${JSON.stringify(label)},items:[{id:'nav:home',label:'Home',icon:'home'},{id:'sep',separator:true},{id:'act:refresh',label:'Refresh',icon:'refresh'}]}],
  nav:${JSON.stringify(nav)},
  context:[{target:'default',items:[{id:'act:copy',label:'Copy link',icon:'link'}]}],
  toolbars:[{id:'main',label:${JSON.stringify(label + ' toolbar')},items:[{id:'nav:home',label:'Home',icon:'home'},{id:'act:refresh',label:'Refresh',icon:'refresh'}]}],
  widgets:${JSON.stringify(widgets)}};
let hostItems=[];
window.addEventListener('message',(e)=>{const m=e.data; if(!m||m.$axf!=='embed@1')return;
  if(m.type==='chrome-request')parent.postMessage({$axf:'embed@1',type:"chrome",chrome:bundle},'*');
  if(m.type==='run'){document.getElementById('page').textContent=m.id; bundle.active=m.id; parent.postMessage({$axf:'embed@1',type:"chrome",chrome:bundle},'*');}
  if(m.type==='host-catalog'){hostItems=m.items; document.getElementById('host').textContent='host catalog: '+m.items.length+' items from '+m.host+' · here '+(m.here&&m.here.screenLabel||'');}
  if(m.type==='shown'){document.body.dataset.on=String(m.on);} });
// the test drives a remote command the way the console client would: window.axfHostRun('screen','console#2')
window.axfHostRun=(kind,target,args)=>parent.postMessage({$axf:'embed@1',type:'host-run',run:{kind,target,args,by:'Amber',label:target}},'*');
window.axfHostItems=()=>hostItems;
</script></body></html>`;

const GUESTS = {
  'console.amberxai.com': guest('console', 'Dev Console', [{ label: 'Build', items: [{ id: 'nav:build', label: 'Builds', icon: 'hammer', badge: 3 }, { id: 'nav:pending', label: 'Pending builds', icon: 'clock' }, { id: 'nav:review', label: 'UI Review', icon: 'eye' }] }, { label: 'Studio', items: [{ id: 'nav:plan', label: 'Plan Studio', icon: 'layout' }, { id: 'nav:theme', label: 'Theme Editor', icon: 'palette' }] }], [{ id: 'w:builds', type: 'counter', label: 'builds live', count: 3, tone: 'accent' }, { id: 'w:ci', type: 'status', text: 'CI green', tone: 'success' }]),
  'amberx.amberxai.com': guest('amberx', 'AmberX', [{ items: [{ id: 'nav:notes', label: 'Notes', icon: 'file' }, { id: 'nav:todos', label: 'To-dos', icon: 'check' }, { id: 'nav:voice', label: 'Voice', icon: 'mic' }] }], [{ id: 'w:voice', type: 'label', text: 'Listening', icon: 'mic', tone: 'neutral' }]),
  'axhub.amberxai.com': guest('axhub', 'axHub', [{ items: [{ id: 'nav:approvals', label: 'Approvals', icon: 'shield', badge: 2 }, { id: 'nav:passes', label: 'Passes', icon: 'key' }] }], [{ id: 'w:approvals', type: 'badge', label: 'approvals', count: 2, tone: 'warning' }]),
  'expenses.amberxai.com': guest('expenses', 'Expenses', [{ items: [{ id: 'nav:ledger', label: 'Ledger', icon: 'list' }, { id: 'nav:paydays', label: 'Paydays', icon: 'calendar' }] }], []),
};

// the chromium Playwright has on this machine (the installed playwright-core may expect another build number)
const pwCache = join(process.env.HOME ?? '/root', '.cache/ms-playwright');
const builds = existsSync(pwCache) ? (await import('node:fs')).readdirSync(pwCache).filter((d) => d.startsWith('chromium-')).sort() : [];
const executablePath = builds.map((b) => join(pwCache, b, 'chrome-linux64/chrome')).concat(builds.map((b) => join(pwCache, b, 'chrome-linux/chrome'))).find((p) => existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const shots = [];
async function run(device, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: 1 });
  await ctx.route(/https:\/\/(console|amberx|axhub|expenses)\.amberxai\.com\/.*/, (route) => {
    const host = new URL(route.request().url()).hostname;
    route.fulfill({ status: 200, contentType: 'text/html', body: GUESTS[host] });
  });
  // the look: no hub reachable here, so Molly uses its baked look
  // the look lives on axHub: nothing saved there (404) = the app starts from its defaults; the live feed stays quiet
  await ctx.route(/https:\/\/axhub\.amberxai\.com\/data\/.*/, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"not found"}' }));
  await ctx.route(/https:\/\/axhub\.amberxai\.com\/data-events.*/, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': ok\n\n' }));
  await ctx.route(/https:\/\/(hub|axhub)\.amberxai\.com\/api\/.*/, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', (e.stack ?? e.message).split('\n').slice(0, 12).join('\n')));
  const shot = async (name, screen) => { const file = join(out, `${name}-${device}.png`); await page.screenshot({ path: file }); shots.push({ file, screen, device }); console.log('shot', file); };
  const wait = (ms) => page.waitForTimeout(ms);
  const where = async (tag) => console.log('WHERE', tag, JSON.stringify(await page.evaluate(() => ({ active: [...document.querySelectorAll('.fx-nav .is-active, .fx-nav [aria-current], .fx-nav [aria-selected=true]')].map((e) => e.textContent.trim()).slice(0, 3), title: document.title, frames: [...document.querySelectorAll('iframe.molly-frame')].map((f) => f.dataset.instance + ':' + f.dataset.on) }))), 'frame detached:', frame ? frame.isDetached() : 'n/a');
  const clearToasts = async () => { for (const b of await page.locator('.fx-toast button, [class*=toast] button[aria-label="Close"], [class*=toast] button').all()) { try { await b.click({ timeout: 500 }); } catch { /* gone */ } } await wait(300); };

  await page.goto(`${base}/#/console`);
  await wait(1800);
  await shot('console-nav', 'Console in Molly (merged nav, toolbar, widgets)');
  console.log('SLOTS ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.molly-slot, .axp-xlayout-body, .axp-xlayout-main, .fx-main__inner, .fx-main')].map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, app: e.dataset.app, rect: [r.left, r.top, r.width, r.height].map(Math.round), display: getComputedStyle(e).display, h: getComputedStyle(e).height }; }))));
  console.log('FRAMES ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('iframe.molly-frame')].map((f) => { const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { id: f.dataset.instance, on: f.dataset.on, rect: [r.left, r.top, r.width, r.height].map(Math.round), visibility: getComputedStyle(f).visibility, z: getComputedStyle(f.parentElement).zIndex, cover: el ? el.tagName + '.' + el.className : null }; }))));

  // two copies: Molly menu → Tabs → New tab → Console (the nested menu), then IDE mode to see both
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('axf-shot-noop')));
  const dispatch = (action) => page.evaluate((a) => { const rt = window.__axf ?? window.axf; if (rt?.dispatch) return rt.dispatch(a); const b = [...document.querySelectorAll('[data-action]')].find((x) => x.dataset.action === a); b?.click(); return !!b; }, action);
  // open the Molly menu to show the nested Tabs menu
  const menuBtn = page.locator('[role=menubar] button, .fx-menubar button').filter({ hasText: /^Molly$/ }).last();
  if (await menuBtn.count()) { await menuBtn.click(); await wait(300); const tabs = page.getByText('Tabs', { exact: true }).first(); if (await tabs.count()) { await tabs.hover(); await wait(300); const nt = page.getByText('New tab', { exact: true }).first(); if (await nt.count()) { await nt.hover(); await wait(300); } } await shot('menu-tabs', 'Molly menu → Tabs (nested)'); await page.keyboard.press('Escape'); await wait(200); }

  // a second Console through the host-run path (what axf console action molly.new-tab console does)
  const frame = page.frames().find((f) => f.url().startsWith('https://console.amberxai.com'));
  if (frame) { await frame.evaluate(() => window.axfHostRun('action', 'molly.new-tab', ['console'])); await wait(1500); }
  await where('after new-tab');
  await shot('console-2', 'Console 2 (second copy, opened by a remote command)');

  // IDE mode with both copies side by side
  if (frame) { await frame.evaluate(() => window.axfHostRun('action', 'xlayout.ide')); await wait(1200); await frame.evaluate(() => window.axfHostRun('action', 'xlayout.open', ['pane', 'console'])); await wait(1500); }
  await shot('ide-two-consoles', 'IDE mode: two Console copies in panes');

  // the host catalog the console client announces (what the API sees)
  if (frame) { const n = await frame.evaluate(() => window.axfHostItems().length); console.log('host catalog items seen by the console stub:', n); }

  // settings → plugins → Molly control
  await where('after ide');
  await clearToasts();
  await shot('ide-two-consoles-clean', 'IDE mode: two Console copies in panes');
  if (frame) { await frame.evaluate(() => window.axfHostRun('settings', 'molly-control')); await wait(1200); }
  await clearToasts();
  await where('after settings');
  await shot('settings-control', 'Settings → Plugins → Molly control');

  if (frame) { await frame.evaluate(() => window.axfHostRun('screen', 'home')); await wait(1000); }
  await clearToasts();
  await where('after home');
  await shot('home', 'Molly start page');
  await ctx.close();
}
await run('desktop', { width: 1440, height: 900 }, false);
await run('phone', { width: 412, height: 915 }, true);
await browser.close();
server.close();
console.log(JSON.stringify(shots, null, 1));
