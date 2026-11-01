/**
 * agent-card@1 (core/engines/agent-card-rules.mjs): the type is registered (types, optional, late-optional, asset-types
 * order, a shared appearance slot, never rolled), the fixture replays (defaults, every starter's card model, normalize,
 * employee ids, bars, errors), both validators give the same messages, every starter validates and is distinct, the
 * schema carries every field, and defaults.json names a starter. Kotlin twin deferred (PORTING.md).
 *   npx -y tsx framework/spec/check-agent-card.mts
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { validateAsset } from '../core/validate';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { appearanceSlotTypes } from '../core/engines/appearance';
import { AGENT_CARD_SAMPLE, CARD_ENUMS, CARD_FIELDS, agentCardErrors, barcodeBars, cardModel, employeeId, normalizeCard } from '../core/engines/agent-card-rules.mjs';
import * as engine from '../cli/build-engine.mjs';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));

/* ---- registered everywhere ---- */
ok(ASSET_TYPES.includes('agent-card'), 'agent-card is an asset type');
ok(OPTIONAL_TYPES.includes('agent-card'), 'agent-card is optional (older apps still validate)');
ok(appearanceSlotTypes().includes('agent-card'), 'agent-card is a shared appearance slot (axHub carries the default design to every app)');
const spec = read('framework/schemas/asset-types.json');
eq(Object.keys(spec.types), [...ASSET_TYPES], 'asset-types.json lists the types in the TS order (Kotlin reads the same file)');
eq(Object.keys(spec.types).at(-1), 'uac-policy', 'uac-policy stays last');
eq(spec.types['agent-card'].enums, CARD_ENUMS, 'registry enums = the rules file');
eq(spec.types['agent-card'].roll, { slot: false, asset: false }, 'never rolled');

/* ---- fixture replay ---- */
const fx = read('framework/spec/fixtures/agent-card.json');
eq(fx.sample, AGENT_CARD_SAMPLE, 'sample agent');
eq(fx.defaults, normalizeCard(null), 'defaults');
const starters = readdirSync(new URL('framework/assets/agent-card/', root)).map((f) => read(`framework/assets/agent-card/${f}`));
eq(Object.keys(fx.starters).sort(), starters.map((a) => a.id).sort(), 'fixture covers every starter');
for (const a of starters) {
  eq(fx.starters[a.id].normalized, normalizeCard(a.data), `${a.id}: normalized`);
  eq(fx.starters[a.id].model, cardModel(a.data, AGENT_CARD_SAMPLE.identity, AGENT_CARD_SAMPLE.stats), `${a.id}: card model`);
}
eq(fx.normalized['unknown-dropped'], normalizeCard({ design: 'poster', front: ['name', 'shoeSize', 'name'], labels: { name: ' Who ', bogus: 'x' }, extra: 1 }), 'normalize drops unknowns');
eq(fx.normalized['not-an-object'], normalizeCard('nope'), 'normalize of junk = defaults');
eq(fx.models['no-identity'], cardModel({ front: ['name', 'employeeId', 'jobs'], code: 'barcode' }, {}, {}), 'model with nothing known');
eq(fx.models['qr-page'], cardModel({ code: 'qr', front: ['email'] }, { id: 'kat', page: 'axf://agent-swarm/kat' }, {}), 'qr shows the page link; email derives from the id');
for (const [id, v] of Object.entries(fx.employeeIds)) eq(employeeId(id), v, `employee id ${id}`);
for (const [t, v] of Object.entries(fx.bars)) eq(barcodeBars(t), v, `bars "${t}"`);

/* ---- errors: fixture, and the build engine gives the same messages ---- */
const cases: Record<string, [string, unknown]> = {
  ok: ['agent-card', { design: 'license', front: ['name'], labels: { name: 'Who' } }],
  'bad-enums': ['agent-card', { design: 'poster', finish: 'chrome', code: 'nfc' }],
  'bad-fields': ['agent-card', { front: ['name', 'shoeSize'], back: 'jobs', labels: { bogus: 'x', name: '' } }],
  'too-many': ['agent-card', { front: Array(13).fill('name') }],
  'not-an-object': ['agent-card', 'nope'],
  'other-type': ['button', { design: 'poster' }],
};
for (const [k, [t, d]] of Object.entries(cases)) eq(agentCardErrors(t, d), fx.errors[k], `errors: ${k}`);
eq(fx.errors.ok, [], 'a good card has no errors');
ok(fx.errors['bad-enums'].length === 3, 'three bad enums named');
const env = (data: unknown) => ({ $axf: 'asset@1', type: 'agent-card', id: 'x-card', name: 'X', version: '1.0.0', data });
for (const [k, [t, d]] of Object.entries(cases)) {
  if (t !== 'agent-card' || typeof d !== 'object') continue;
  const ts = validateAsset(env(d)).errors.filter((e) => e.startsWith('data.'));
  const cli = (engine as unknown as { validateAsset: (a: unknown) => { errors: string[] } }).validateAsset(env(d)).errors.filter((e: string) => e.startsWith('data.'));
  eq(cli, ts, `both validators agree: ${k}`);
}

/* ---- starters: valid, distinct designs, the four Brett asked for ---- */
for (const a of starters) eq(validateAsset(a).errors, [], `${a.id} validates`);
eq(new Set(starters.map((a) => a.data.design)).size, 4, 'four distinct designs');
eq(starters.map((a) => a.id).sort(), ['backstage-pass', 'corporate-badge', 'license', 'trading-card'], 'the four starters');
const lic = starters.find((a) => a.id === 'license')!;
eq(cardModel(lic.data, AGENT_CARD_SAMPLE.identity).front.find((l) => l.id === 'hiredAt')?.label, 'Issued', 'license: issue date = hire date');
ok(starters.find((a) => a.id === 'trading-card')!.data.back.includes('successRate'), 'trading card: stats on the back');
eq(read('framework/defaults.json')['agent-card'], 'corporate-badge', 'defaults.json names a starter');

/* ---- schema ---- */
const schema = read('framework/schemas/json/agent-card.schema.json');
const dataProps = schema.properties.data.properties;
for (const k of [...Object.keys(CARD_ENUMS), 'front', 'back', 'labels']) ok(k in dataProps, `schema has data.${k}`);
eq(dataProps.front.items.enum, Object.keys(CARD_FIELDS), 'schema lists every card field');

console.log(`✓ agent-card: ${n} checks passed`);
