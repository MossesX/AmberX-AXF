#!/usr/bin/env node
/**
 * Split settings and parallel split have the full API (orchestrator-settings-collapsible-split s6): every setting and
 * action is reachable the same way through REST (server/__init__.py), MCP and voice (plugin.json commands, served by
 * plugin-commands@1 with spoken examples), the CLI (pipeline.mjs) and a console action / deep link (web/index.tsx),
 * and each one has help.
 *   node apps/console-web/plugins/build-orchestrator/parallel-api.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normSettings } from './pipeline-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const server = read('server/__init__.py');
const cli = read('pipeline.mjs');
const index = read('web/index.tsx');
const manifest = JSON.parse(read('plugin.json'));
const help = JSON.parse(read('help.json')).data.entries;
const commands = manifest.commands.items;
const cmd = (id) => commands.find((c) => c.id === id);
let n = 0; const ok = (v, m) => { assert.ok(v, m); n += 1; };

const KEYS = ['splitProvider', 'parallelSplit', 'parallelMax', 'parallelContract', 'parallelIntegrate'];

// settings: defaults (max parallel slots 4, ask, contract and integration on)
const d = normSettings({});
ok(d.parallelMax === 4 && d.parallelSplit === 'ask' && d.parallelContract === true && d.parallelIntegrate === true, 'parallel split defaults: ask, 4 slots, contract first, integration last');
ok(normSettings({ parallelMax: 99 }).parallelMax <= 12 && normSettings({ parallelSplit: 'nope' }).parallelSplit === 'ask', 'out-of-range settings fall back');

// REST: POST /pipeline/settings accepts every Split key; the per-build route and the request field exist
const allowed = /allowed = \{([^}]*)\}/s.exec(server)?.[1] ?? '';
for (const k of KEYS) ok(allowed.includes(`"${k}"`), `REST POST /pipeline/settings accepts ${k}`);
ok(/@router\.post\("\/pipeline\/parallel"\)/.test(server), 'REST POST /pipeline/parallel');
ok(/parallel=body\.get\("parallel"\)/.test(server), 'REST POST /pipeline/request takes parallel');

// MCP + voice: the manifest commands carry the same keys, routes and spoken examples
const set = cmd('pipeline-settings-set');
for (const k of KEYS) ok(set?.input?.properties?.[k], `MCP pipeline-settings-set takes ${k}`);
ok(set.input.properties.parallelSplit.enum.join() === 'auto,ask,off', 'parallelSplit is auto | ask | off');
ok(set.input.properties.parallelMax.minimum === 2 && set.input.properties.parallelMax.maximum === 12, 'parallelMax 2-12');
const par = cmd('pipeline-parallel');
ok(par?.route === 'POST /pipeline/parallel' && par.input.required.join() === 'id,parts', 'MCP pipeline-parallel {id, parts}');
ok(cmd('pipeline-request')?.input?.properties?.parallel, 'MCP pipeline-request takes parallel');
for (const c of [set, par]) ok(/Say '/.test(c.description), `${c.id} has a spoken example for voice`);
ok(manifest.commands.auto === true, 'commands served automatically (MCP tools, voice intents)');

// every command route has its server handler
for (const c of [set, par, cmd('pipeline-request'), cmd('pipeline-settings')]) {
  const [verb, path] = c.route.split(' ');
  ok(new RegExp(`@router\\.${verb.toLowerCase()}\\("${path.replace(/[/]/g, '\\/')}"\\)`).test(server), `${c.route} has a REST handler`);
}

// CLI: set k=v for the Split keys, parallel <id> <N|off|default>, request --parallel
ok(/if \(cmd === 'parallel'\)/.test(cli), 'CLI pipeline.mjs parallel');
ok(/parallel: flag\('parallel'\)/.test(cli), 'CLI pipeline.mjs request --parallel');
ok(/parallel <id> <2-12\|off\|default>/.test(cli), 'CLI usage lists parallel');
for (const k of ['parallelSplit', 'parallelMax', 'parallelContract', 'parallelIntegrate']) ok(cli.includes(k), `CLI set ${k}=…`);

// console actions / deep links
ok(/rt\.actions\.register\('build-orchestrator\.split-settings'/.test(index), 'deep link build-orchestrator.split-settings');
ok(/rt\.actions\.register\('build-orchestrator\.parallel'[\s\S]*?'pipeline\/parallel'/.test(index), 'console action build-orchestrator.parallel posts pipeline/parallel');

// help: the section, every field, the family card and both actions
for (const t of ['split-section', 'how-a-build-is-split', 'parallel-split', 'max-parallel-slots', 'shared-contract-step-first', 'integration-step-last',
  'parallel-family', 'parallel-builds', 'action:build-orchestrator.split-settings', 'action:build-orchestrator.parallel']) ok(help.some((e) => e.target === t && e.text), `help entry ${t}`);

console.log(`✓ parallel-api: ${n} checks (REST, MCP, voice, CLI, console actions, help)`);
