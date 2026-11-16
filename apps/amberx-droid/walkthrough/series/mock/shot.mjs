// Screenshots of the staged designer mock, for checking a scene or for a UI Review screenshot (axf shot).
//   node apps/amberx-droid/walkthrough/series/mock/shot.mjs <scene> [--skin id] [--step n] [--out file.png] [--phone] [--all]
// --all takes every scene at its last step. Uses Playwright's chromium (playwright-core from PLAYWRIGHT_CORE, a node_modules
// on the usual paths, or the recorder image); the page is served from the file, no network.
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, OUT } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const scene = args.find((a) => !a.startsWith('--') && SCENES.some((s) => s.id === a));
const all = args.includes('--all');
if (!scene && !all) { console.error(`usage: shot.mjs <${SCENES.map((s) => s.id).join('|')}> [--skin id] [--step n] [--out file] [--phone] | --all`); process.exit(2); }

function playwright() {
  const req = createRequire(import.meta.url);
  const roots = [process.env.PLAYWRIGHT_CORE, '/rec-app', '/tmp/axf-pw-overlay', join(here, '../../../../..'), process.cwd()].filter(Boolean);
  for (const r of roots) { try { return req(join(r, 'node_modules/playwright-core')); } catch { /* next */ } }
  try { return req('playwright-core'); } catch { /* none */ }
  throw new Error('playwright-core not found: set PLAYWRIGHT_CORE=<dir with node_modules/playwright-core>');
}

const { chromium } = playwright();
const outDir = resolve(flag('out-dir', join(here, '../../../../../.axf-shots/designer-mock')));
mkdirSync(outDir, { recursive: true });
const viewport = args.includes('--phone') ? { width: 412, height: 915 } : { width: 1440, height: 900 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
const shots = all ? SCENES.map((s) => ({ id: s.id, step: s.steps })) : [{ id: scene, step: Number(flag('step', SCENES.find((s) => s.id === scene).steps)) }];
const skin = flag('skin', 'clinic');
for (const s of shots) {
  const url = `file://${OUT}#${s.id}?skin=${encodeURIComponent(skin)}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(([id, sk]) => window.wtMock.scene(id, { skin: sk }), [s.id, skin]);
  for (let i = 0; i < s.step; i++) await page.evaluate(() => window.wtStep());
  await page.waitForTimeout(400);
  const file = all ? join(outDir, `${s.id}-${skin}.png`) : resolve(flag('out', join(outDir, `${s.id}-${skin}-${s.step}.png`)));
  await page.screenshot({ path: file });
  const state = await page.evaluate(() => window.wtMock.state());
  console.log(`${file}  ${JSON.stringify(state)}`);
}
await browser.close();
if (!existsSync(OUT)) process.exit(1);
