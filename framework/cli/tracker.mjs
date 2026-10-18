#!/usr/bin/env node
/**
 * tracker — builds tracker.json (what's built, what's not) from the feature catalog and the status map.
 *
 *   node framework/cli/tracker.mjs            write tracker.json at the repo root and print coverage
 *   node framework/cli/tracker.mjs --check    exit 1 if any catalog item has no status
 *
 * Inputs
 *   framework/catalog/catalog.json  every feature (tabs → groups → items), generated from the checklist
 *   framework/catalog/status.json   id → { status, wave, module?, notes? }  (maintained by hand / by the console)
 *
 * status: built | partial | placeholder | planned     wave: 1 | 2 | 3
 * The AXF Dev Console reads tracker.json (from the repo on GitHub or bundled) and lets you edit status.json.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLibrariesIndex } from './libraries.mjs';
import { buildPlan } from './plan.mjs';
import { dataPath } from './persist.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(FRAMEWORK_DIR, '..');
const catalog = JSON.parse(readFileSync(join(FRAMEWORK_DIR, 'catalog/catalog.json'), 'utf8'));
const statusFile = dataPath('framework/catalog/status.json');
const status = existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')) : {};
const check = process.argv.includes('--check');

const STATUSES = ['built', 'partial', 'placeholder', 'planned'];
const items = [];
const missing = [];
for (const tab of catalog.tabs) {
  for (const group of tab.groups) {
    for (const it of group.items) {
      const s = status[it.id];
      if (!s) missing.push(it.id);
      items.push({ id: it.id, tab: tab.id, group: group.id, title: it.title, tag: it.tag, status: s?.status ?? 'planned', wave: s?.wave ?? (it.recommended ? 1 : 3), module: s?.module ?? null, notes: s?.notes ?? '' });
      for (const sug of it.suggests ?? []) {
        const ss = status[sug.id];
        items.push({ id: sug.id, tab: tab.id, group: group.id, parent: it.id, title: sug.title, tag: 'suggested', status: ss?.status ?? 'planned', wave: ss?.wave ?? 3, module: ss?.module ?? null, notes: ss?.notes ?? '' });
      }
    }
  }
}
for (const it of items) if (!STATUSES.includes(it.status)) throw new Error(`${it.id}: unknown status "${it.status}"`);

const summary = {};
for (const tab of catalog.tabs) {
  const rows = items.filter((i) => i.tab === tab.id && !i.parent);
  summary[tab.id] = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  summary[tab.id].total = rows.length;
  summary[tab.id].coverage = rows.length ? Math.round((rows.filter((r) => r.status === 'built').length / rows.length) * 100) : 0;
}
const tracker = { $axf: 'tracker@1', frameworkVersion: catalog.frameworkVersion, generatedAt: new Date().toISOString(), summary, items };
writeFileSync(dataPath('tracker.json'), JSON.stringify(tracker, null, 2) + '\n');
writeLibrariesIndex();
buildPlan();

for (const [tab, s] of Object.entries(summary)) console.log(`${tab.padEnd(12)} built ${String(s.built).padStart(3)}  partial ${String(s.partial).padStart(3)}  placeholder ${String(s.placeholder).padStart(3)}  planned ${String(s.planned).padStart(3)}   ${s.coverage}% built`);
if (missing.length) console.log(`${missing.length} item(s) without a status in status.json${check ? '' : ' (treated as planned)'}`);
if (check && missing.length) process.exit(1);
