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

// The plugin only supplies data now (axf.banner-data@1); the banner widgets plugin registers and places it (its own
// widget-check covers placement). This stand-in registers what is supplied, as that plugin does.
const supplied = [];
const supply = (w, s) => { supplied.push(s ? w : `-${w}`); if (s) rt.registry.register({ $axf: 'asset@1', type: s.type, id: w === 'alerts-count' ? 'alerts-bell' : w, name: s.name, version: '0.1.0', author: 'test', description: s.description, tags: s.tags, data: s.data }, 'app', 'test'); };
const out = { valid: core.ASSETS.map((a) => validateAsset(a)), banner: rt.assetOrNull('banner')?.id ?? null };
core.supplyBell(supply);
out.supplied = supplied;
out.registered = [rt.registry.has('action-button', core.ASSET_ID), rt.registry.has('counter', core.ASSET_ID)];
out.attachedByItself = rt.hostAttachments('banner').length;
void keys;
out.counter = [0, 5, 150].map((n) => counterText(n, 99, true));
rt.setBadge(core.COUNTER, 7);
out.badge = rt.badge(core.COUNTER);
out.toolbarBell = JSON.stringify(toolbar).includes('alerts.open') || JSON.stringify(toolbar).includes('alerts.unread');
out.warnings = rt.terminal.lines.filter((l) => l.level === 'warn' && l.channel === 'widgets').map((l) => l.text);
console.log(JSON.stringify(out));
