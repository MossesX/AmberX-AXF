// @ts-nocheck — run by tsx with the playwright package, outside the console's typecheck (playwright is not a console dependency)
/**
 * Themed controls end-to-end (Playwright, desktop + phone). Builds the harness page (test/run.mjs: the host and every
 * family with a small settings store, framework/ui/axf.css), serves it and checks, per viewport:
 *   every family themed while on · native again when off (values kept) · keyboard paths · calendar / colour picker as a
 *   popover on desktop and a bottom sheet on the phone · the async dialogs resolve (and window.alert comes back) ·
 *   a theme swap restyles the controls (their colours follow the theme tokens).
 *
 *   npx -y tsx apps/console-web/plugins/themed-controls/test/themed-controls.spec.ts      (PW_CHROMIUM = a Chromium binary)
 * Needs the `playwright` package and a Chromium; heavy: run through framework/cli/agent-slots.mjs heavy.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { chromium, type Page } from 'playwright';
import { buildHarness } from './run.mjs';

const dir: string = await buildHarness();
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const f = join(dir, (req.url ?? '/').split('?')[0] === '/' ? 'index.html' : (req.url ?? '').split('?')[0]!);
  try { res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f)); } catch { res.writeHead(404); res.end(); }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

let failed = 0;
let passed = 0;
const check = (name: string, ok: unknown, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1100, height: 900 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, touch: true },
];

async function open(v: (typeof VIEWPORTS)[number]): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: v.viewport, hasTouch: v.touch, isMobile: v.touch, locale: 'en-US' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { errors.push(`native ${d.type()} opened`); void d.dismiss(); });
  await page.goto(url);
  if (v.touch) await page.evaluate(() => document.documentElement.setAttribute('data-fx-narrow', ''));
  await page.evaluate(() => document.documentElement.style.setProperty('--fx-accent', 'rgb(224, 160, 32)')); // theme-ok: a test theme
  await page.waitForFunction(() => !!(globalThis as unknown as { tc?: unknown }).tc);
  return { page, errors };
}

for (const v of VIEWPORTS) {
  console.log(`${v.name}:`);
  const { page, errors } = await open(v);
  const ev = <T>(fn: () => T) => page.evaluate(fn);

  // every element family themed while on
  const counts = await ev(() => (globalThis as any).tc.host().counts());
  for (const f of ['checkbox', 'radio', 'range', 'number', 'datetime', 'color', 'file']) check(`${f} themed`, (counts[f] ?? 0) > 0, counts);
  check('opt-out kept native', await ev(() => !document.querySelector('#cbn')!.hasAttribute('data-axf-themed')));
  check('title moved to a themed tip', await ev(() => document.querySelector('#tipbtn')!.getAttribute('data-axf-tip') === 'Saves the form' && !document.querySelector('#tipbtn')!.hasAttribute('title')));
  check(`scrollbars ${v.touch ? 'native on touch' : 'themed on desktop'}`, await ev(() => document.documentElement.classList.contains('fx-tc-scroll')) === !v.touch);

  // keyboard paths
  await page.focus('#cb2 + .fx-tc');
  await page.keyboard.press('Space');
  check('checkbox: Space ticks the input', await ev(() => (document.querySelector('#cb2') as HTMLInputElement).checked));
  await page.focus('#rm + .fx-tc');
  await page.keyboard.press('ArrowDown');
  check('radio: arrow moves the group', await ev(() => (document.querySelector('#rl') as HTMLInputElement).checked && (document.querySelector('#rl') as HTMLElement).nextElementSibling === document.activeElement));
  await page.focus('#vol + .fx-tc .fx-tc-range__thumb');
  await page.keyboard.press('End');
  check('range: End = max, aria-valuenow', await ev(() => (document.querySelector('#vol') as HTMLInputElement).value === '10' && document.querySelector('#vol + .fx-tc .fx-tc-range__thumb')!.getAttribute('aria-valuenow') === '10'));
  await page.focus('#num + .fx-tc input');
  await page.keyboard.press('ArrowUp');
  check('number: ArrowUp steps', await ev(() => (document.querySelector('#num') as HTMLInputElement).value === '3'));

  // calendar: popover on desktop, sheet on the phone; keyboard pick
  await page.click('#d1 + .fx-tc .fx-tc-date__btn');
  await page.waitForSelector('.fx-tc-pop');
  check(`calendar opens as a ${v.touch ? 'sheet' : 'popover'}`, await ev(() => document.querySelector('.fx-tc-pop')!.getAttribute('data-fx-tc-surface')) === (v.touch ? 'sheet' : 'popover'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  check('calendar: arrow + Enter picks the next day', await ev(() => (document.querySelector('#d1') as HTMLInputElement).value === '2026-11-15'));
  // time columns
  await page.click('#t1 + .fx-tc .fx-tc-date__btn');
  await page.waitForSelector('.fx-tc-time');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  check('time: hour column + Enter', await ev(() => (document.querySelector('#t1') as HTMLInputElement).value === '10:30'));
  // colour: open, Escape reverts, a swatch + Done commits
  await page.click('#c1 + .fx-tc .fx-tc-color__btn');
  await page.waitForSelector('.fx-tc-colorpick');
  check(`colour picker opens as a ${v.touch ? 'sheet' : 'popover'}`, await ev(() => document.querySelector('.fx-tc-pop')!.getAttribute('data-fx-tc-surface')) === (v.touch ? 'sheet' : 'popover'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  check('colour: Escape puts the colour back', await ev(() => (document.querySelector('#c1') as HTMLInputElement).value === '#3366cc'));

  // the async dialogs resolve; window.alert is themed while on and the browser's again when off
  const answers = await page.evaluate(async () => {
    const d = (globalThis as any).tcDialogs;
    const out: unknown[] = [];
    const c = d.confirm('Delete everything?').then((x: boolean) => out.push(x));
    const p = d.prompt('Name?', 'untitled').then((x: string | null) => out.push(x));
    await new Promise((r) => setTimeout(r, 100));
    (document.querySelector('.fx-tc-dlg__cancel') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 100));
    const f = document.querySelector('.fx-tc-dlg__field') as HTMLInputElement;
    f.value = 'Bob';
    (document.querySelector('.fx-tc-dlg__ok') as HTMLElement).click();
    await Promise.all([c, p]);
    return out;
  });
  check('confirm resolves false on Cancel, prompt resolves its text', JSON.stringify(answers) === '[false,"Bob"]', answers);
  check('a destructive confirm is marked', await page.evaluate(async () => {
    const d = (globalThis as any).tcDialogs;
    const r = d.confirm('Remove the key?');
    await new Promise((x) => setTimeout(x, 50));
    const danger = !!document.querySelector('.fx-tc-dlg__ok.fx-btn--danger') && document.activeElement?.classList.contains('fx-tc-dlg__cancel');
    (document.querySelector('.fx-tc-dlg__cancel') as HTMLElement).click();
    await r;
    return danger;
  }));

  // theme swap restyles: the ticked box follows --fx-accent
  const before = await ev(() => getComputedStyle(document.querySelector('#cb1 + .fx-tc')!).backgroundColor);
  await page.evaluate(() => document.documentElement.style.setProperty('--fx-accent', 'rgb(32, 160, 96)')); // theme-ok: a second test theme
  await page.waitForTimeout(400); // the colour transition (--fx-motion)
  const after = await ev(() => getComputedStyle(document.querySelector('#cb1 + .fx-tc')!).backgroundColor);
  check('theme swap restyles the controls', before !== after && after === 'rgb(32, 160, 96)', { before, after });

  // off: every control native again, values kept
  const kept = await ev(() => (document.querySelector('#num') as HTMLInputElement).value);
  await page.evaluate(() => (globalThis as any).tc.set('axf.themedControls.on', false));
  const off = await ev(() => ({ themed: document.querySelectorAll('[data-axf-themed]').length, controls: document.querySelectorAll('.fx-tc').length, title: document.querySelector('#tipbtn')!.getAttribute('title'), scroll: document.documentElement.classList.contains('fx-tc-scroll'), alertNative: String(window.alert).includes('native code'), num: (document.querySelector('#num') as HTMLInputElement).value }));
  check('off: nothing themed, titles and window.alert back, values kept', off.themed === 0 && off.controls === 0 && off.title === 'Saves the form' && !off.scroll && off.alertNative && off.num === kept, off);
  await page.evaluate(() => (globalThis as any).tc.set('axf.themedControls.on', true));
  check('on again: themed again', (await ev(() => document.querySelectorAll('[data-axf-themed]').length)) > 0);
  await page.screenshot({ path: join(dir, `themed-${v.name}.png`), fullPage: true });
  check('no page errors and no native dialog', errors.length === 0, errors);
  await page.context().close();
}

await browser.close();
server.close();
console.log(`\nthemed-controls: ${passed} passed, ${failed} failed (screenshots in ${dir})`);
process.exit(failed ? 1 : 0);
