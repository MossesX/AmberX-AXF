/**
 * Approval rules as the console app's overlay WebView runs them (build approval-rules-save-apply-default-don-t):
 * a phone-sized page where the browser's confirm() answers false without showing anything, against `vite preview` of
 * dist/ with the console routes and the hub's policy route answered from a fixture (no VPS, no hub).
 *
 *   node scripts/approval-rules-webview.mjs [out-dir]      (build first: npm run build)
 *   AR_WEBVIEW_PORT=7097 · PW_CHROMIUM=<chromium path>
 *
 * It fails unless, with real taps (toolbar buttons take the framework's two taps, tap-to-confirm):
 *   signed-in     Apply the default stages the default and its PUT reaches the hub; Save sends the draft
 *   no-session    the tab says Save is off here and offers Sign in, which goes to the hub's sign-in and back
 *   expired       a PUT answered 401 shows the reason and Sign in on the tab
 *   hub-down      a PUT that can't reach the hub shows the reason on the tab
 *   remote        console-control presses of Save and of the answer are refused and nothing reaches the hub
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { stage, view } from '../plugins/gate/web/approval-core.mjs'; // axf-plugin:gate

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2] || '';
const PORT = Number(process.env.AR_WEBVIEW_PORT) || 7097;
const HUB = 'https://hub.invalid';
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const tool = (name, policy, more = {}) => ({ name, policy, ...more });
// a hub that is not on the default yet: console tools on the preset's veto, no rules
const TABLE = { veto: { defaultSeconds: 90, min: 10, max: 1800 }, services: [
  { namespace: 'axf-console', displayName: 'AXF console', type: 'mcp', enabled: true, rules: [],
    tools: [tool('console_terminal_sessions_run', 'veto', { explicit: 'veto' }), tool('orchestrator_upgrade_approve', 'confirm', { explicit: 'confirm' }), ...['console_show', 'console_control_do', 'claude_view_set'].map((n) => tool(n, 'veto')), tool('builds_delete', 'confirm', { annotations: { destructive: true } })] },
  { namespace: 'vps', displayName: 'VPS shell', type: 'ssh', enabled: true, rules: [],
    tools: [tool('run', 'veto', { explicit: 'veto' }), tool('launch', 'veto', { explicit: 'veto' }), tool('check', 'allow', { explicit: 'allow' })] },
] };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const SETTINGS = { ok: true, settings: { refreshSec: 600, historySize: 2000, defaultTab: 'rules' } };
const say = (m) => process.stderr.write(`${m}\n`);

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;

/** One scenario: its own page, console state and hub. `hub` = how the policy PUT answers: ok | 401 | down. */
async function scenario(name, { canSave, hub = 'ok', draft = null }, body) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0 Mobile Safari/537.36 AXFConsoleApp/0.1.0' });
  const page = await ctx.newPage();
  const seen = { staged: [], puts: [], confirms: 0, signIn: '' };
  let services = draft ? stage({}, TABLE, draft) : {};
  const answer = () => ({ ...view({ hub: HUB, available: true, table: TABLE }, Object.keys(services).length ? { services, by: 'brett', at: new Date().toISOString() } : null), canSave });
  page.on('pageerror', (e) => say(`${name}: page error: ${e.message.split('\n')[0]}`));
  // the overlay WebView: confirm() is cancelled without being drawn (and counted: the tab must never call it)
  await page.addInitScript(() => { window.__confirms = 0; window.confirm = () => { window.__confirms += 1; return false; }; });
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url());
    const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname === '/api/me') return json(ME);
    if (u.pathname === '/api/plugins/gate/settings') return json(SETTINGS); // axf-plugin:gate
    if (u.pathname === '/api/plugins/gate/approval-rules') return json(answer()); // axf-plugin:gate
    if (u.pathname === '/api/plugins/gate/approval-rules/draft') { // axf-plugin:gate
      const op = r.request().postDataJSON();
      seen.staged.push(op.op);
      services = stage(services, TABLE, op);
      return json(answer());
    }
    if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
    return json({ ok: false, error: 'offline (webview run)' }, 503);
  });
  await page.route(`${HUB}/**`, async (r) => {
    const u = new URL(r.request().url());
    const cors = { 'access-control-allow-origin': `http://127.0.0.1:${PORT}`, 'access-control-allow-credentials': 'true', 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'Content-Type' };
    if (u.pathname === '/auth/login') { seen.signIn = u.href; return r.fulfill({ status: 200, contentType: 'text/html', body: '<title>axHub sign in</title>' }); }
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname !== '/auth/api/policy' || r.request().method() !== 'PUT') return r.abort();
    seen.puts.push(r.request().postDataJSON());
    if (hub === 'down') return r.abort('connectionrefused');
    if (hub === '401') return r.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: JSON.stringify({ error: { code: 'denied', message: 'Sign in' } }) });
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
  const run = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd).catch((e) => ({ ok: false, error: String(e) }));
  await sleep(10_000); // first visit: every plugin loads once before its views can be opened
  let opened = null;
  for (let i = 0; i < 40 && !opened?.ok; i++) { opened = await run({ verb: 'open', address: 'view:gate/tab:gate.tabs=approvals' }); if (!opened?.ok) await sleep(500); }
  await page.waitForSelector('[data-axf-toolbar="gate.approvals"]', { timeout: 15_000 });
  await sleep(600);
  const shot = async (label) => { if (!OUT) return; mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: join(OUT, `approval-rules-webview-${name}-${label}.png`) }); };
  // a toolbar button on a phone: the framework's tap-to-confirm arms it on the first tap, the second tap runs it
  const tapBar = async (sel) => { await page.tap(sel); await page.waitForSelector(`${sel}[data-axf-armed]`, { timeout: 4000 }); await page.tap(sel); };
  try {
    await body({ page, seen, run, shot, tapBar, text: (sel) => page.locator(sel).first().textContent({ timeout: 4000 }).catch(() => '') });
    seen.confirms = await page.evaluate(() => window.__confirms);
    assert.equal(seen.confirms, 0, `${name}: the tab called the browser's confirm()`);
    say(`✓ ${name}`);
  } catch (e) { await shot('failed'); throw e; } finally { await ctx.close(); }
}

