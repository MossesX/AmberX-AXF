#!/usr/bin/env node
/**
 * control-registry@1 (core/engines/control-registry.mjs; apps/console-web/lib/registry): the schema validates the fixture
 * and the committed index, hashing is stable, normalisation fills surfaces and gaps, declarations merge, the index
 * builds / diffs / exports / imports, queries answer, and the dispatcher resolves commands, CLI calls and phrases with
 * exact ids, aliases, synonyms, declared phrases and allowed values only (fixtures/control-registry.json replays the
 * cases), refusing what it should and gating the AI fallback on the Claude setting. No model is ever called.
 *
 *   node framework/spec/check-control-registry.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REGISTRY_FRAME, aiFallbackBrief, aiGate, applyDeclaration, buildIndex, canonical, checkParams, cliUsage, coerceParam, diffIndex, entryHash, exportIndex, fnv1a64, getEntry,
  importIndex, listEntries, mergeEntry, normalizeEntry, paramFromDecl, paramsFromSchema, resolve, resolveCli, resolveCommand, resolvePhrase, searchEntries, serializeIndex, surfacesOf, validateIndex, validateSchema,
} from '../core/engines/control-registry.mjs';
import { readUiApi, applyUiApi, effectOfRef } from '../../apps/console-web/lib/ui-api-parity/index.mjs';
import { readVoiceIntents, scanVoiceCommands, applyVoiceIntents } from '../../apps/console-web/lib/voice-api/index.mjs';
import { dispatch, aiAvailable } from '../../apps/console-web/lib/registry/dispatch.mjs';
import { collectControl } from '../../apps/console-web/lib/registry/collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const schema = JSON.parse(readFileSync(join(ROOT, 'contracts/control-registry@1.schema.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures/control-registry.json'), 'utf8'));
let n = 0;
const ok = (v, what) => { assert.ok(v, what); n++; };
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };

/* ---- hashing */
eq(fnv1a64('a'), 'af63dc4c8601ec8c', 'FNV-1a 64 of "a"');
eq(fnv1a64(''), 'cbf29ce484222325', 'FNV-1a 64 offset basis');
eq(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}', 'canonical sorts keys');

