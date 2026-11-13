#!/usr/bin/env node
/**
 * Pipeline demos end to end (Playwright against `vite preview` of the console's dist/): open the designer on the
 * Pipelines mode through the deep link, play the voice-to-app demo, check the walkthrough bar follows the chapters
 * (the console moves to each chapter's screen), the behind-the-scenes panel streams and filters lines, docks, floats
 * and goes full screen, and the pipeline.* console actions drive the player. The plugin's routes answer from its own
 * CLI (pipeline-demos.mjs) in a scratch data folder; everything else is offline.
 *
 *   node apps/console-web/plugins/demonstration-designer/pipelines.e2e.mjs      (build the console first)
 *   DD_E2E_PORT=7098 · PW_CHROMIUM=<chromium path> · DD_E2E_SHOTS=<dir> (desktop + phone screenshots)
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '../..');
const ROOT = join(APP, '../..');
const PORT = Number(process.env.DD_E2E_PORT) || 7098;
const SHOTS = process.env.DD_E2E_SHOTS || '';
const DATA = mkdtempSync(join(tmpdir(), 'axf-dd-e2e-'));

let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR, '/tmp/sc-pw'].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { try { playwright = await import('playwright'); } catch { console.error('playwright not found'); process.exit(2); } }

let checks = 0;
const ok = (c, what) => { if (!c) throw new Error(`✗ ${what}`); checks++; console.log(`  ✓ ${what}`); };
const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
const cli = (...args) => {
  const r = spawnSync('node', [join(HERE, 'pipeline-demos.mjs'), ...args, '--json'], { encoding: 'utf8', env: { ...process.env, AXF_DEMO_DESIGNER_DIR: DATA } });
  return { status: r.status === 0 ? 200 : r.status === 2 ? 404 : 400, body: r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : { detail: r.stderr.trim() } };
};
let reported = null;

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { await sleep(500); } }
  ok(up, `vite preview on :${PORT}`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const shoot = async (page, name) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, name) }); };
  const open = async (viewport) => {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { try { window.speechSynthesis && (window.speechSynthesis.speak = () => {}); } catch { /* none */ } });
    await page.route('**/api/**', async (r) => {
      const u = new URL(r.request().url());
      const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (u.pathname === '/api/me') return json(ME);
      const m = /\/api\/plugins\/demonstration-designer\/(.+)$/.exec(u.pathname);
      if (m) {
        const q = u.searchParams; const route = m[1]; const method = r.request().method();
        if (route === 'pipelines') { const x = cli('list'); return json({ items: x.body }, x.status); }
        if (route === 'pipeline' && method === 'GET') { const x = cli('get', q.get('id')); return json(x.body, x.status); }
        if (route === 'pipeline/timeline') { const x = cli('timeline', q.get('id'), ...(q.get('script') ? ['--script'] : [])); return json(x.body, x.status); }
        if (route === 'pipeline/state' && method === 'POST') { reported = JSON.parse(r.request().postData() || '{}'); return json(reported); }
        if (route === 'settings') return json({});
        if (route === 'demos' || route === 'registry') return json({ items: [] });
        if (route === 'narrators') return json({ available: false, items: [] });
      }
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return json({ ok: false, error: 'offline (e2e)' }, 503);
    });
    return { page, errors };
  };

  /* desktop */
  const { page, errors } = await open({ width: 1400, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/?axf-pipeline=voice-to-app`);
  await page.waitForSelector('.axp-demonstration-designer--pipelines', { timeout: 30_000 });
  ok(true, 'the deep link ?axf-pipeline= opens the designer on Pipelines');
  await page.waitForSelector('[data-pipeline="voice-to-app"]', { timeout: 15_000 });
  const rows = await page.locator('[aria-label="Pipeline demos"] > li').count();
  ok(rows >= 7, `the library lists ${rows} pipeline demos`);
  await shoot(page, 'pipelines-library-desktop.png');

  await page.getByRole('radio', { name: '4×' }).first().click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForSelector('.axp-demonstration-designer-walk', { timeout: 10_000 });
  ok(true, 'Play brings up the walkthrough bar over the console');
  ok(await page.locator('.axp-demonstration-designer-bts').isVisible(), 'the behind-the-scenes panel is open');
  await page.waitForFunction(() => document.querySelectorAll('.axp-demonstration-designer-bts__line[data-kind]').length >= 3, null, { timeout: 15_000 });
  ok(true, 'behind-the-scenes lines stream in as it plays');
  await page.getByRole('button', { name: 'Skip to the next chapter' }).click();
  await page.waitForFunction(() => /chapter 2 of/.test(document.querySelector('.axp-demonstration-designer-walk')?.textContent ?? ''), null, { timeout: 5_000 });
  ok(true, 'skip moves to the next chapter');
  await sleep(600);
  ok(await page.locator('.axp-demonstration-designer-walk').isVisible(), 'the walkthrough stays up while the console follows the chapter to its screen');
  ok(reported?.chapter?.view === 'build-orchestrator', `the player reports chapter 2 and its screen (${reported?.chapter?.view})`);
  await page.getByRole('button', { name: 'Pause' }).click();
  const kinds = await page.locator('.axp-demonstration-designer-bts__line[data-kind]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-kind')))]);
  ok(kinds.length >= 3, `several kinds of lines, each colour-coded (${kinds.join(', ')})`);
  await shoot(page, 'pipelines-playing-docked-desktop.png');
  await page.locator('.axp-demonstration-designer-bts__kinds').getByRole('button', { name: /^Orchestrator/ }).click();
  const only = await page.locator('.axp-demonstration-designer-bts__line[data-kind]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-kind')))]);
  ok(only.length === 1 && only[0] === 'orchestrator', 'the kind filter keeps only orchestrator lines');
  await page.locator('.axp-demonstration-designer-bts__kinds').getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('radio', { name: 'Float' }).click();
  ok((await page.locator('.axp-demonstration-designer-bts').getAttribute('data-dock')) === 'float', 'the panel floats');
  await shoot(page, 'pipelines-playing-float-desktop.png');
  await page.getByRole('radio', { name: 'Full' }).click();
  ok((await page.locator('.axp-demonstration-designer-bts').getAttribute('data-dock')) === 'full', 'the panel goes full screen');
  await shoot(page, 'pipelines-playing-full-desktop.png');
  await page.getByRole('radio', { name: 'Dock' }).click();
  ok(reported && reported.demo === 'voice-to-app', 'the player state is reported to the server for GET pipeline/state');
  await page.getByRole('button', { name: 'Stop the demo' }).click();
  await page.waitForFunction(() => !document.querySelector('.axp-demonstration-designer-walk'), null, { timeout: 5_000 });
  ok(true, 'stop takes the walkthrough down');
  ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await page.close();

  /* phone */
  const ph = await open({ width: 412, height: 915 });
  await ph.page.goto(`http://127.0.0.1:${PORT}/?axf-pipeline=skin-swap&axf-autoplay=1`);
  await ph.page.waitForSelector('.axp-demonstration-designer-walk', { timeout: 30_000 });
  ok(true, 'phone: the deep link with autoplay plays the demo');
  await ph.page.waitForFunction(() => document.querySelectorAll('.axp-demonstration-designer-bts__line[data-kind]').length >= 2, null, { timeout: 15_000 });
  await shoot(ph.page, 'pipelines-playing-phone.png');
  await ph.page.getByRole('button', { name: 'Stop the demo' }).click();
  await ph.page.goto(`http://127.0.0.1:${PORT}/?axf-pipeline=library`);
  await ph.page.waitForSelector('.axp-demonstration-designer--pipelines', { timeout: 30_000 });
  await shoot(ph.page, 'pipelines-library-phone.png');
  ok(!ph.errors.length, `phone: no page errors${ph.errors.length ? `: ${ph.errors.join(' | ')}` : ''}`);
  console.log(`pipelines e2e: ${checks} checks passed`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  process.exit(process.exitCode ?? 0);
}
