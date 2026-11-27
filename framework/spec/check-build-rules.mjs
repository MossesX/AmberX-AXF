#!/usr/bin/env node
/**
 * build-rules@1 conformance: schema validation, the migration losing nothing (a small inventory in the fixture and the
 * real one against the committed seed), briefBlocks for sample builds, history append on edit / toggle / add / remove /
 * restore, a disabled rule being skipped, the locked store round trip, and the schema snapshots.
 *   node framework/spec/check-build-rules.mjs           check
 *   node framework/spec/check-build-rules.mjs --write   regenerate fixtures/build-rules.json's expected outputs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as B from '../core/build-rules.mjs';
import * as M from '../cli/build-rules-migrate.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIX = join(ROOT, 'framework/spec/fixtures/build-rules.json');
const WRITE = process.argv.includes('--write');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AT = '2026-11-15T14:00:00Z';
const AT1 = '2026-11-15T14:01:00Z';
const AT2 = '2026-11-15T14:02:00Z';

// ------------------------------------------------------------------ inputs

/** A small inventory in the shape inventory-build.mjs writes: a rules-file bullet, a brief bullet, a code constant, a template line, a shell comment. */
const INVENTORY = {
  $axf: 'build-rules-inventory@1', build: 'build-rules-tab-gate-rules-vps-owns', pass: 2,
  rules: [
    { id: 'ui-asset-tokens', title: 'Every colour, size, spacing, font, radius and border comes from asset tokens', doer: 'session', kind: 'mechanical', applies: 'builds', annotated: true, sources: [
      { source: 'CLAUDE.md:105', file: 'CLAUDE.md', line: 105, text: '**Everything visible is an asset** (`asset@1`). Engines compile assets into tokens/variables; UI reads only compiled tokens and never hardcodes colours or sizes.' },
      { source: 'framework/schemas/rules-briefs.json:13#1', file: 'framework/schemas/rules-briefs.json', line: 13, part: 1, text: '- Everything visible is an asset: every colour, size, spacing, font, radius and border comes from asset tokens (--fx-*), never literals.', pass: 2 },
    ] },
    { id: 'api-everything', title: 'Everything comes with an API', doer: 'session', kind: 'judgement', applies: 'builds', annotated: true, sources: [
      { source: 'framework/samples/brief-core.mjs:69', file: 'framework/samples/brief-core.mjs', line: 69, text: "export const API_RULE = 'Everything comes with an API (Brett, Nov 8 2026): a deep link, readable state, every action callable through REST, MCP, the CLI and voice.';", pass: 2 },
      { source: 'framework/samples/brief-core.mjs:267', file: 'framework/samples/brief-core.mjs', line: 267, text: '`API: ${API_RULE}`,', pass: 2 },
    ] },
    { id: 'toolbars', title: 'Every toolbar is a Toolbars plugin toolbar', doer: 'session', kind: 'mechanical', applies: 'builds', annotated: true, sources: [
      { source: '_claude/shared/rules/RULES.md:36', file: '_claude/shared/rules/RULES.md', line: 36, text: '**Every toolbar is a Toolbars plugin toolbar (Nov 3 2026, Brett):** every toolbar carries `role="toolbar"` and an `aria-label`. <!-- axf-plugin:toolbars -->' },
    ] },
    { id: 'plugin-lifecycle', title: 'Every plugin can be removed completely', doer: 'session', kind: 'mechanical', applies: 'builds', annotated: true, sources: [
      { source: 'framework/schemas/rules-briefs.json:17#1', file: 'framework/schemas/rules-briefs.json', line: 17, part: 1, text: '- A plugin is removable: code only in its folder, data only in its lifecycle.dataDir.', pass: 2 },
    ] },
    { id: 'hard-build-limit', title: 'A hard VPS build limit', doer: 'vps', kind: 'mechanical', applies: 'builds', annotated: true, sources: [
      { source: 'deploy/claude-headless.sh:81-82', file: 'deploy/claude-headless.sh', line: 81, to: 82, text: '# Hard build limit (build-limit@1, Brett, Nov 12 2026): before it books a slot, # a new launch asks build-limit.mjs admit.', pass: 2 },
    ] },
    { id: 'ask-with-cards', title: 'Ask Brett with tap-to-pick cards', doer: 'session', kind: 'judgement', applies: 'interactive', annotated: true, sources: [
      { source: '_claude/shared/rules/RULES.md:47', file: '_claude/shared/rules/RULES.md', line: 47, text: '**Ask with cards (Oct 22 2026, Brett):** whenever you need an answer from him, ask with tap-to-pick choices.' },
    ] },
    { id: 'merge-queue-only', title: 'Only the merge queue merges', doer: 'vps', kind: 'mechanical', applies: 'builds', annotated: true, sources: [
      { source: '_claude/shared/rules/RULES.md:60', file: '_claude/shared/rules/RULES.md', line: 60, text: '**Only the merge queue merges (Nov 4 2026, Brett):** every PR reaches main through the merge queue.' },
    ] },
    { id: 'phone-readable', title: 'Replies to Brett are phone-readable', doer: 'session', kind: 'judgement', applies: 'all', annotated: false, sources: [
      { source: 'CLAUDE.md:148', file: 'CLAUDE.md', line: 148, text: '**Where he works:** mostly from his Android phone. Keep replies phone-readable: lead with the result, short paragraphs, no walls of text.' },
    ] },
  ],
};

