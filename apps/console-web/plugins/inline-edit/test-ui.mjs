#!/usr/bin/env node
/**
 * Inline edit — UI test: right-click → edit → reset, in a real console (the console API + Vite, a temporary look document
 * and data folder), driven by Playwright. Also writes the screenshots the PR and UI Review use.
 *
 *   node apps/console-web/plugins/inline-edit/test-ui.mjs [--out <dir>] [--keep]
 *
 * Steps: switch Inline edit mode on in Settings → Appearance (the server follows), right-click an application-menu button
 * (the capture layer opens the edit dialog instead of the menu), check the breadcrumb, the axHub note and the three views,
 * pick a text colour (live preview, then saved: the element is restyled), open the overrides list, reset that one item
 * and see it go, then switch the mode off (a right-click is the normal menu again). Skips (exit 0) when Playwright or its
 * browser is not installed. Heavy: run it through `node framework/cli/agent-slots.mjs heavy -- …`.
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startConsole, until } from './ui-harness.mjs';

const args = process.argv.slice(2);
const OUT = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : mkdtempSync(join(tmpdir(), 'inline-edit-ui-'));
mkdirSync(OUT, { recursive: true });

const c = await startConsole();
if (!c) { console.log('- inline edit UI test skipped: playwright not installed (npm i -D playwright, or PLAYWRIGHT_DIR)'); process.exit(0); }
const rest = c.rest;

let checks = 0;
const ok = (v, what) => { if (!v) throw new Error(`✗ ${what}`); checks += 1; console.log(`  ✓ ${what}`); };

const shots = [];
let current = null;
try {
  for (const vp of ['desktop', 'phone']) {
    const { ctx, page } = await c.page(vp);
    current = page;
    const shot = async (name) => { const f = join(OUT, `${vp}-${name}.png`); await page.screenshot({ path: f }); shots.push(f); };
    await page.goto(`${c.web}/`);
    await page.waitForSelector('.fx-menubar', { timeout: 90_000 });
    await page.waitForTimeout(1500);

    // 1. the master switch in Settings → Appearance
    await rest('PUT', 'mode', { state: 'off' });
    // plugins load after the shell: wait until this one has registered
    await page.waitForFunction(() => globalThis.AXF?.actions?.list?.().some((a) => a.id === 'inline-edit.mode.toggle'), null, { timeout: 120_000 });
    await page.evaluate(() => globalThis.AXF.dispatch('settings.open:appearance'));
    await page.waitForTimeout(1500);
    const sw = page.getByRole('switch', { name: /Inline edit mode/ }).first();
    await page.locator('.axf-settings__nest').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    if (!(await sw.isVisible().catch(() => false))) { await page.getByText('Everything else', { exact: true }).first().click(); await page.waitForTimeout(600); }
    await page.waitForTimeout(800);
    await sw.waitFor({ state: "attached", timeout: 60_000 });
    await sw.scrollIntoViewIfNeeded({ timeout: 15_000 });
    await shot('settings-switch');
    await sw.click();
    ok(await until(async () => (await rest('GET', 'mode')).on === true), `${vp}: the switch in Settings → Appearance turned the mode on (server follows)`);

    // 2. right-click an application-menu button → the edit dialog, not the menu
    const btn = page.locator('.fx-menubar [data-axf-menu-btn]').first();
    await btn.click({ button: 'right' });
    const dlg = page.locator('.axp-inline-edit__dialog');
    if (process.env.IE_DEBUG) console.log(await page.evaluate(() => { const b = document.querySelector('.fx-menubar [data-axf-menu-btn]'); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return JSON.stringify({ setting: globalThis.AXF.settings.get('axf.inline-edit.mode'), btn: b.outerHTML.slice(0, 300), hit: hit?.outerHTML.slice(0, 200), dialog: globalThis.AXF.getState().dialog }); }));
    await dlg.waitFor();
    const path = await page.locator('.axp-inline-edit__path').innerText();
    ok(/^app-menu:[^/]+\/(.+\/)?menu:/.test(path), `${vp}: right-click opened the edit dialog on ${path}`);
    ok(await page.locator('.fx-ctx').count() === 0, `${vp}: no context menu while inline edit mode is on`);
    ok(await page.locator('.axp-inline-edit__crumb').count() >= 2, `${vp}: breadcrumb from the root down to the child`);
    ok((await dlg.innerText()).includes('override what this element inherits from axHub'), `${vp}: the note says it overrides axHub inheritance`);
    await page.locator('.axp-inline-edit__tree').waitFor();
    ok((await dlg.innerText()).includes('axHub:'), `${vp}: tokens show their inherited axHub value`);
    await shot('dialog-tree');

    // 3. the three views
    await dlg.getByRole('radio', { name: 'Classic tree', exact: true }).click();
    ok(await page.locator('.axp-inline-edit__classic').count() === 1, `${vp}: classic tree view`);
    await shot('dialog-classic');
    await dlg.getByRole('radio', { name: 'Grid', exact: true }).click();
    ok(await page.locator('.axp-inline-edit__grid').count() === 1, `${vp}: grid view`);
    ok(await until(async () => (await rest('GET', 'element')).view === 'grid'), `${vp}: the view is the dialog's state on the server`);
    await page.locator('.axp-inline-edit__grow[data-token="textColor"]').getByRole('button').first().click();
    await page.waitForTimeout(300);
    await shot('dialog-grid-open');
    await dlg.getByRole('radio', { name: 'Tree', exact: true }).click();

    // 4. edit a token: live preview, then saved and applied to the element
    const row = page.locator('.axp-inline-edit__row[data-token="textColor"]');
    await row.getByRole('button', { name: 'Text colour: danger' }).click();
    await page.waitForTimeout(150);
    ok(await page.locator(`[data-axf-inline-at]`).count() >= 1, `${vp}: live preview marks the element at once`);
    ok(await until(async () => (await rest('GET', 'overrides?root=&q=&filter=%7B%7D')).items.some((r) => r.path === path && r.token === 'textColor' && r.value === 'danger')), `${vp}: the change was written through the overrides store`);
    await page.waitForTimeout(1500);
    const color = await btn.evaluate((el) => getComputedStyle(el).color);
    const danger = await page.evaluate(() => { const s = document.createElement('span'); s.style.color = 'var(--fx-danger)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
    ok(color === danger, `${vp}: the element is restyled with the danger colour token (${color})`);
    ok(await row.locator('text=overrides axHub').count() === 1, `${vp}: the token says it overrides axHub`);
    await shot('dialog-edited');

    // 5. the overrides list: the item is there; reset it, only it goes
    await rest('PUT', 'tokens', { path: 'app-menu:app', token: 'gap', value: 'lg', scope: 'parent' });
    await dlg.getByRole('button', { name: 'All overrides' }).click();
    await page.locator('.axp-inline-edit__page').waitFor();
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 2), `${vp}: the overrides list shows both overrides`);
    await shot('overrides-list');

    // tree root, tabs, search and a deep link: the list follows each, live
    await page.locator('.axp-inline-edit__onode-head').getByRole('button', { name: 'menu console' }).first().click();
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 1), `${vp}: picking a root in the tree shows only what is under it`);
    await page.getByRole('button', { name: 'New tab with the selected root' }).click();
    ok(await until(async () => (await rest('GET', 'overrides')).tabs.length === 2), `${vp}: a new tab keeps that root (per user, on the server)`);
    ok(await until(async () => (await page.locator('.axp-inline-edit__column [role="tab"]').count()) === 2), `${vp}: the new tab shows in the column`);
    await shot('overrides-tab');
    await page.getByRole('tab', { name: 'Everything' }).click();
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 2), `${vp}: the Everything tab shows both again`);
    await page.getByRole('searchbox', { name: 'Search' }).fill('Gap');
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 1), `${vp}: full-text search narrows the list`);
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 2);
    await page.evaluate(() => { const g = globalThis; (g.AXF_VIEW_ARGS ??= {})['inline-edit-overrides'] = 'filter=%7B%22scope%22%3A%22parent%22%7D'; g.dispatchEvent(new CustomEvent('axf:view-arg', { detail: { view: 'inline-edit-overrides', arg: 'filter=%7B%22scope%22%3A%22parent%22%7D' } })); });
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 1), `${vp}: a deep link's filter (scope = parent) applies to the open page`);
    await rest('PUT', 'overrides/state', { filter: {}, q: '' });
    await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 2);
    const extra = (await rest('GET', 'overrides')).tabs.find((x) => x.id !== 'all');
    if (extra) await rest('POST', 'overrides/tabs/close', { id: extra.id });
    await rest('PUT', 'overrides/state', { tab: 'all' });
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 2), `${vp}: a tab closed through REST: the page follows`);
    const item = page.locator('.axp-inline-edit__orow', { hasText: 'Text colour' });
    await item.getByRole('button', { name: 'Reset to axHub' }).click();
    ok(await until(async () => (await page.locator('.axp-inline-edit__orow').count()) === 1), `${vp}: Reset to axHub removed only that item, live`);
    ok(await until(async () => (await btn.evaluate((el) => getComputedStyle(el).color)) !== danger), `${vp}: the element inherits its colour from axHub again`);
    const parent = page.locator('.axp-inline-edit__orow', { hasText: 'Gap between items' });
    await parent.getByRole('button', { name: 'Reset to axHub' }).click();
    ok(await parent.getByRole('alertdialog').count() === 1, `${vp}: a parent-scope reset asks first`);
    await shot('overrides-confirm');
    await parent.getByRole('button', { name: 'Reset', exact: true }).click();
    ok(await until(async () => (await rest('GET', 'overrides')).total === 0), `${vp}: confirmed: nothing left, everything inherits from axHub`);

    // 6. switch off from the API: the console follows and a right-click is the normal menu again
    await rest('PUT', 'mode', { state: 'off' });
    await until(async () => (await page.evaluate(() => globalThis.AXF.settings.get('axf.inline-edit.mode'))) === false, 20_000);
    await btn.click({ button: 'right' });
    await page.waitForTimeout(500);
    ok(await page.locator('.axp-inline-edit__dialog').count() === 0, `${vp}: mode off (set through REST): right-click no longer opens the dialog`);
    await ctx.close();
  }
} catch (e) {
  if (current) { const f = join(OUT, 'failed.png'); await current.screenshot({ path: f }).catch(() => undefined); console.error(`screen at the failure: ${f}`); }
  throw e;
} finally {
  await c.stop();
}
console.log(`✓ inline edit UI — ${checks} checks; screenshots in ${OUT}`);
console.log(shots.join('\n'));
