/**
 * Main build status: replays the plugin's pure part against the framework runtime with the console's own assets.
 * Run by test.py:  npx -y tsx apps/console-web/plugins/main-build-status/widget-check.mjs <repo>
 * Prints one JSON line of facts; test.py asserts them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const imp = (p) => import(pathToFileURL(join(repo, p)).href);
const { AxfRuntime } = await imp('framework/core/runtime.ts');
const { validateAsset } = await imp('framework/core/validate.ts');
const { statusOn } = await imp('framework/core/engines/widgets.ts');
const core = await import('./web/core.ts');

const dir = join(repo, 'apps/console-web/src/assets');
// the console's assets as it registers them: the baked shared set, its own, its overrides (framework/cli/shared-assets.mjs)
const { appAssetFiles } = await import(pathToFileURL(join(repo, 'framework/cli/shared-assets.mjs')).href);
const assets = [...appAssetFiles(join(repo, 'apps/console-web'), repo).values()].map((v) => v.asset);
const manifest = JSON.parse(readFileSync(join(repo, 'apps/console-web/axf.manifest.json'), 'utf8'));
const rt = new AxfRuntime({ manifest, assets, storageKey: 'test:main-build-status' });
const diags = [];
rt.diagnostics.subscribe((d) => diags.push(d), true);
const now = Date.parse('2026-10-21T10:10:00Z');
const item = (state, extra = {}) => ({ repo: 'MossesX/AmberX-AXF', branch: 'main', workflow: 'android.yml', state, title: 't', name: 'n', sha: 'abc', url: '', runNumber: 1, event: 'push', startedAt: '2026-10-21T10:07:00Z', updatedAt: '2026-10-21T10:08:00Z', failedJobs: [], previous: null, error: '', ...extra });
const data = () => rt.assetOrNull('status', core.ASSET_ID)?.data ?? rt.registry.get?.('status', core.ASSET_ID)?.data;

// The plugin only supplies data now (axf.banner-data@1); the banner widgets plugin registers and places it (its own
// widget-check covers placement). This stand-in registers what is supplied, as that plugin does.
const supplied = [];
const supply = (w, s) => { supplied.push(s ? w : `-${w}`); if (s) rt.registry.register({ $axf: 'asset@1', type: s.type, id: w, name: s.name, version: '0.1.0', author: 'test', description: s.description, tags: s.tags, data: s.data }, 'app', 'test'); };
const out = { texts: {}, tones: {}, valid: [] };
for (const s of ['success', 'failure', 'running', 'unknown']) {
  const a = core.statusAsset(item(s), '', now);
  out.texts[s] = a.data.onLabel;
  out.tones[s] = a.data.onTone;
  out.valid.push(validateAsset(a).ok);
}
out.none = core.bannerText(null, now);
out.errorNoItem = core.statusAsset(null, 'boom', now).data.onLabel;
out.ago = [core.shortAgo('2026-10-21T10:09:50Z', now), core.shortAgo('2026-10-21T07:00:00Z', now), core.shortAgo('2026-10-18T10:00:00Z', now), core.shortAgo('x', now)];

core.paintBuild(rt, supply, null, '', now);
out.knownBefore = rt.badge(core.COUNTERS.known);
out.onBefore = statusOn(rt.badge(core.COUNTERS.known));
core.paintBuild(rt, supply, item('failure'), '', now);
out.supplied = [...new Set(supplied)];
out.failLabel = rt.registry.get('status', core.ASSET_ID)?.data?.onLabel ?? null;
out.counters = [rt.badge(core.COUNTERS.known), rt.badge(core.COUNTERS.running), rt.badge(core.COUNTERS.failing)];
out.repainted = rt.registry.has('status', core.ASSET_ID);
core.paintBuild(rt, supply, item('running'), '', now);
out.countersRunning = [rt.badge(core.COUNTERS.known), rt.badge(core.COUNTERS.running), rt.badge(core.COUNTERS.failing)];
out.attachedByItself = rt.hostAttachments('banner').length;
out.warnings = rt.terminal.lines.filter((l) => l.level === 'warn' && l.channel === 'widgets').map((l) => l.text);
out.conflicts = diags.filter((d) => String(d.kind ?? '').includes('conflict')).length;
console.log(JSON.stringify(out));