const BUILDS = {
  pluginUi: { id: 'notes-settings-tab', title: 'A settings tab for the notes plugin', text: 'apps/console-web/plugins/notes-tasks: a Settings → Plugins sub-tab' },
  engineOnly: { id: 'builds-store-lock', title: 'Fix the lock in the builds store', text: 'framework/cli/builds-store.mjs', ui: false },
  uiByWords: { id: 'home-cards-live', title: 'Home cards draw live data', words: 'card screen' },
};

/** The changes History must record, in order. */
const CHANGES = [
  { at: AT1, by: 'brett', change: { action: 'toggle', id: 'toolbars', enabled: false, reason: { title: 'Toolbars rule off', description: 'the chrome-assets check covers it' } } },
  { at: AT2, by: 'brett', change: { action: 'edit', id: 'ui-asset-tokens', patch: { text: 'Every colour, size, spacing, font, radius and border comes from asset tokens; framework controls only.', check: 'node framework/cli/check-theme.mjs', autofix: '' }, reason: 'Shorter text' } },
  { at: '2026-11-15T14:03:00Z', by: 'brett', change: { action: 'add', rule: { id: 'screenshots-after', title: 'The VPS takes the screenshots', text: 'After the session the VPS captures desktop and phone shots and submits them.', doer: 'vps', kind: 'mechanical', phase: 'after', enabled: true, autofix: 'ui-review-submit', when: { ui: true } }, reason: 'New VPS rule' } },
  { at: '2026-11-15T14:04:00Z', by: 'brett', change: { action: 'remove', id: 'ask-with-cards', reason: 'Not a builder rule' } },
  { at: '2026-11-15T14:05:00Z', by: 'brett', change: { action: 'restore', id: 'ask-with-cards', to: INVENTORY.rules.find((r) => r.id === 'ask-with-cards') && M.ruleFromInventory(INVENTORY.rules.find((r) => r.id === 'ask-with-cards')), reason: 'Back after all' } },
];
/** Changes the engine must refuse. */
const REFUSED = [
  { change: { action: 'edit', id: 'toolbars', patch: { id: 'x' }, reason: 'rename' } },
  { change: { action: 'edit', id: 'nope', patch: { text: 'x' }, reason: 'missing' } },
  { change: { action: 'toggle', id: 'toolbars', enabled: true, reason: 'already on' } },
  { change: { action: 'add', rule: { id: 'toolbars', title: 'dup', text: 'dup', doer: 'session', kind: 'judgement', phase: 'dispatch', enabled: true }, reason: 'dup' } },
  { change: { action: 'add', rule: { id: 'bad', title: 'x', text: 'x', doer: 'session', kind: 'judgement', phase: 'dispatch', enabled: true, autofix: 'home-card' }, reason: 'autofix on a session rule' } },
  { change: { action: 'edit', id: 'toolbars', patch: { note: 'same' }, reason: '' } },
  { change: { action: 'seed', reason: 'not through apply' } },
];

const IN = { INVENTORY, BUILDS, CHANGES, REFUSED, AT };

// ------------------------------------------------------------------ outputs

