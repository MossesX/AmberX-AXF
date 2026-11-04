/**
 * voice-command@1 (core/engines/voice-command-rules.mjs): the type is registered (types, optional, late-optional,
 * asset-types order, never rolled, not shared), both validators give the same messages, the fixture replays
 * (generation from a command surface, confirm floors, matching with slots / wake words / tails / missing slots,
 * yes-no, help, coverage, merge keeping authored commands), every voice-command asset in the repo validates, the
 * schema carries every field, and the project manifest rule `framework.forFramework` is in the rules registry.
 * Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-voice-command.mts            (--write regenerates spec/fixtures/voice-command.json)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import * as V from '../core/engines/voice-command-rules.mjs';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const strip = (o: unknown) => JSON.parse(JSON.stringify(o));

/* ---- registered everywhere ---- */
ok(ASSET_TYPES.includes('voice-command'), 'voice-command is an asset type');
ok(OPTIONAL_TYPES.includes('voice-command'), 'voice-command is optional (older apps still validate)');
const spec = read('framework/schemas/asset-types.json');
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
eq(spec.types['voice-command'].roll, { slot: false, asset: false }, 'never rolled');
eq(spec.types['voice-command'].shared, false, 'not a shared look asset (each app ships its own)');
eq(spec.types['voice-command'].enums.source, [...V.VOICE_SOURCES], 'registry source enum = the rules file');
const rules = read('framework/schemas/project-rules.json');
ok(rules.rules.some((r: { id: string; check: { op: string; path: string } }) => r.id === 'for-framework' && r.check.op === 'boolean' && r.check.path === 'framework.forFramework'), 'project rule: framework.forFramework is a boolean');
ok(rules.rules.some((r: { id: string; check: { op: string } }) => r.id === 'for-framework-noted' && r.check.op === 'requiredWhen'), 'project rule: every app notes whether it is for the framework');

/* ---- the contract: computed here, replayed from the fixture ---- */
const NOW = '2026-11-04T15:00:00.000Z';
const surface = { app: 'expenses', forFramework: true, commands: [
  { id: 'expenses_add', title: 'Add an expense', run: { api: 'POST /api/expenses/v1/entries', mcp: 'expenses_add', cli: 'expenses add' }, input: { properties: { merchant: { type: 'string', description: 'Who was paid' }, amount: { type: 'number', description: 'Amount in dollars' }, date: { type: 'string', format: 'date' }, category: { type: 'string', enum: ['food', 'gas', 'personal', 'other'] }, account: { type: 'string' }, note: { type: 'string' } }, required: ['merchant', 'amount'] } },
  { id: 'expenses_list', title: 'List expenses', run: { api: 'GET /api/expenses/v1/entries', mcp: 'expenses_list' }, input: { properties: { date_from: { type: 'string' }, category: { type: 'string' } } } },
  { id: 'expenses_totals_get', run: { mcp: 'expenses_totals_get' }, input: { properties: { by: { type: 'string', enum: ['category', 'account', 'month'] } } } },
  { id: 'entries_delete', title: 'Delete an entry', run: { api: 'DELETE /api/expenses/v1/entries/{id}' }, input: { properties: { id: { type: 'string' } }, required: ['id'] } },
  { id: 'open_reports', title: 'Open reports', run: { action: 'expenses.reports' } },
] };
const generated = V.generateVoiceCommands(surface);
const good = generated;
const authoredAdd = { ...good.commands[0], phrases: ['spent {amount} at {merchant}', 'add an expense'], say: 'Got it: {amount} at {merchant}.', source: 'authored' as const };
const cases: Record<string, [string, unknown]> = {
  ok: ['voice-command', good],
  'not-an-object': ['voice-command', 'nope'],
  'bad-core': ['voice-command', { app: 'Expenses!', source: 'guess', wake: ['OK'], commands: 'none' }],
  'bad-command': ['voice-command', { app: 'x', commands: [{ id: 'Bad Id', title: '', effect: 'maybe', run: {}, phrases: [] }] }],
  'confirm-below-floor': ['voice-command', { app: 'x', commands: [{ id: 'wipe', title: 'Wipe', effect: 'destructive', confirm: 'never', run: { cli: 'x wipe' }, phrases: ['wipe it'] }] }],
  'undeclared-slot': ['voice-command', { app: 'x', commands: [{ id: 'add', title: 'Add', effect: 'write', run: { cli: 'x add' }, phrases: ['add {amount}'], say: 'Added {thing}' }] }],
  'two-text-slots': ['voice-command', { app: 'x', commands: [{ id: 'add', title: 'Add', effect: 'write', run: { cli: 'x add' }, slots: { a: { type: 'text' }, b: { type: 'text' } }, phrases: ['add {a} {b}'] }] }],
  'slots-only-phrase': ['voice-command', { app: 'x', commands: [{ id: 'add', title: 'Add', effect: 'write', run: { cli: 'x add' }, slots: { a: { type: 'money' } }, phrases: ['{a}'] }] }],
  'duplicate-id': ['voice-command', { app: 'x', commands: [{ id: 'a', title: 'A', effect: 'read', run: { cli: 'a' }, phrases: ['a'] }, { id: 'a', title: 'A', effect: 'read', run: { cli: 'a' }, phrases: ['a'] }] }],
  'other-type': ['job-type', { nope: true }],
};
const errors = Object.fromEntries(Object.entries(cases).map(([k, [t, d]]) => [k, V.voiceCommandErrors(t, d)]));
ok(errors.ok.length === 0, `generated asset validates: ${errors.ok.join('; ')}`);
ok(errors['not-an-object'].length === 1 && errors['bad-core'].length >= 3 && errors['bad-command'].length >= 4 && errors['confirm-below-floor'].length === 1 && errors['undeclared-slot'].length === 2 && errors['two-text-slots'].length === 1 && errors['slots-only-phrase'].length === 1 && errors['duplicate-id'].length === 1 && errors['other-type'].length === 0, 'every bad case is named');