/* ---- schema validator */
eq(validateSchema({ type: 'object', required: ['a'], properties: { a: { type: 'string', pattern: '^x' } }, additionalProperties: false }, { a: 'y', b: 1 }), ['$.a: "y" does not match ^x', '$.b: not a known field'], 'subset validator');
eq(validateSchema({ anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, ['a', 1]).length, 1, 'anyOf');
eq(validateSchema({ $ref: '#/$defs/id' }, 'console-web/page/plan-studio', schema), [], 'id grammar');
eq(validateSchema({ $ref: '#/$defs/id' }, 'console-web/widget/x', schema).length, 1, 'type segment must be a known type');
eq(validateSchema({ $ref: '#/$defs/id' }, 'console-web/setting/axf.display.fontScale', schema), [], 'a setting key keeps its case');

/* ---- entries from the fixture */
const entries = fixture.entries.map(normalizeEntry);
ok(entries.every(Boolean), 'every fixture entry normalises');
const index = buildIndex(entries, { now: new Date('2026-11-10T12:00:00Z'), commit: 'fixture', collectors: ['fixture'] });
eq(validateIndex(schema, index), [], 'the fixture index validates against the contract');
eq(index.$axf, REGISTRY_FRAME, 'frame');
const page = getEntry(index, 'console-web/page/plan-studio');
eq(page.surfaces, { rest: true, mcp: true, cli: true, voice: ['open plan studio', 'plans'], deepLink: '?axf-view=plan-studio' }, 'surfaces filled: generic REST / MCP / CLI, declared voice, deep link from open');
ok(entries.find((e) => e.id === 'console-web/tool/follow-amber/switch').gaps.some((g) => g.what === 'voice'), 'a writable tool without a phrase is a voice gap');
ok(!entries.find((e) => e.id === 'console-web/tool/follow-amber/state').gaps?.some((g) => g.what === 'voice' || g.what === 'deepLink'), 'a plain read is neither a voice nor a deep-link gap');
ok(entries.find((e) => e.id === 'console-web/tool/notes/search').gaps.some((g) => g.what === 'params' && g.why.includes('run.q')), 'a free string parameter on a write is a params gap');
ok(normalizeEntry({ id: 'console-web/page/x', type: 'tool', label: 'x' }) === null, 'an id whose type segment disagrees with type is refused');
eq(normalizeEntry({ id: 'Console-Web/Page/Mixed', label: 'm' }).id, 'console-web/page/Mixed', 'owner and type fold to lower case, the name keeps its case; type comes from the id');
const h1 = entryHash(page); eq(entryHash({ ...page, source: { ...page.source, file: 'elsewhere.json' } }), h1, 'a moved source file does not change the hash');
ok(entryHash({ ...page, label: 'Plans' }) !== h1, 'a changed label changes the hash');

/* ---- params */
eq(paramFromDecl('status', 'enum:open,doing,done'), { name: 'status', type: 'enum', enum: ['open', 'doing', 'done'] }, 'control@1 enum decl');
eq(paramFromDecl('ids', 'string[]'), { name: 'ids', type: 'array', items: 'string' }, 'control@1 list decl');
eq(paramsFromSchema({ type: 'object', properties: { on: { type: 'boolean' }, n: { type: 'integer', minimum: 1, maximum: 5, default: 2 }, k: { enum: ['a', 'b'] } }, required: ['on'] }).map((p) => [p.name, p.type, p.required ?? false, p.min, p.max, p.default, p.enum]),
  [['on', 'boolean', true, undefined, undefined, undefined, undefined], ['n', 'integer', false, 1, 5, 2, undefined], ['k', 'enum', false, undefined, undefined, undefined, ['a', 'b']]], 'JSON Schema → params');
eq(coerceParam({ type: 'boolean' }, 'off'), false, 'boolean words');
eq(coerceParam({ type: 'enum', enum: ['recent', 'all'], enumLabels: { all: 'every console' } }, 'Every Console'), 'all', 'enum by label');
eq(coerceParam({ type: 'enum', enum: [1, 2, 3] }, '2'), 2, 'numeric enum from a string');
eq(coerceParam({ type: 'array' }, 'a, b and c'), ['a', 'b', 'c'], 'spoken list');
const setA = page.actions.find((a) => a.id === 'open');
eq(checkParams(setA, {}), { params: {}, errors: [] }, 'no params, nothing given');
const fs = getEntry(index, 'console-web/setting/axf.display.fontScale').actions.find((a) => a.id === 'set');
eq(checkParams(fs, { value: '1.2' }), { params: { value: 1.2 }, errors: [] }, 'string → number within range and step');
eq(checkParams(fs, { value: '1.25' }).errors, ['value must be in steps of 0.1 from 0.8'], 'step');
eq(checkParams(fs, { value: 2 }).errors, ['value must be at most 1.6'], 'range');
eq(checkParams(fs, {}).errors, ['value is required: a number (at least 0.8, at most 1.6, in steps of 0.1)'], 'required with the allowed values');
eq(checkParams(fs, { value: 1, bogus: 1 }).errors, ['bogus is not a parameter of set (it takes value)'], 'unknown parameters refused');
const notesRun = getEntry(index, 'console-web/tool/notes/search').actions[0];
eq(checkParams(notesRun, { q: 'x', extra: 1 }).params, { q: 'x', body: { extra: 1 } }, 'a free-form body absorbs unknown fields');

/* ---- declarations + merge */
const decl = { $axf: REGISTRY_FRAME, owner: { id: 'hostinger', label: 'Hostinger', kind: 'provider', via: 'axhub' }, entries: [
  { id: 'console-web/page/plan-studio', synonyms: ['planner'], actions: [{ id: 'open', phrases: ['planning time'] }] },
  { id: 'console-web/tool/notes/search', actions: [{ id: 'run', params: [{ name: 'q', type: 'string', maxLength: 200 }] }] },
  { id: 'hostinger/tool/dns', type: 'tool', label: 'DNS records', actions: [{ id: 'list', effect: 'read', run: 'provider:hostinger/dns-list', params: [{ name: 'domain', type: 'string', pattern: '^[a-z0-9.-]+$', required: true }] }] },
  { id: 'console-web/tool/follow-amber/state', remove: true },
  { id: 'nope/tool/x' },
] };
const applied = applyDeclaration(entries, decl, { file: 'registry.d/test.json' });
eq(applied.errors, ['registry.d/test.json: nope/tool/x is new here, so it needs type and label'], 'a new entry needs type and label');
eq(applied.owners.map((o) => o.id), ['hostinger'], 'declared owner');
const idx2 = buildIndex(applied.entries, { owners: applied.owners });
eq(validateIndex(schema, idx2), [], 'the merged index validates');
eq(getEntry(idx2, 'console-web/page/plan-studio').synonyms, ['planner'], 'synonyms merged');
ok(getEntry(idx2, 'console-web/page/plan-studio').actions[0].phrases.includes('planning time') && getEntry(idx2, 'console-web/page/plan-studio').actions[0].phrases.includes('open plan studio'), 'phrases union');
ok(!getEntry(idx2, 'console-web/tool/notes/search').gaps?.some((g) => g.what === 'params'), 'a declared maxLength closes the params gap');
ok(getEntry(idx2, 'console-web/tool/follow-amber/state') === null, 'remove: true drops the entry');
eq(idx2.owners.find((o) => o.id === 'hostinger').kind, 'provider', 'owner described');
const merged = mergeEntry(page, { label: 'Plans', actions: [{ id: 'close', effect: 'navigate', run: 'control:console.nav/act/back' }] });
eq(merged.actions.map((a) => a.id), ['open', 'close'], 'merge adds an action');

/* ---- diff, export, import, serialize */
const d = diffIndex(index, idx2);
eq(d.removed, ['console-web/tool/follow-amber/state'], 'diff removed');
eq(d.added, ['hostinger/tool/dns'], 'diff added');
ok(d.changed.some((c) => c.id === 'console-web/page/plan-studio' && c.fields.includes('synonyms')), 'diff changed fields');
ok(diffIndex(index, buildIndex(entries, { now: new Date('2030-01-01') })).same, 'a rebuild with the same facts is the same index');
const exp = exportIndex(index, { now: new Date('2026-11-10T13:00:00Z') });
const imp = importIndex(exp, schema);
ok(imp.ok && imp.index.hash === index.hash && !('exportedAt' in imp.index), 'export → import round-trips, exportedAt dropped');
eq(importIndex('{"$axf":"nope"}', schema).errors, ['$axf must be control-registry@1'], 'import refuses another frame');
ok(!importIndex({ ...index, hash: '0000000000000000' }, schema).ok, 'import refuses a wrong hash');
eq(JSON.parse(serializeIndex(index)).entries.length, index.entries.length, 'one-entry-per-line file parses');

/* ---- queries */
eq(getEntry(index, 'plans').id, 'console-web/page/plan-studio', 'by alias');
eq(getEntry(index, 'Plan Studio').id, 'console-web/page/plan-studio', 'by label');
eq(getEntry(index, 'plan-studio').id, 'console-web/page/plan-studio', 'by open target');
eq(listEntries(index, { type: 'tool' }).total, entries.filter((e) => e.type === 'tool').length, 'list by type');
eq(listEntries(index, { owner: 'console-web', q: 'font' }).items.map((e) => e.id), ['console-web/setting/axf.display.fontScale'], 'list by owner + words');
eq(listEntries(index, { surface: 'voice' }).items.map((e) => e.id), ['console-web/page/plan-studio', 'console-web/setting/axf.display.fontScale'], 'list by surface');
eq(listEntries(index, { needsAI: true }).items.map((e) => e.id), ['console-web/tool/ai-assistant/ask'], 'list needsAI');
eq(searchEntries(index, 'follow amber').slice(0, 2).map((h) => h.entry.id), ['console-web/plugin/follow-amber', 'console-web/tool/follow-amber/switch'], 'search ranks the exact label first, the synonym holder next');
ok(surfacesOf(page).rest === 'POST /api/control/console-web/page/plan-studio/<action>' && surfacesOf(page).open === 'console_open screen plan-studio', 'generic surfaces projected');
ok(cliUsage(getEntry(index, 'console-web/setting/axf.display.fontScale'))[1].includes('--value <a number (at least 0.8, at most 1.6, in steps of 0.1)>'), 'CLI usage lists allowed values');

/* ---- resolving: fixture replay */
for (const c of fixture.cases) {
  const r = resolve(index, c.input, c.opts ?? {});
  const got = r.ok ? { ok: true, entry: r.entry, action: r.action, params: r.params } : { ok: false, code: r.code, ...(c.expect.entry ? { entry: r.entry } : {}), ...(c.expect.candidates ? { candidates: r.candidates.map((x) => x.id) } : {}), ...(c.expect.errors ? { errors: r.errors } : {}) };
  eq(got, c.expect, `case: ${c.name}`);
}
ok(resolveCommand(index, { id: 'nope' }).gap.declare.includes('plugin.json control'), 'not_found says where to declare it');
ok(resolveCli(index, ['console-web/page/plan-studio', 'dance']).code === 'not_found' || resolveCli(index, ['console-web/page/plan-studio', 'dance']).ok === false, 'an unknown action is refused');
eq(resolvePhrase(index, '').code, 'validation', 'empty phrase');

/* ---- the AI gate */
const nf = resolve(index, 'open the kitchen sink');
eq(nf.code, 'not_found', 'nothing matches');
eq(aiGate(nf, { available: false }).fallback, false, 'gate closed: deterministic answer stands');
eq(aiGate(nf, { available: true }).fallback, true, 'gate open: not_found may fall to Claude');
eq(aiGate(resolve(index, 'open plan studio'), { available: true }).fallback, false, 'a resolved command never goes to a model');
eq(aiGate(resolve(index, 'set font scale to 9'), { available: true }).fallback, false, 'a validation error never goes to a model');
const needs = resolve(index, 'ask the assistant what time it is');
eq(needs.code, 'needs_ai', 'needsAI action');
eq(aiGate(needs, { available: false }).fallback, false, 'needsAI with the gate closed stays closed');
eq(aiGate(needs, { available: true }).fallback, true, 'needsAI with the gate open may run');
const brief = aiFallbackBrief(index, 'open the kitchen sink', nf);
ok(brief.$axf === 'control-registry-fallback@1' && brief.answer.includes('allowed values') && Array.isArray(brief.candidates), 'the fallback brief hands the model ids and allowed values only');
eq(aiAvailable({ env: { AXF_CLAUDE_AVAILABLE: '1' } }), { available: true, source: 'env' }, 'env override on');
eq(aiAvailable({ env: { AXF_CLAUDE_AVAILABLE: '0' } }), { available: false, source: 'env' }, 'env override off');
const off = dispatch(index, 'open the kitchen sink', { env: { AXF_CLAUDE_AVAILABLE: '0' } });
ok(!off.ok && off.code === 'not_found' && off.ai.available === false && off.ai.fallback === false && Array.isArray(off.candidates) && off.gap, 'dispatch with the gate closed: closest matches and the gap, no model');
let asked = null;
const on = dispatch(index, 'open the kitchen sink', { env: { AXF_CLAUDE_AVAILABLE: '1' }, ask: (b) => { asked = b; return { id: 'console-web/page/plan-studio', action: 'open', params: {} }; } });
ok(asked?.$axf === 'control-registry-fallback@1' && on.ok && on.entry === 'console-web/page/plan-studio' && on.ai.fallback === true && on.how.kind === 'ai', 'dispatch with the gate open: the model proposes, the registry resolves');
const bad = dispatch(index, 'open the kitchen sink', { env: { AXF_CLAUDE_AVAILABLE: '1' }, ask: () => ({ id: 'console-web/setting/axf.display.fontScale', action: 'set', params: { value: 99 } }) });
ok(!bad.ok && bad.code === 'validation' && bad.ai.fallback === true, 'a model answer outside the allowed values is refused like any other');
const none = dispatch(index, 'open the kitchen sink', { env: { AXF_CLAUDE_AVAILABLE: '1' }, ask: () => ({ none: 'nothing fits' }) });
ok(!none.ok && none.code === 'not_found' && none.ai.answer === 'nothing fits', 'a model that finds nothing leaves the deterministic answer');
const direct = dispatch(index, 'open plan studio', { env: { AXF_CLAUDE_AVAILABLE: '1' }, ask: () => { throw new Error('must not be called'); } });
ok(direct.ok && direct.ai.fallback === false, 'a deterministic hit never asks the model, even with the gate open');

/* ---- ui-api@1 and voice-intents@1 readers */
const ui = readUiApi({ ui: { $axf: 'ui-api@1', views: { 'plan-studio': { state: ['plan-studio/plans'], actions: { 'Park plan': 'plan-studio/park', 'Open settings': 'settings:plugins/plan-studio', 'Delete plan': 'action:plans.delete' }, uiOnly: { 'Drag to reorder': 'reorder is a pointer gesture; order is set through plans set order' } } } } });
eq(ui.errors, [], 'ui-api reads');
eq(effectOfRef('settings:plugins/x'), 'navigate', 'opening navigates'); eq(effectOfRef('action:plans.delete'), 'destructive', 'deleting destroys'); eq(effectOfRef('a/b', new Map([['a/b', { kind: 'read' }]])), 'read', 'a plugin read');
const withUi = applyUiApi(entries, { ui: { $axf: 'ui-api@1', views: { 'plan-studio': { state: ['plan-studio/plans'], actions: { 'Park plan': 'plan-studio/park' }, uiOnly: { 'Drag to reorder': 'reorder is a pointer gesture' } } } } }, { app: 'console-web', folder: 'plan-studio' });
const ps = buildIndex(withUi.entries).entries.find((e) => e.id === 'console-web/page/plan-studio');
ok(ps.state.read === 'plan-studio/plans' && ps.actions.some((a) => a.id === 'park-plan' && a.run === 'plan-studio/park') && ps.gaps.some((g) => g.what === 'control:Drag to reorder'), 'ui-api state, actions and uiOnly land on the page entry');
const vi = readVoiceIntents({ voice: { $axf: 'voice-intents@1', intents: [{ id: 'fa.on', phrases: ['Follow me!'], entry: 'console-web/tool/follow-amber/switch', action: 'run', params: { on: true } }, { id: 'bad', phrases: [] }] } });
eq(vi.errors, ['plugin.json: voice.intents[1] needs an id and at least one phrase'], 'voice intents checked');
eq(vi.intents[0].phrases, ['follow me'], 'phrases folded');
const withVoice = buildIndex(applyVoiceIntents(entries, vi.intents).entries);
ok(getEntry(withVoice, 'console-web/tool/follow-amber/switch').actions[0].phrases.includes('follow me'), 'intent phrases land on the action');
const scanned = scanVoiceCommands(`registerVoiceCommands(ID, [\n  { id: 'tasks.today', phrases: ['whats due today', "what is due"], action: 'tasks.open:today' },\n  { id: computed, phrases: P, action: 'x' },\n]);`);
eq(scanned.commands, [{ id: 'tasks.today', phrases: ['whats due today', 'what is due'], action: 'tasks.open:today', line: 1 }], 'AmberX voice commands scanned from text');
eq(scanned.unread.length, 1, 'computed ones are reported, never guessed');

/* ---- the real collectors + the committed index */
const control = collectControl();
ok(control.length >= 23 && control.every((e) => normalizeEntry(e)), 'every control@1 target is an entry');
const theme = normalizeEntry(control.find((e) => e.id === 'console-web/display/tokens.theme'));
eq(theme.actions.find((a) => a.id === 'set').params[0].enum.length, 16, 'token paths enumerated as allowed values');
ok(theme.state.fields.length === 16 && theme.state.fields.every((f) => f.type === 'color'), 'token fields typed');
const layout = normalizeEntry(control.find((e) => e.id === 'console-web/display/tokens.layout'));
ok(layout.state.fields.some((f) => f.type === 'number' && f.min !== undefined && f.max !== undefined) && layout.state.fields.some((f) => f.type === 'enum'), 'layout fields carry ranges and enums');
const items = normalizeEntry(control.find((e) => e.id === 'console-web/tool/amberx.items'));
ok(items.actions.find((a) => a.id === 'remove').confirm === true && items.actions.find((a) => a.id === 'move').params.some((p) => p.name === 'list'), 'entity acts: destructive confirm, act inputs as params');
const file = join(ROOT, '_claude/builds/registry/index.json');
if (existsSync(file)) {
  const committed = importIndex(readFileSync(file, 'utf8'), schema);
  ok(committed.ok, `the committed index validates: ${committed.errors?.slice(0, 3).join('; ') ?? ''}`);
  ok(committed.index.entries.length > 1000, 'the committed index covers the repo');
  ok(getEntry(committed.index, 'console-web/page/plan-studio') && getEntry(committed.index, 'console-web/display/tokens.theme'), 'the committed index has the console pages and token sets');
}

console.log(`✓ control-registry@1 — ${n} checks`);
