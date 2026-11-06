#!/usr/bin/env node
/**
 * screen-layouts — read the layouts plugin screens declare (screen-layouts@1, framework/spec/SCREEN-LAYOUTS.md).
 *
 *   node framework/cli/screen-layouts.mjs list [--app apps/console-web] [--json]      every screen with layouts
 *   node framework/cli/screen-layouts.mjs review --screen <view> [--app …] [--json]   what UI Review's Layout dropdown may
 *                                                                                     offer for a screen
 *
 * `review` prints only that screen's declared layouts with the default marked, or "no layout variants" for a screen
 * without them (Brett, Nov 4 2026: "So UI Review will only allow you to select from the three layouts it is going to
 * generate.").
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewLayoutChoices, screensOfManifests } from '../core/engines/screen-layouts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The plugin.json manifests of one app (`plugins/` or `src/plugins/`; "_" folders are templates, not plugins). */
export function appManifests(app, root = ROOT) {
  const out = [];
  for (const dir of [join(root, app, 'plugins'), join(root, app, 'src', 'plugins')]) {
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir).sort()) {
      const f = join(dir, n, 'plugin.json');
      if (n.startsWith('_') || n.startsWith('.') || !existsSync(f)) continue;
      out.push(JSON.parse(readFileSync(f, 'utf8')));
    }
  }
  return out;
}

export function main(argv) {
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const json = argv.includes('--json');
  const cmd = argv[0];
  const app = flag('app') ?? 'apps/console-web';
  if (cmd !== 'list' && cmd !== 'review') {
    console.error('Usage: screen-layouts list [--app apps/console-web] [--json] | review --screen <view> [--app …] [--json]');
    return 2;
  }
  const screens = screensOfManifests(appManifests(app));
  if (cmd === 'list') {
    if (json) console.log(JSON.stringify(screens, null, 2));
    else if (!Object.keys(screens).length) console.log(`${app}: no screen declares layouts yet`);
    else for (const [view, s] of Object.entries(screens)) console.log(`${view}  ${s.layouts.map((l) => (l.id === s.default ? `[${l.label}]` : l.label)).join(' · ')}  (${s.plugin})`);
    return 0;
  }
  const view = flag('screen');
  if (!view) { console.error('review needs --screen <view>'); return 2; }
  const choice = reviewLayoutChoices(screens, view.replace(/^\/+/, ''));
  if (json) console.log(JSON.stringify(choice, null, 2));
  else if (choice.disabled) console.log(`${view}: ${choice.reason}`);
  else for (const o of choice.options) console.log(o.label);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