function run() {
  const mig = M.migrate(INVENTORY, { at: AT });
  const history = [mig.entry];
  let store = mig.store;
  const applied = [];
  for (const c of CHANGES) { const r = B.apply(store, c.change, { at: c.at, by: c.by }); assert.deepEqual(r.errors, [], `${c.change.action} ${c.change.id || ''}: ${r.errors.join('; ')}`); store = r.store; history.push(r.entry); applied.push({ action: c.change.action, id: r.entry.id, rev: r.store.rev, ruleRev: r.entry.ruleRev ?? null }); }
  const refused = REFUSED.map((c) => B.apply(mig.store, c.change, { at: AT1, by: 'brett' }).errors);
  return {
    migrate: { store: mig.store, entry: mig.entry, ids: mig.ids, missing: mig.missing, texts: Object.fromEntries(mig.store.rules.map((r) => [r.id, r.text])) },
    briefBlocks: Object.fromEntries(Object.entries(BUILDS).map(([k, b]) => [k, B.briefBlocks(mig.store, b, { at: AT })])),
    briefBlocksAfter: B.briefBlocks(store, BUILDS.pluginUi, { at: AT }),
    changes: { applied, store, history, refused },
    whyNot: Object.fromEntries(mig.store.rules.map((r) => [r.id, B.whyNot(r, BUILDS.engineOnly)])),
    errors: {
      goodStore: B.storeErrors(mig.store),
      badRule: B.ruleErrors({ id: 'Bad Id', doer: 'me', kind: 'x', phase: 'y', enabled: 'yes', autofix: 'home-card', briefBlock: 'z', applies: 'q', sources: [{}], rev: 0, check: 1 }),
      dupIds: B.storeErrors({ $axf: B.STORE_FRAME, rev: 1, at: AT, rules: [mig.store.rules[0], mig.store.rules[0]] }),
      notAStore: B.storeErrors({ rev: -1, at: 'yesterday' }),
      goodHistory: history.map((h) => B.historyErrors(h)),
      badHistory: B.historyErrors({ $axf: B.HISTORY_FRAME, at: 'x', by: '', action: 'zap', rev: -1, reason: {} }),
      missingId: B.historyErrors({ $axf: B.HISTORY_FRAME, at: AT, by: 'b', action: 'edit', rev: 1, reason: 'r' }),
    },
    norm: {
      rule: B.normRule({ id: 'x', title: 'X', text: 'x', doer: 'vps', kind: 'nope', phase: 'later', enabled: 'y', briefBlock: 'zz', applies: 'q', when: { ui: 'yes', keywords: 'plugin, ui' }, sources: [{ file: 'a.md', line: 3, text: 'a' }, { text: 'no where' }], rev: 0 }, AT),
      sessionDefaults: B.normRule({ id: 'y', title: 'Y', text: 'y' }, AT),
      checkKinds: { none: B.checkKind({ check: '' }), command: B.checkKind({ check: 'node framework/cli/check-theme.mjs' }), npx: B.checkKind({ check: 'npx -y tsx x.mts' }), checker: B.checkKind({ check: 'gate:ui-review' }) },
      reason: [B.normReason('plain'), B.normReason({ title: 'T', description: 'D' }), B.normReason(null)],
      storeDir: { env: B.storeDir({ AXF_BUILD_RULES_DIR: '/tmp/x' }), hub: B.storeDir({}, { exists: () => true }), home: B.storeDir({}, { exists: () => false, home: () => '/home/axf' }) },
      prose: INVENTORY.rules.map((r) => r.sources.map((s) => M.proseOf(s))),
    },
    homeCard: B.normRule(M.HOME_CARD_RULE, AT),
  };
}
const actual = run();
if (WRITE) { writeFileSync(FIX, `${JSON.stringify({ $axf: 'build-rules@1', note: 'Generated by framework/spec/check-build-rules.mjs --write; every port replays `in` (an inventory, sample builds, changes) and must answer `out`.', in: IN, out: actual }, null, 1)}\n`); console.log(`wrote ${FIX}`); }
const fx = JSON.parse(readFileSync(FIX, 'utf8'));
t('fixture inputs are the ones in this file', () => assert.ok(same(fx.in, IN), 'inputs drifted: run with --write'));
for (const k of Object.keys(fx.out)) t(`fixture replay: ${k}`, () => assert.deepEqual(actual[k], fx.out[k]));

// ------------------------------------------------------------------ migration