const utterances = ['add an expense dunkin 4.25', 'expenses add dunkin donuts $12.50 category food date yesterday', 'add an expense of 5 dollars', 'add an expense', 'get totals by month', 'totals', 'add 12 dollars and 50 cents dunkin food', 'add an expense 3 bucks starbucks nov 3', 'delete an entry abc123', 'open reports please', 'what time is it', 'list expenses in expenses', 'please list the expenses for food'];
const matches = Object.fromEntries(utterances.map((u) => { const m = V.matchUtterance(good, u, { now: NOW }); return [u, m ? { id: m.command.id, slots: m.slots, missing: m.missing, confirm: m.confirm, question: m.question } : null]; }));
ok(matches['add an expense dunkin 4.25']?.id === 'expenses_add' && matches['add an expense dunkin 4.25']?.slots.amount === 4.25 && matches['add an expense dunkin 4.25']?.slots.merchant === 'dunkin' && matches['add an expense dunkin 4.25']?.confirm === false, 'a write with every required slot runs without asking');
eq(matches['expenses add dunkin donuts $12.50 category food date yesterday']?.slots, { merchant: 'dunkin donuts', amount: 12.5, category: 'food', date: '2026-11-03' }, 'wake word, dollars, multi-word text and a named tail');
ok(matches['add an expense of 5 dollars']?.missing.join() === 'merchant' && matches['add an expense of 5 dollars']?.confirm === true && /who was paid/.test(matches['add an expense of 5 dollars']?.question ?? ''), 'a missing required slot is asked for (the filler "of" is not a merchant)');
ok(matches['delete an entry abc123']?.confirm === true && /yes or no/i.test(matches['delete an entry abc123']?.question ?? ''), 'destructive always asks');
ok(matches['open reports please']?.id === 'open_reports' && matches['open reports please']?.confirm === false, 'navigation never asks');
ok(matches['what time is it'] === null, 'nothing fits → null');
ok(matches['add an expense 3 bucks starbucks nov 3']?.slots.date === '2026-11-03', 'month-day dates');
eq([V.yesOrNo('yeah do it'), V.yesOrNo('nah'), V.yesOrNo('no thanks'), V.yesOrNo('maybe')], [true, null, false, null], 'yes / no answers');
eq(V.confirmRule({ effect: 'read', confirm: 'always' }), 'always', 'a command may ask more than its floor');
eq(V.confirmRule({ effect: 'destructive', confirm: 'never' }), 'always', 'never less');
eq(V.sayFor(authoredAdd, { amount: 4.25, merchant: 'dunkin' }), 'Got it: 4.25 at dunkin.', 'answers fill slots');

