#!/usr/bin/env node
/**
 * The Split section (Settings → Plugins → Build orchestrator → Split) is wired: one collapsible block for every split
 * option, its own settings panel, reachable by the deep link build-orchestrator.split-settings (and
 * build-orchestrator.open:split), and every value it saves is a key the pipeline-settings@1 REST route accepts.
 *   node apps/console-web/plugins/build-orchestrator/split-settings.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const split = read('web/split-settings.tsx');
const index = read('web/index.tsx');
const ui = read('web/ui.tsx');
const server = read('server/__init__.py');
const help = JSON.parse(read('help.json')).data.entries;

// one collapsible block with a stable id the deep link opens
assert.match(split, /<details className="pd-add oc-split" id=\{SPLIT_SECTION_ID\}/, 'the Split section is a <details> block');
assert.match(split, /export const SPLIT_SECTION_ID = 'orch-split-settings'/);
assert.match(split, /data-help="split-section"/);
// its own settings panel, opened expanded
assert.match(index, /id: 'build-orchestrator\.split', tab: 'build-orchestrator', title: 'Split'.*<SplitSettings api=\{pipeApi\} open \/>/);
// the deep link: an action and the open(arg) route both land on the panel and open the block
assert.match(index, /rt\.actions\.register\('build-orchestrator\.split-settings'/);
assert.match(index, /\/\^split\(-settings\)\?\$\/i\.test\(id\).*flashWhenReady\(openSplitSection/);
assert.match(ui, /SETTINGS_TABS = \[[^\]]*'split'/);
// every key the section saves is accepted by POST /pipeline/settings
const saved = [...split.matchAll(/save\(\{ (\w+):/g)].map((m) => m[1]);
assert.ok(saved.length >= 1, 'the section saves at least one setting');
const allowed = /allowed = \{([^}]*)\}/s.exec(server)?.[1] ?? '';
for (const k of saved) assert.ok(allowed.includes(`"${k}"`), `POST /pipeline/settings accepts ${k}`);
// help for the section and its fields
for (const t of ['split-section', 'how-a-build-is-split']) assert.ok(help.some((e) => e.target === t), `help entry ${t}`);

console.log(`✓ split-settings: collapsible section, settings panel, deep link, ${saved.length} saved key(s) accepted by REST, help`);