const ids = (s) => s.rules.map((r) => r.id);
t('migration: home-card first, then the VPS-native rules, every inventory rule present, nothing dropped, valid, one migrate history line', () => {
  const m = actual.migrate;
  const n = 1 + M.VPS_RULES.length + INVENTORY.rules.length;
  assert.deepEqual(ids(m.store), ['home-card', ...M.VPS_RULES.map((r) => r.id), ...INVENTORY.rules.map((r) => r.id)]);
  assert.deepEqual(m.missing, []); assert.deepEqual(B.storeErrors(m.store), []); assert.equal(m.store.rev, 1); assert.equal(m.store.seededFrom.count, n); assert.equal(m.store.seededFrom.pass, 2);
  assert.equal(m.entry.action, 'migrate'); assert.equal(m.entry.count, n); assert.deepEqual(B.historyErrors(m.entry), []);
  assert.ok(m.store.rules.every((r) => r.rev === 1 && r.createdAt === AT && r.updatedBy === 'migration'));
});
t('migration: rule #1 is home-card, doer vps, phase after, autofix home-card, kind mechanical, never in a brief', () => {
  const h = actual.homeCard;
  assert.equal(h.id, 'home-card'); assert.equal(h.doer, 'vps'); assert.equal(h.phase, 'after'); assert.equal(h.autofix, 'home-card'); assert.equal(h.kind, 'mechanical'); assert.equal(h.check, 'store:home-card');
  assert.equal(B.whyNot(h, BUILDS.pluginUi), 'the VPS does it');
  assert.deepEqual(actual.migrate.store.rules[0], { ...h, rev: 1, createdAt: AT, updatedAt: AT, updatedBy: 'migration' });
});
t('migration: doer, kind and applies come from the inventory; every source is kept verbatim with its pass', () => {
  const by = Object.fromEntries(actual.migrate.store.rules.map((r) => [r.id, r]));
  assert.equal(by['hard-build-limit'].doer, 'vps'); assert.equal(by['ask-with-cards'].applies, 'interactive'); assert.equal(by['api-everything'].kind, 'judgement');
  for (const e of INVENTORY.rules) { assert.equal(by[e.id].sources.length, e.sources.length); e.sources.forEach((s, i) => { assert.equal(by[e.id].sources[i].text, s.text); assert.equal(by[e.id].sources[i].source, s.source); assert.equal(by[e.id].sources[i].pass, s.pass || 1); }); }
  assert.match(by['phone-readable'].note, /inventory defaults/);
});
t('migration: phase, brief block, check, autofix and conditions come from the defaults table', () => {
  const by = Object.fromEntries(actual.migrate.store.rules.map((r) => [r.id, r]));
  assert.equal(by['ui-asset-tokens'].briefBlock, 'look'); assert.equal(by['ui-asset-tokens'].phase, 'gate'); assert.equal(by['ui-asset-tokens'].check, 'node framework/cli/check-theme.mjs');
  assert.equal(by['api-everything'].briefBlock, 'api'); assert.deepEqual(by['toolbars'].when, { ui: true }); assert.deepEqual(by['plugin-lifecycle'].when, { keywords: ['plugin', 'apps/console-web/plugins'] });
  assert.equal(by['merge-queue-only'].phase, 'gate'); assert.equal(by['merge-queue-only'].check, 'gate:merge-queue-only'); assert.equal(by['hard-build-limit'].phase, 'before');
  assert.equal(by['phone-readable'].phase, 'dispatch'); assert.equal(by['phone-readable'].briefBlock, 'rules'); assert.equal(by['phone-readable'].autofix, '');
});
t('migration: the text is the rule as the builder reads it: the orchestrator constant for the Look line, a brief bullet over a rules-file line, a quoted constant lifted from code, a template line never', () => {
  const tx = actual.migrate.texts;
  assert.match(tx['ui-asset-tokens'], /^UI code \(handwritten or generated\) conforms/);
  assert.equal(tx['api-everything'], 'Everything comes with an API (Brett, Nov 8 2026): a deep link, readable state, every action callable through REST, MCP, the CLI and voice.');
  assert.equal(tx['plugin-lifecycle'], 'A plugin is removable: code only in its folder, data only in its lifecycle.dataDir.');
  assert.equal(tx['toolbars'], 'Every toolbar is a Toolbars plugin toolbar (Nov 3 2026, Brett): every toolbar carries `role="toolbar"` and an `aria-label`.');
  assert.equal(tx['hard-build-limit'], 'Hard build limit (build-limit@1, Brett, Nov 12 2026): before it books a slot, a new launch asks build-limit.mjs admit.');
  assert.ok(Object.values(tx).every((x) => !x.includes('${')));
});
t('the real inventory → the committed seed: every rule present, valid, and the seed is what the migration gives at its own time', () => {
  const inv = JSON.parse(rd(M.INVENTORY_REL)); const seed = JSON.parse(rd(B.SEED_REL));
  assert.deepEqual(M.missingFrom(inv, seed), []); assert.deepEqual(B.storeErrors(B.normStore(seed)), []);
  assert.equal(seed.rules.length, inv.rules.length + 1 + M.VPS_RULES.length); assert.equal(seed.rules[0].id, 'home-card');
  const again = M.migrate(inv, { at: seed.at }).store;
  assert.ok(same(again, seed), 'seed.json is stale: run node framework/cli/build-rules-migrate.mjs');
  const vps = seed.rules.filter((r) => r.doer === 'vps');
  assert.ok(vps.length >= 40 && vps.every((r) => ['before', 'dispatch', 'after', 'gate'].includes(r.phase)));
  assert.ok(seed.rules.filter((r) => r.doer === 'session' && r.briefBlock === 'look').length === 1 && seed.rules.filter((r) => r.briefBlock === 'api').length === 1 && seed.rules.filter((r) => r.briefBlock === 'checkpoints').length === 1);
});

