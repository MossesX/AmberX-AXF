#!/usr/bin/env node
/**
 * deep-link@1 registry: the URL that opens every plugin view, dialog and settings tab of the Dev Console (build
 * ui-api-parity-rule, Nov 8 2026, Brett: "Deep link per plugin view (URL that opens it) so agents can open any UI on
 * the phone"). Read from each console plugin's plugin.json (`provides`: view:, dialog:, settings-tab:), so a new plugin
 * view has its link the moment it is declared. The format is framework/core/engines/deep-link.mjs.
 *
 *   node framework/cli/deep-links.mjs                       every link (plugin, kind, id, URL)
 *   node framework/cli/deep-links.mjs get <id>              the link of one view / dialog / settings tab (by id)
 *   node framework/cli/deep-links.mjs url --view <id> [--dialog <id>] [--settings <tab>] [--do <action spec>]…
 *   --base <url>   the app's address (default $AXF_CONSOLE_URL or https://console.amberxai.com)
 *   --json         machine output
 *
 * An agent opens one on Brett's phone with axHub `amberx.open_url` (or the console's `console_link` MCP tool, which
 * answers the same URL). A link only opens things: an `--do` action runs only when it is a navigate / read action.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEEP_LINK_FRAME, deepLink } from '../core/engines/deep-link.mjs';

export const ROOT = resolve(process.env.AXF_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../..'));
export const DEFAULT_BASE = 'https://console.amberxai.com';
const PLUGINS = 'apps/console-web/plugins';
const KINDS = { view: 'view', dialog: 'dialog', 'settings-tab': 'settings' };

export const baseUrl = (b) => String(b || process.env.AXF_CONSOLE_URL || DEFAULT_BASE).replace(/\/+$/, '');

/** Every link: { plugin, folder, kind: view|dialog|settings, id, url }. */
export function links({ root = ROOT, base } = {}) {
  const dir = join(root, PLUGINS);
  const out = [];
  if (!existsSync(dir)) return out;
  for (const folder of readdirSync(dir).sort()) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue;
    const f = join(dir, folder, 'plugin.json');
    if (!existsSync(f)) continue;
    let p; try { p = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    for (const pv of p.provides ?? []) {
      const m = /^(view|dialog|settings-tab):(.+)$/.exec(String(pv));
      if (!m) continue;
      const kind = KINDS[m[1]];
      try { out.push({ plugin: p.name ?? folder, folder, kind, id: m[2], url: deepLink({ base: baseUrl(base), [kind]: m[2] }) }); }
      catch (e) { out.push({ plugin: p.name ?? folder, folder, kind, id: m[2], url: '', error: e.message }); }
    }
  }
  return out;
}

async function main(argv) {
  const json = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const all = (n) => args.flatMap((a, i) => (a === n && args[i + 1] ? [args[i + 1]] : []));
  const base = flag('--base');
  const [cmd = 'list'] = args;
  if (cmd === 'url') {
    const url = deepLink({ base: baseUrl(base), view: flag('--view'), dialog: flag('--dialog'), settings: flag('--settings'), do: all('--do') });
    console.log(json ? JSON.stringify({ $axf: DEEP_LINK_FRAME, url }) : url);
    return 0;
  }
  const rows = links({ base });
  if (cmd === 'get') {
    const id = args[1];
    const hit = rows.filter((r) => r.id === id);
    if (!hit.length) { console.error(`deep-links: no plugin view, dialog or settings tab "${id}"`); return 2; }
    console.log(json ? JSON.stringify(hit) : hit.map((r) => r.url).join('\n'));
    return 0;
  }
  if (cmd !== 'list') { console.error('usage: deep-links.mjs [list] | get <id> | url --view <id> [--dialog <id>] [--settings <tab>] [--do <spec>]… [--base <url>] [--json]'); return 2; }
  if (json) { console.log(JSON.stringify({ $axf: DEEP_LINK_FRAME, base: baseUrl(base), links: rows })); return 0; }
  for (const r of rows) console.log(`${r.folder.padEnd(24)} ${r.kind.padEnd(9)} ${r.id.padEnd(36)} ${r.url || `!! ${r.error}`}`);
  console.log(`${rows.length} links (${rows.filter((r) => r.kind === 'view').length} views)`);
  return rows.some((r) => r.error) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`deep-links: ${e.message}`); process.exit(1); });
}
