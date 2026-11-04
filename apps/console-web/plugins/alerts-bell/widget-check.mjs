/**
 * Alerts bell: replays the plugin's pure part against the framework runtime with the console's own assets.
 * Run by test.py:  npx -y tsx apps/console-web/plugins/alerts-bell/widget-check.mjs <repo>
 * Prints one JSON line of facts; test.py asserts them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const imp = (p) => import(pathToFileURL(join(repo, p)).href);
const { AxfRuntime } = await imp('framework/core/runtime.ts');
const { validateAsset } = await imp('framework/core/validate.ts');
const { counterText } = await imp('framework/core/engines/widgets.ts');
const core = await import('./web/core.ts');

const dir = join(repo, 'apps/console-web/src/assets');
// the console's assets as it registers them: the baked shared set, its own, its overrides (framework/cli/shared-assets.mjs)
const { appAssetFiles } = await import(pathToFileURL(join(repo, 'framework/cli/shared-assets.mjs')).href);
const assets = [...appAssetFiles(join(repo, 'apps/console-web'), repo).values()].map((v) => v.asset);
const manifest = JSON.parse(readFileSync(join(repo, 'apps/console-web/axf.manifest.json'), 'utf8'));
const rt = new AxfRuntime({ manifest, assets, storageKey: 'test:alerts-bell' });
const toolbar = JSON.parse(readFileSync(join(dir, 'toolbar/console-search.json'), 'utf8'));
const keys = (side) => rt.banner().placed[side].map((p) => `${p.key}@${p.origin}`);

const out = { valid: core.ASSETS.map((a) => validateAsset(a)), banner: rt.assetOrNull('banner')?.id ?? null };
core.placeBell(rt, true, core.sideOf(undefined));
out.right = keys('right');
out.left0 = keys('left');
core.placeBell(rt, true, core.sideOf('left'));
out.left = keys('left');
out.rightAfterMove = keys('right');
core.placeBell(rt, false, 'right');
out.hidden = rt.hostAttachments('banner').filter((a) => a.origin === core.ID).length;
core.placeBell(rt, true, core.sideOf('nonsense'));
out.fallbackSide = keys('right').filter((k) => k.endsWith(core.ID)).length;
out.counter = [0, 5, 150].map((n) => counterText(n, 99, true));
rt.setBadge(core.COUNTER, 7);
out.badge = rt.badge(core.COUNTER);
rt.detachAll(core.ID);
out.afterDetachAll = rt.hostAttachments('banner').filter((a) => a.origin === core.ID).length;
out.toolbarBell = JSON.stringify(toolbar).includes('alerts.open') || JSON.stringify(toolbar).includes('alerts.unread');
out.warnings = rt.terminal.lines.filter((l) => l.level === 'warn' && l.channel === 'widgets').map((l) => l.text);
console.log(JSON.stringify(out));