// ------------------------------------------------------------------ brief blocks

t('briefBlocks: a plugin UI build gets Look, API and the Rules bullets; VPS and interactive rules are skipped with the reason', () => {
  const b = actual.briefBlocks.pluginUi;
  assert.equal(b.$axf, B.BLOCKS_FRAME); assert.equal(b.build, 'notes-settings-tab'); assert.equal(b.ui, true);
  assert.deepEqual(b.picked, ['done-means-merged', 'ui-asset-tokens', 'api-everything', 'toolbars', 'plugin-lifecycle', 'phone-readable']);
  assert.deepEqual(b.skipped, [{ id: 'home-card', why: 'the VPS does it' }, ...M.VPS_RULES.filter((r) => r.doer === 'vps').map((r) => ({ id: r.id, why: 'the VPS does it' })), { id: 'hard-build-limit', why: 'the VPS does it' }, { id: 'ask-with-cards', why: 'interactive only' }, { id: 'merge-queue-only', why: 'the VPS does it' }]);
  assert.match(b.blocks.look, /^Look: UI code/); assert.match(b.blocks.api, /^API: Everything comes with an API/); assert.equal(b.blocks.checkpoints, '');
  assert.equal(b.blocks.rules.split('\n')[0], '## Rules for this job'); assert.equal(b.blocks.rules.split('\n').length, 5);
  assert.match(b.blocks.rules, /^- Done means merged and working/m);
  assert.equal(b.text, [b.blocks.look, b.blocks.api, b.blocks.rules].join('\n')); assert.equal(b.chars, b.text.length); assert.equal(b.tokens, Math.ceil(b.chars / 4));
});
t('briefBlocks: an engine-only build leaves out the UI-only and plugin-keyword rules', () => {
  const b = actual.briefBlocks.engineOnly;
  assert.equal(b.ui, false); assert.deepEqual(b.picked, ['done-means-merged', 'ui-asset-tokens', 'api-everything', 'phone-readable']);
  assert.ok(b.skipped.some((s) => s.id === 'toolbars' && s.why === 'UI only')); assert.ok(b.skipped.some((s) => s.id === 'plugin-lifecycle' && /keywords: none of plugin/.test(s.why)));
  assert.equal(actual.whyNot['ui-asset-tokens'], ''); assert.equal(actual.whyNot['merge-queue-only'], 'the VPS does it');
});
t('briefBlocks: the UI flag is worked out from the words when the build does not say', () => { assert.equal(actual.briefBlocks.uiByWords.ui, true); assert.ok(actual.briefBlocks.uiByWords.picked.includes('toolbars')); });
t('briefBlocks: a switched-off rule is skipped and the edited text is what goes out', () => {
  const b = actual.briefBlocksAfter;
  assert.ok(b.skipped.some((s) => s.id === 'toolbars' && s.why === 'switched off')); assert.ok(!b.picked.includes('toolbars'));
  assert.equal(b.blocks.look, 'Look: Every colour, size, spacing, font, radius and border comes from asset tokens; framework controls only.');
  assert.ok(b.skipped.some((s) => s.id === 'screenshots-after' && s.why === 'the VPS does it'));
});

