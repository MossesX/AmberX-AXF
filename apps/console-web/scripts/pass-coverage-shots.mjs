/**
 * The axHub passes page's coverage UI (build approval-pass-covers-every-call, pass@2: framework/spec/AXHUB-PASS.md),
 * driven with real clicks, desktop and phone, against `vite preview` of dist/ with the console's hub-pages relay
 * (`/api/hub-pages/*`) answered from a fixed fake hub. Nothing reaches a real hub.
 *
 *   node scripts/pass-coverage-shots.mjs [out-dir]      (build first: npm run build)
 *   PASS_SHOTS_PORT=7398 · PW_CHROMIUM=<chromium path>
 *
 * It fails unless:
 *   - each active pass card lists its coverage ("All tools", or the entries) and the calls that ran under it
 *   - the grant form opens on "All tools" and Switch the pass on sends `covers: "all"`
 *   - "Pick services and tools" with vps → run ticked and a typed entry sends exactly those entries
 *   - Edit coverage opens on what the pass covers and saves to `…/<id>/update`
 * With an out-dir it also writes the screenshots for UI Review.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2] || '';
const PORT = Number(process.env.PASS_SHOTS_PORT) || 7398;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const HUB = 'https://axhub.amberxai.com';
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const later = (min) => new Date(Date.now() + min * 60_000).toISOString();
const BRETT = { id: 'brett', username: 'brett', role: 'admin', name: 'Brett', email: 'owner@example.test', disabled: false, permissions: [] };
const SESSION = { signedIn: true, hub: HUB, loginUrl: `${HUB}/auth/login`, admin: true, user: BRETT, via: 'browser', can: { approvals: true, approvalLog: true, users: true, apps: true, handoff: true } };
const pass = (o) => ({ schemaVersion: 2, id: 'p-all', covers: 'all', all: true, service: '*', tools: ['*'], title: 'Work with Claude today', description: 'Console audit and the VPS clean-up.', createdAt: ago(95), expiresAt: later(1345), active: true, secondsLeft: 1345 * 60, grantedBy: 'brett', grantedVia: 'web', uses: 12, lastUsedAt: ago(3), canExtend: true, canRevoke: true, canEdit: true, quietNotice: false, ...o });
const PICKED = [{ service: 'vps', tool: 'run' }, { service: 'axf-console', tool: 'console_terminal_sessions_*' }, { service: '*', scope: 'tokens.theme' }];
const PASSES = {
  active: [pass({}), pass({ id: 'p-pick', covers: PICKED, all: false, service: '*', tools: ['run', 'console_terminal_sessions_*'], scopes: ['tokens.theme'], title: 'Terminal clean-up', description: '', expiresAt: later(22), secondsLeft: 22 * 60, uses: 0, lastUsedAt: undefined, quietNotice: true })],
  recent: [pass({ id: 'p-old', schemaVersion: 1, covers: undefined, all: undefined, service: 'axf-console', tools: ['control_set'], scope: ['tokens.theme'], title: 'Theme pass', active: false, secondsLeft: 0, expiresAt: ago(90), createdAt: ago(150), uses: 3, canExtend: false, canRevoke: false, canEdit: false })],
  minutes: { min: 5, max: 1440, presets: [30, 60, 240, 1440] },
  services: [
    { namespace: 'vps', displayName: 'VPS shell', tools: [{ name: 'run', policy: 'veto' }, { name: 'launch', policy: 'veto' }, { name: 'check', policy: 'allow' }, { name: 'build_start', policy: 'allow' }, { name: 'build_stop', policy: 'allow' }] },
    { namespace: 'axf-console', displayName: 'AXF console', tools: ['console_terminal_sessions_run', 'console_terminal_sessions_stop', 'console_terminal_sessions_list', 'console_show', 'console_control_do', 'control_set', 'control_reset', 'builds_delete'].map((name) => ({ name })) },
    { namespace: 'github', displayName: 'GitHub', tools: ['pulls/create', 'pulls/merge', 'issues/create'].map((name) => ({ name })) },
  ],
  now: ago(0),
};
const run = (id, qualifiedTool, policySkipped, min, o = {}) => ({ id, confirmationId: '', qualifiedTool, status: 'ran under pass', summary: '', createdAt: ago(min), ranAt: ago(min), ranUnder: 'p-all', passId: 'p-all', policySkipped, ...o });
const LOG = { total: 12, page: 1, pages: 1, tools: [], statuses: [], counts: {}, windows: [], underPass: 12, entries: [
  run('r1', 'vps.run', 'veto', 3), run('r2', 'axf-console.console_terminal_sessions_stop', 'always-approve', 9), run('r3', 'github.pulls/merge', 'confirm', 14),
  run('r4', 'vps.run', 'veto', 21, { status: 'failed under pass' }), run('r5', 'axf-console.control_set', 'veto', 33), run('r6', 'vps.launch', 'veto', 41),
] };
const ME = { wall: true, hub: HUB, appearanceHub: 'off', user: { name: 'brett', role: 'admin' }, admin: true, role: 'admin', themes: true, plugins: [] };
const say = (m) => process.stderr.write(`${m}\n`);

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.PASS_SHOTS_DEBUG ? 'inherit' : 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false; let exited = false; server.on('exit', () => { exited = true; });
  for (let i = 0; i < 120 && !up && !exited; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } }
  if (exited) throw new Error(`port ${PORT} is taken (set PASS_SHOTS_PORT)`);
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  if (OUT) mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    const posts = [];
    page.on('pageerror', (e) => say(`${device}: page error: ${e.message.split('\n')[0]}`));
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      if (u.pathname.startsWith('/api/hub-pages/')) {
        const path = u.pathname.slice('/api/hub-pages/'.length);
        if (r.request().method() === 'POST') { posts.push({ path, body: JSON.parse(r.request().postData() || '{}') }); return json({ ok: true, message: 'Done (fixture).' }); }
        if (path === 'auth/api/session') return json(SESSION);
        if (path === 'auth/api/passes') return json(PASSES);
        if (path === 'auth/api/approvals/log') return json(u.searchParams.get('pass') === 'p-all' ? LOG : { ...LOG, total: 0, entries: [] });
        return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
      }
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const control = (cmd) => page.evaluate((c) => window.axfConsoleControl(c), cmd);
    await sleep(10_000); // first visit: every plugin loads once to learn its shape before its views can be opened
    let opened = null;
    for (let i = 0; i < 40; i++) { opened = await control({ verb: 'open', address: 'view:axhub-passes' }).catch((e) => ({ ok: false, message: String(e) })); if (opened?.ok) break; await sleep(500); }
    say(`${device}: open → ${JSON.stringify(opened).slice(0, 160)}`);
    const shot = async (name, target) => {
      if (!OUT) return;
      const file = join(OUT, `pass-coverage-${name}-${device}.png`);
      if (target) { await target.scrollIntoViewIfNeeded(); await sleep(300); }
      if (target && !mobile) await target.screenshot({ path: file }); else await page.screenshot({ path: file, fullPage: !mobile });
      shots.push(file);
    };
    const text = async (sel) => (await page.locator(sel).innerText()).replace(/\s+/g, ' ').trim();

    // the active cards: coverage and the runs under each
    await page.waitForSelector('[data-axf-pass-runs="p-all"] li', { timeout: 30_000 });
    assert.match(await text('[data-axf-pass-covers="p-all"]'), /^Covers All tools$/);
    assert.match(await text('[data-axf-pass-covers="p-pick"]'), /^Covers vps\.run axf-console\.console_terminal_sessions_\* scope tokens\.theme quiet notice per run$/);
    const runs = await text('[data-axf-pass-runs="p-all"]');
    assert.match(runs, /^12 calls ran under it, last \d+ min ago vps\.run no countdown/);
    assert.match(runs, /console_terminal_sessions_stop no approval prompt \(always-approve tool\)/); assert.match(runs, /github\.pulls\/merge no approval prompt/); assert.match(runs, /failed/);
    assert.equal(await page.locator('[data-axf-pass-runs="p-all"] li').count(), 5, 'the newest five runs');
    assert.match(await text('[data-axf-pass-runs="p-pick"]'), /^No call has run under it yet\.$/);
    await shot('cards');

    // the grant form: folded while a pass is on; opens on All tools
    const grant = page.locator('[data-axf-pass-grant]');
    if (!(await grant.isVisible())) await page.locator('.fx-card', { has: page.getByRole('heading', { name: 'Switch a pass on' }) }).getByRole('button', { name: 'Expand' }).click();
    await grant.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await grant.getByRole('radio', { name: 'All tools' }).getAttribute('aria-checked'), 'true', 'All tools is the default');
    assert.match(await text('[data-axf-pass-grant] [data-axf-pass-summary]'), /^Covers every tool on every service/);
    await grant.getByRole('radio', { name: '24 h' }).click();
    await shot('grant-all', grant);
    await page.locator('#hub-pass-grant').click();
    await sleep(600);
    assert.deepEqual(posts.pop(), { path: 'auth/api/passes', body: { covers: 'all', minutes: 1440, reason: 'Work with Claude', quietNotice: false } });

    // the picker: a service's tool plus a typed entry
    await grant.getByRole('radio', { name: 'Pick services and tools' }).click();
    assert.equal(await page.locator('#hub-pass-grant').isDisabled(), true, 'nothing picked yet');
    const vps = grant.locator('[data-axf-pass-service="vps"]');
    await vps.getByRole('button', { name: '5 tools' }).click();
    await vps.getByRole('checkbox', { name: 'run', exact: true }).check();
    await grant.locator('[data-axf-pass-service="github"]').getByRole('checkbox').first().check();
    await grant.getByLabel('More services, tools and scopes').fill('axf-console.console_terminal_sessions_*');
    assert.match(await text('[data-axf-pass-grant] [data-axf-pass-summary]'), /^Covers only: vps\.run, github \(every tool\), axf-console\.console_terminal_sessions_\*\./);
    await shot('grant-pick', grant);
    await page.locator('#hub-pass-grant').click();
    await sleep(600);
    assert.deepEqual(posts.pop().body.covers, [{ service: 'vps', tool: 'run' }, { service: 'github' }, { service: 'axf-console', tool: 'console_terminal_sessions_*' }]);

    // Edit coverage on the picked pass: opens on its entries, saves to /update
    await page.locator('#hub-pass-edit-p-pick').click();
    const edit = page.locator('[data-axf-pass-coverage="p-pick"]');
    assert.equal(await edit.getByRole('radio', { name: 'Pick services and tools' }).getAttribute('aria-checked'), 'true');
    assert.equal(await edit.locator('[data-axf-pass-service="vps"]').getByRole('checkbox', { name: 'run', exact: true }).isChecked(), true);
    assert.equal(await edit.getByLabel('More services, tools and scopes').inputValue(), 'axf-console.console_terminal_sessions_*, scope:tokens.theme');
    await shot('edit', page.locator('[data-axf-pass="p-pick"]'));
    await edit.getByRole('radio', { name: 'All tools' }).click();
    await page.locator('#hub-pass-save-p-pick').click();
    await sleep(600);
    assert.deepEqual(posts.pop(), { path: 'auth/api/passes/p-pick/update', body: { covers: 'all', quietNotice: true, include_irreversible: false } });
    say(`${device}: ok`);
    await ctx.close();
  }
  console.log(shots.length ? shots.join('\n') : '✓ pass coverage UI');
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.stack || e.message); process.exitCode = 1; } finally { await browser?.close(); server.kill('SIGTERM'); }