const help = V.whatCanISay(good);
ok(help.length === 1 && help[0].commands.length === 5 && help[0].commands[0].id === 'expenses_totals_get' && help[0].commands.at(-1)!.id === 'open_reports', 'what can I say: reads, writes, destructive, navigation');
const coverage = V.voiceCoverage(good, surface);
ok(coverage.ok && coverage.total === 5, 'every surface command is covered');
const partial = V.voiceCoverage({ ...good, commands: good.commands.slice(1) }, surface);
eq(partial.missing, ['expenses_add'], 'a surface command without phrases is named');
const merged = V.mergeVoiceCommands({ ...good, commands: [authoredAdd, { ...good.commands[1], id: 'gone_cmd', source: 'generated' }] }, V.generateVoiceCommands({ ...surface, commands: [...surface.commands, { id: 'expenses_export', title: 'Export', run: { mcp: 'expenses_export_get' } }] }));
ok(merged.source === 'mixed' && merged.commands.find((c) => c.id === 'expenses_add')?.phrases[0] === 'spent {amount} at {merchant}' && merged.commands.some((c) => c.id === 'expenses_export') && !merged.commands.some((c) => c.id === 'gone_cmd'), 'regeneration keeps authored commands, adds new ones, drops generated ones the surface lost');
ok(V.matchUtterance(merged, 'spent 9 dollars at the packie', { now: NOW })?.slots.merchant === 'packie', 'an authored phrase matches');

/* ---- both validators agree ---- */
const asset = (d: unknown, id = 'voice-expenses') => ({ $axf: 'asset@1', type: 'voice-command', id, name: 'Expenses voice commands', version: '1', data: d });
for (const [k, [t, d]] of Object.entries(cases)) {
  if (t !== 'voice-command') continue;
  const a = validateAsset(asset(d));
  const b = engine.validateAsset(asset(d));
  if (k === 'not-an-object') { ok(!a.ok && !b.ok, 'both validators refuse non-object data (the envelope check says so first)'); continue; }
  ok(errors[k].every((e: string) => a.errors.some((x: string) => x.includes(e))), `core validator carries the rule messages (${k}): ${a.errors.join('; ')}`);
  ok(errors[k].every((e: string) => b.errors.some((x: string) => x.includes(e))), `build engine carries the rule messages (${k}): ${b.errors.join('; ')}`);
  eq(a.ok, b.ok, `both validators agree on ${k}`);
}

/* ---- every voice-command asset in the repo validates ---- */
const dirs = ['framework/assets/voice-command', ...readdirSync(new URL('apps/', root)).map((a) => `apps/${a}/src/assets/voice-command`)];
let files = 0;
for (const d of dirs) {
  if (!existsSync(new URL(d, root))) continue;
  for (const f of readdirSync(new URL(d + '/', root)).filter((x) => x.endsWith('.json'))) {
    const a = read(`${d}/${f}`); const r = validateAsset(a); files++;
    ok(r.ok, `${d}/${f} validates: ${r.errors.join('; ')}`);
  }
}

/* ---- schema ---- */
const schema = read('framework/schemas/json/voice-command.schema.json');
eq(Object.keys(schema.properties.data.properties).sort(), Object.keys(V.voiceCommandSchemaProperties()).sort(), 'the JSON Schema carries every field');

/* ---- fixture ---- */
const fixture = { $fixture: 'voice-command@1', now: NOW, surface, generated: strip(generated), errors, utterances: strip(matches), help: strip(help), coverage: strip(coverage), merged: strip(merged.commands.map((c) => [c.id, c.source, c.phrases[0]])) };
const file = new URL('fixtures/voice-command.json', import.meta.url);
if (process.argv.includes('--write')) { writeFileSync(file, JSON.stringify(fixture, null, 2) + '\n'); console.log('wrote', file.pathname); }
else { eq(strip(fixture), JSON.parse(readFileSync(file, 'utf8')), 'spec/fixtures/voice-command.json replays (run with --write after changing the rules)'); }
console.log(`✓ voice-command@1: ${n} checks pass (${files} asset file(s))`);