// ------------------------------------------------------------------ changes + history

t('history: every change appends one line with before / after, the store rev and the rule rev move', () => {
  const c = actual.changes;
  assert.deepEqual(c.applied, [{ action: 'toggle', id: 'toolbars', rev: 2, ruleRev: 2 }, { action: 'edit', id: 'ui-asset-tokens', rev: 3, ruleRev: 2 }, { action: 'add', id: 'screenshots-after', rev: 4, ruleRev: 1 }, { action: 'remove', id: 'ask-with-cards', rev: 5, ruleRev: null }, { action: 'restore', id: 'ask-with-cards', rev: 6, ruleRev: 2 }]);
  assert.equal(c.history.length, 6); assert.deepEqual(c.history.map((h) => h.action), ['migrate', 'toggle', 'edit', 'add', 'remove', 'restore']);
  assert.ok(c.history.every((h) => B.historyErrors(h).length === 0));
  const tg = c.history[1]; assert.equal(tg.before.enabled, true); assert.equal(tg.after.enabled, false); assert.deepEqual(tg.before.sources, []); assert.equal(tg.after.sources.length, 1); assert.equal(tg.reason.description, 'the chrome-assets check covers it');
  const ed = c.history[2]; assert.equal(ed.after.rev, 2); assert.equal(ed.after.updatedBy, 'brett'); assert.equal(ed.after.updatedAt, AT2); assert.equal(ed.after.createdAt, AT); assert.equal(ed.after.sources.length, 2);
  const rm = c.history[4]; assert.ok(rm.before && !rm.after); const rs = c.history[5]; assert.ok(!rs.before && rs.after.rev === 2);
  assert.equal(c.store.rev, 6); assert.equal(c.store.updatedBy, 'brett'); assert.equal(c.store.at, '2026-11-15T14:05:00Z');
  assert.deepEqual(ids(c.store), ['home-card', ...M.VPS_RULES.map((r) => r.id), 'ui-asset-tokens', 'api-everything', 'toolbars', 'plugin-lifecycle', 'hard-build-limit', 'merge-queue-only', 'phone-readable', 'screenshots-after', 'ask-with-cards']);
});
t('changes the engine refuses say why', () => {
  const r = actual.changes.refused;
  assert.match(r[0][0], /cannot change id/); assert.match(r[1][0], /does not exist/); assert.match(r[2][0], /already on/); assert.match(r[3][0], /already exists/); assert.match(r[4][0], /autofix needs doer vps/); assert.match(r[5][0], /reason\.title/); assert.match(r[6][0], /action is one of/);
});

// ------------------------------------------------------------------ validation + normalisation

t('validation names every bad field', () => {
  const e = actual.errors;
  assert.deepEqual(e.goodStore, []); assert.equal(e.badRule.length, 14); assert.ok(e.dupIds.some((x) => /appears twice/.test(x))); assert.ok(e.notAStore.length >= 3);
  assert.ok(e.goodHistory.every((x) => x.length === 0)); assert.ok(e.badHistory.length >= 5); assert.ok(e.missingId.some((x) => /names the rule/.test(x)));
});
t('normalisation: bad enums fall to the safe side, a vps rule defaults to after, a session rule to dispatch + rules, sources without a place are dropped', () => {
  const r = actual.norm.rule;
  assert.equal(r.kind, 'judgement'); assert.equal(r.phase, 'after'); assert.equal(r.enabled, true); assert.equal(r.briefBlock, 'rules'); assert.equal(r.applies, 'builds'); assert.deepEqual(r.when, { keywords: ['plugin', 'ui'] }); assert.equal(r.sources.length, 1); assert.equal(r.rev, 1); assert.equal(r.createdAt, AT);
  const s = actual.norm.sessionDefaults; assert.equal(s.doer, 'session'); assert.equal(s.phase, 'dispatch'); assert.equal(s.briefBlock, 'rules'); assert.equal(s.check, ''); assert.equal(s.autofix, '');
  assert.deepEqual(actual.norm.checkKinds, { none: 'none', command: 'command', npx: 'command', checker: 'checker' });
  assert.deepEqual(actual.norm.reason, [{ title: 'plain', description: '' }, { title: 'T', description: 'D' }, { title: '', description: '' }]);
});
t('the store folder is one function: env override, the hub mount now, a home folder otherwise', () => assert.deepEqual(actual.norm.storeDir, { env: '/tmp/x', hub: '/projects/amberx-axf/_data/build-rules', home: '/home/axf/.axf/build-rules' }));