try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

  await scenario('signed-in', { canSave: true }, async ({ page, seen, run, shot, tapBar }) => {
    await tapBar('#vps-approvals-default');
    await page.waitForSelector('#vps-approvals-confirm');
    assert.deepEqual(seen.staged, [], 'nothing is staged before the answer');
    await shot('question');
    await page.tap('#vps-approvals-confirm');
    await page.waitForFunction(() => !document.querySelector('#vps-approvals-confirm') && !document.querySelector('.fx-btn.is-busy'), null, { timeout: 10_000 });
    assert.deepEqual(seen.staged, ['default', 'discard'], 'Apply the default stages the default, then clears the draft once saved');
    assert.equal(seen.puts.length, 1, 'one PUT reached the hub');
    assert.equal(seen.puts[0].reason, 'Default: veto countdown only on VPS shell commands');
    assert.deepEqual(seen.puts[0].rules.map((r) => r.service).sort(), ['axf-console', 'vps']);
    assert.equal(await page.locator('.axp-gate__err').count(), 0, 'no error');
    // Save: another surface stages a rule (console-control, as MCP, the CLI and voice do), Brett saves it with his taps
    const set = await run({ verb: 'set', address: 'setting:vps.approvals.vps.rules', value: [{ match: 'build_*', policy: 'allow' }] });
    assert.ok(set?.ok, `staging through console-control: ${JSON.stringify(set).slice(0, 200)}`);
    await page.waitForFunction(() => !document.querySelector('#vps-approvals-save')?.disabled, null, { timeout: 10_000 });
    await tapBar('#vps-approvals-save');
    await page.tap('#vps-approvals-confirm');
    await page.waitForFunction(() => !document.querySelector('#vps-approvals-confirm') && !document.querySelector('.fx-btn.is-busy'), null, { timeout: 10_000 });
    assert.equal(seen.puts.length, 2, 'Save reached the hub');
    assert.ok(seen.puts[1].rules.some((r) => r.service === 'vps' && r.rules.some((x) => x.match === 'build_*')), 'the PUT carries the new rule');
    await shot('saved');
  });

  await scenario('no-session', { canSave: false }, async ({ page, seen, text, shot }) => {
    assert.match(await text('[data-locked]'), /Save and Apply the default are off here\. This page is not on your axHub sign-in/);
    assert.equal(await page.locator('#vps-approvals-save').isDisabled(), true);
    assert.equal(await page.locator('#vps-approvals-default').isDisabled(), true);
    await shot('prompt');
    await page.tap('#vps-approvals-signin');
    await page.waitForURL(`${HUB}/auth/login**`, { timeout: 10_000 });
    assert.equal(new URL(seen.signIn).searchParams.get('rd'), `http://127.0.0.1:${PORT}/`, 'the hub sends him back to the console');
    assert.equal(seen.puts.length, 0);
  });

  await scenario('expired', { canSave: true, hub: '401', draft: { op: 'add', service: 'vps', rule: { match: 'build_*', policy: 'allow' } } }, async ({ page, seen, text, shot, tapBar }) => {
    await tapBar('#vps-approvals-save');
    await page.tap('#vps-approvals-confirm');
    await page.waitForSelector('.axp-gate__err');
    assert.match(await text('.axp-gate__err'), /Not saved: your axHub session is missing or has run out here\. Sign in to axHub, then press it again\. The draft is kept\./);
    assert.equal(await page.locator('#vps-approvals-signin').count(), 1, 'Sign in is offered next to the reason');
    assert.equal(seen.puts.length, 1); assert.ok(!seen.staged.includes('discard'), 'the draft is kept');
    await shot('error');
  });

  await scenario('hub-down', { canSave: true, hub: 'down', draft: { op: 'add', service: 'vps', rule: { match: 'build_*', policy: 'allow' } } }, async ({ page, seen, text, tapBar }) => {
    await tapBar('#vps-approvals-default');
    await page.tap('#vps-approvals-confirm');
    await page.waitForSelector('.axp-gate__err');
    assert.match(await text('.axp-gate__err'), /Not saved: Can't reach axHub from this browser\./);
    assert.ok(seen.staged.includes('default') && !seen.staged.includes('discard'), 'the default stays staged as a draft');
  });

  await scenario('remote', { canSave: true, draft: { op: 'add', service: 'vps', rule: { match: 'build_*', policy: 'allow' } } }, async ({ page, seen, run, text }) => {
    const press = async (address) => {
      let r = await run({ verb: 'press', address });
      const token = r?.confirm ?? r?.details?.confirm ?? r?.error?.confirm;
      if (typeof token === 'string') r = await run({ verb: 'press', address, confirm: token });
      return r;
    };
    await press('button:vps-approvals-save');
    await page.waitForSelector('#vps-approvals-confirm');
    await press('button:vps-approvals-confirm');
    await page.waitForSelector('.axp-gate__err');
    assert.match(await text('.axp-gate__err'), /Only Brett saves approval rules, with his own click/);
    assert.equal(seen.puts.length, 0, 'a remote press never reaches the hub');
  });

  console.log('✓ approval rules in a WebView: 5 scenarios');
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.stack || e.message); process.exitCode = 1; } finally { await browser?.close(); try { server.kill('SIGTERM'); } catch { /* gone */ } }
