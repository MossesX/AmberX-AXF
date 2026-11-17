/**
 * Screenshots of the banner widget shape and icon UI (widget-shape@1, build banner-widget-shapes-plus-change-icon),
 * desktop and phone: the widget's right-click / long-press menu with Shape ▸ open, the Change icon picker, the custom
 * shape editor, and the bar with the widget turned into a hexagon. The picker is shot once per dialog option (the
 * UI Review choices: centered modal, bottom sheet, side drawer) as opt-<option>--… pictures. Runs against
 * `vite preview` of dist/ with every API answered offline; the dialogs are opened through console-control, the same
 * deep links REST / MCP / the CLI use (function:banner.widget.<widget>.change-icon|custom-shape).
 *
 *   node scripts/banner-widget-shape-shots.mjs <out-dir>     (build first: npm run build)
 *   CI_SHOTS_PORT=7098 · PW_CHROMIUM=<chromium path>
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '../..');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node scripts/banner-widget-shape-shots.mjs <out-dir>'); process.exit(2); }
const PORT = Number(process.env.CI_SHOTS_PORT) || 7098;
let playwright;
for (const base of [APP, ROOT, process.env.PLAYWRIGHT_DIR].filter(Boolean)) { try { playwright = createRequire(join(base, 'x.js'))('playwright'); break; } catch { /* next */ } }
if (!playwright) { console.error('playwright not found'); process.exit(2); }

const ME = { wall: false, hub: '', appearanceHub: 'off', user: null, admin: true, role: 'admin', themes: true, plugins: [] };
/** The dialog options the Change icon picker and the custom shape editor are shown in (framework dialog assets). */
const OPTIONS = [{ id: 'modal', dialog: 'centered-modal' }, { id: 'sheet', dialog: 'bottom-sheet' }, { id: 'drawer', dialog: 'side-drawer' }];
const say = (m) => process.stderr.write(`${m}\n`);

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: process.env.CI_SHOTS_DEBUG ? 'inherit' : 'ignore' });
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
let browser;
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
  if (!up) throw new Error(`vite preview on :${PORT} (is dist/ built?)`);
  browser = await playwright.chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  mkdirSync(OUT, { recursive: true });
  const shots = [];
  for (const [device, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 412, height: 915 }, true]]) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    const page = await ctx.newPage();
    await page.route('**/api/**', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname === '/api/me') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ME) });
      if (r.request().method() === 'GET' && u.pathname === '/api/events') return r.abort();
      return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline (shots)' }) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => typeof window.axfConsoleControl === 'function', null, { timeout: 30_000 });
    const run = (cmd) => page.evaluate((x) => window.axfConsoleControl(x), cmd);
    await sleep(1200);
    const list = await run({ verb: 'list' });
    const widgets = [...new Set((list?.targets ?? []).map((t) => t.address).filter((a) => /^setting:banner\.widget\..+\.shape$/.test(a)).map((a) => a.slice('setting:banner.widget.'.length, -'.shape'.length)))];
    const onBar = await page.evaluate(() => [...document.querySelectorAll('.fx-banner [data-axf-banner-item]')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => n.getAttribute('data-axf-banner-item')));
    const w = onBar.find((k) => k.startsWith('clock:')) ?? onBar.find((k) => widgets.includes(k)) ?? widgets[0];
    say(`${device}: widgets ${widgets.join(', ')} · on the bar ${onBar.join(', ')} · using ${w}`);
    if (!w) throw new Error('no banner widget to shoot');
    const shoot = async (name) => { const f = join(OUT, `${name}-${device}.png`); await page.screenshot({ path: f }); shots.push(f); say(`  ${name}-${device}.png`); };
    const close = async () => { await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await sleep(300); };

    // 1. right-click / long-press the widget → Shape ▸
    const item = page.locator(`.fx-banner [data-axf-banner-item="${w}"]`).first();
    if (await item.count()) {
      const box = await item.boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      await sleep(500);
      const shape = page.getByRole('menuitem', { name: /^Shape/ }).first();
      if (await shape.count()) {
        await shape.hover().catch(() => {});
        await sleep(400);
        if (!(await page.getByRole('menuitem', { name: /^Hexagon/ }).count())) { await shape.focus().catch(() => {}); await page.keyboard.press('ArrowRight'); }
        await sleep(500);
      }
      await shoot('shape-menu');
      await close();
    } else say(`  ${w} is not drawn on the bar (in ⋯): no menu shot`);

    // 2. a hexagon on the bar (the same set the Shape ▸ Hexagon item does)
    await run({ verb: 'set', address: `setting:banner.widget.${w}.shape`, value: 'hexagon' });
    await sleep(500);
    await shoot('banner-hexagon');

    // 3. the custom shape editor with the star preset
    await run({ verb: 'press', address: `function:banner.widget.${w}.custom-shape` });
    await sleep(600);
    await page.locator('[data-axf-target="panel:axf.banner.widget-shape"] button', { hasText: 'Star' }).first().click({ timeout: 5000 }).catch((e) => say(`  star: ${e.message.split('\n')[0]}`));
    await sleep(400);
    await shoot('custom-shape-editor');
    await close();

    // 4. the Change icon picker, once per dialog option
    for (const o of OPTIONS) {
      await run({ verb: 'press', address: 'function:swap', value: `dialog:${o.dialog}` }).catch(() => {});
      await page.evaluate((id) => window.__axfConsole?.runtime?.swap?.('dialog', id), o.dialog).catch(() => {});
      await sleep(300);
      await run({ verb: 'press', address: `function:banner.widget.${w}.change-icon` });
      await sleep(700);
      await shoot(`opt-${o.id}--icon-picker`);
      await close();
    }
    await run({ verb: 'press', address: `function:banner.widget.${w}.reset`, confirm: true });
    await ctx.close();
  }
  console.log(shots.join('\n'));
  await browser.close(); browser = null;
  server.kill('SIGTERM'); process.exit(0);
} catch (e) { console.error(e.message); process.exitCode = 1; } finally { await browser?.close(); }