// ------------------------------------------------------------------ the locked store round trip (real files in a temp folder)

t('store round trip: seed → save → commit toggle + edit → history newest first → load; a second commit on the same rev chain; the lock file is gone after', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axf-build-rules-'));
  try {
    const seeded = M.migrate(INVENTORY, { at: AT });
    B.save(seeded.store, [seeded.entry], { dir });
    const l0 = B.load({ dir, at: AT }); assert.equal(l0.seeded, false); assert.equal(l0.store.rev, 1);
    const r1 = B.commit({ action: 'toggle', id: 'toolbars', enabled: false, reason: 'off' }, { dir, at: AT1, by: 'brett' });
    const r2 = B.commit({ action: 'edit', id: 'home-card', patch: { note: 'first' }, reason: 'note' }, { dir, at: AT2, by: 'brett' });
    assert.equal(r1.store.rev, 2); assert.equal(r2.store.rev, 3); assert.equal(r2.store.rules[0].rev, 2);
    assert.deepEqual(B.history({ dir }).map((h) => `${h.action}:${h.id || h.count}@${h.rev}`), ['edit:home-card@3', 'toggle:toolbars@2', `migrate:${1 + M.VPS_RULES.length + INVENTORY.rules.length}@1`]);
    assert.deepEqual(B.history({ dir, id: 'toolbars' }).map((h) => h.action), ['toggle']); assert.deepEqual(B.history({ dir, action: 'edit' }).length, 1);
    const l1 = B.load({ dir, at: AT }); assert.equal(l1.store.rev, 3); assert.deepEqual(B.storeErrors(l1.store), []);
    assert.throws(() => B.commit({ action: 'edit', id: 'home-card', patch: { id: 'x' }, reason: 'r' }, { dir }), /cannot change id/);
    assert.throws(() => B.save({ $axf: B.STORE_FRAME, rev: 1, at: AT, rules: [{ id: 'Bad' }] }, [], { dir }), /invalid/);
    assert.ok(!existsSync(join(dir, B.FILES.lock)));
    // a folder with no store reads the seed and says so; a first commit on it writes the seed line first
    const dir2 = join(dir, 'fresh'); const seedFile = join(dir, 'seed.json'); writeFileSync(seedFile, JSON.stringify(seeded.store));
    const l2 = B.load({ dir: dir2, seed: seedFile, at: AT }); assert.equal(l2.seeded, true); assert.equal(l2.store.rules.length, 1 + M.VPS_RULES.length + INVENTORY.rules.length);
    B.commit({ action: 'toggle', id: 'toolbars', enabled: false, reason: 'off' }, { dir: dir2, seed: seedFile, at: AT1, by: 'brett' });
    assert.deepEqual(B.history({ dir: dir2 }).map((h) => h.action), ['toggle', 'seed']);
    const l3 = B.load({ dir: join(dir, 'none'), seed: join(dir, 'no-seed.json'), at: AT }); assert.equal(l3.empty, true); assert.equal(l3.store.rules.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------------------------ snapshots + docs

t('schemas/build-rules.json + schemas/json/build-rule*.schema.json are current (run axf schemas)', () => {
  assert.ok(same(JSON.parse(rd('framework/schemas/build-rules.json')), B.REGISTRY));
  for (const [name, s] of Object.entries(B.jsonSchemas())) assert.ok(same(JSON.parse(rd(`framework/schemas/json/${name}`)), s), name);
});
t('PORTING.md and BUILD-RULES.md carry the contract', () => { assert.match(rd('framework/spec/PORTING.md'), /build-rules@1/); assert.match(rd('framework/spec/BUILD-RULES.md'), /brief-blocks@1/); });
console.log(`check-build-rules: ${n} checks passed`);
