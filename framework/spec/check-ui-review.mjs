#!/usr/bin/env node
/**
 * ui-review-item@1 / ui-review-group@1 conformance (Brett, Nov 1 2026: everything in UI Review has a name, a
 * timestamp and one schema).
 *   1. the validator reports exactly the fixture fields (fixtures/ui-review-item.json)
 *   2. the registry snapshot (schemas/ui-review.json) and the JSON Schemas (schemas/json/ui-review-*.schema.json)
 *      match framework/core/ui-review-schema.mjs (run `node framework/cli/axf.mjs schemas` after changing it)
 *   3. intake defaults: only createdAt = now and the automatic group; a missing name is never filled
 *   4. migration turns older items into valid ones
 *   5. every piece of code that submits to UI Review goes through the schema: JS/Python callers of the submit API
 *      import the validator (or call a CLI that does), and every documented `review.mjs submit` / `shot.mjs` command
 *      passes a name (--name or --title)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../core/ui-review-schema.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
let failed = 0, passed = 0;
const ok = (cond, what, detail = '') => { if (cond) passed++; else { failed++; console.error(`✗ ${what}${detail ? `\n  ${detail}` : ''}`); } };

// 1. fixtures
const fx = JSON.parse(rd('framework/spec/fixtures/ui-review-item.json'));
for (const [name, f] of Object.entries(fx.items)) { const v = S.validateItem(f.item); ok(v.ok === f.ok && JSON.stringify(v.errors.map((e) => e.field)) === JSON.stringify(f.errors), `item fixture "${name}"`, `want ${f.ok} ${f.errors}, got ${v.ok} ${v.errors.map((e) => e.field)}`); }
for (const [name, f] of Object.entries(fx.groups)) { const v = S.validateGroup(f.group); ok(v.ok === f.ok && JSON.stringify(v.errors.map((e) => e.field)) === JSON.stringify(f.errors), `group fixture "${name}"`, `want ${f.ok} ${f.errors}, got ${v.ok} ${v.errors.map((e) => e.field)}`); }
const msg = S.validateItem(fx.items['missing name'].item).errors[0].message;
ok(/^name is missing/.test(msg), 'the rejection names the missing field', msg);
ok(/createdAt is missing/.test(S.rejection(S.validateItem(fx.items['missing createdAt'].item).errors)), 'a missing timestamp is named');

// 2. snapshots
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(JSON.parse(rd('framework/schemas/ui-review.json')), S.REGISTRY), 'schemas/ui-review.json matches REGISTRY (run axf schemas)');
for (const [n, schema] of Object.entries(S.jsonSchemas())) ok(same(JSON.parse(rd(`framework/schemas/json/${n}`)), schema), `schemas/json/${n} is current (run axf schemas)`);

// 3. intake defaults
const now = '2026-11-01T08:20:00.000Z';
const base = { kind: 'review', source: 'headless', submittedBy: 'build:claude/x', app: 'Console', screen: 'Breakroom', files: [{ src: 'a-phone.png', viewport: 'phone' }] };
let p = S.prepareItem({ ...base, id: 'r-1', name: 'Breakroom check' }, { now, autoGroup: true, session: 'claude/x' });
ok(p.ok, 'prepareItem: createdAt and the automatic group are the only defaults', JSON.stringify(p.errors));
ok(p.item.createdAt === now && p.item.group.name === 'claude/x - 2026-11-01 08:20' && p.item.status === 'pending' && p.item.viewport === 'phone', 'auto group "<session> - <YYYY-MM-DD HH:mm>", createdAt = now', JSON.stringify(p.item));
p = S.prepareItem({ ...base, id: 'r-1' }, { now, autoGroup: true });
ok(!p.ok && p.errors.some((e) => e.field === 'name' && e.code === 'missing'), 'prepareItem never fills a missing name');
p = S.prepareItem({ ...base, id: 'r-1', name: 'Breakroom check' }, { now, autoGroup: false });
ok(!p.ok && p.errors.some((e) => e.field === 'group'), 'without autoGroup a missing group is rejected (the caller must ask Brett)');
p = S.prepareItem({ ...base, id: 'r-1', name: 'Breakroom check', group: 'Breakroom pass' }, { now });
const p2 = S.prepareItem({ ...base, id: 'r-2', name: 'Other screen', group: 'Breakroom pass', createdAt: '2026-11-01T22:00:00Z' }, { now });
ok(p.ok && p.item.group.id === p2.item.group.id, 'same group name on the same day = the same group', `${p.item.group.id} vs ${p2.item.group.id}`);
p = S.prepareItem({ ...base, id: 'r-1', title: 'Old caller title', group: 'G one', status: 'waiting' }, { now });
ok(p.ok && p.item.name === 'Old caller title' && p.item.status === 'pending' && !('title' in p.item), 'legacy spellings: title → name, waiting → pending');

// 4. migration
const legacy = { $axf: 'review-item@1', id: 'r-20261030-abc12', kind: 'settings', title: 'Level bar', app: '', build: '', branch: 'claude/levels', pr: 180, shots: [{ src: 'items/r-20261030-abc12/a-phone.png', device: 'phone', name: 'A' }], notes: 'n', status: 'waiting', comment: '', history: [{ at: '2026-10-30T10:00:00Z', by: 'build', action: 'submitted', status: 'waiting' }], source: 'cli', submittedAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z' };
const m = S.migrateLegacy(legacy, { kind: 'review' });
ok(S.validateItem(m.item).ok, 'a review-item@1 migrates to a valid ui-review-item@1', JSON.stringify(S.validateItem(m.item).errors));
ok(m.item.name === 'Level bar' && m.item.createdAt === '2026-10-30T10:00:00Z' && m.item.section === 'settings' && m.item.status === 'pending' && m.item.group.name === 'claude/levels - 2026-10-30', 'migration keeps name, time, section; groups by build/day', JSON.stringify(m.item));
const m2 = S.migrateLegacy({ id: 'x1', src: 'shots/live.png' }, { kind: 'screenshot', fileTime: () => '2026-10-31T20:20:00Z' });
ok(S.validateItem(m2.item).ok && m2.item.createdAt === '2026-10-31T20:20:00Z', 'timestamps come from the file time when an item has none', JSON.stringify(S.validateItem(m2.item).errors));
ok(S.migrateLegacy(m.item).changes.length === 0, 'migration is idempotent');

// 5. every submitter goes through the schema
const SKIP = /(^|\/)(node_modules|dist|\.git|src\/axf|\.axf-console|changes|sessions|build)(\/|$)/;
const EXT = /\.(mjs|js|ts|tsx|mts|py|sh|md|yml|yaml)$/;
const files = [];
const walk = (d) => { for (const n of readdirSync(join(ROOT, d))) { const p = d ? `${d}/${n}` : n; if (SKIP.test(p)) continue; let st; try { st = statSync(join(ROOT, p)); } catch { continue; } if (st.isDirectory()) walk(p); else if (EXT.test(n) && st.size < 600000) files.push(p); } };
for (const d of ['framework', 'apps', 'deploy', '_claude/shared', '_claude/rules', '_claude/instructions', '.github']) { try { walk(d); } catch { /* not in this checkout */ } }
const SCHEMA_AWARE = /ui-review-schema|prepareItem|prepare_item|validate_item|review\.mjs|shot\.mjs|ui_review_schema/;
const API = /ui-review\/(submit|shots|upload)\b|['"]ui-review@1['"]\)?\.submit|get\(["']ui-review@1["']\)\.submit/;
let callers = 0, commands = 0;
// the intake's own server folder: the console plugin providing service:ui-review@1 (found by capability, not by name)
const PLUGINS = 'apps/console-web/plugins';
const owner = (() => { try { return readdirSync(join(ROOT, PLUGINS)).find((n) => { try { return JSON.parse(readFileSync(join(ROOT, PLUGINS, n, 'plugin.json'), 'utf8')).provides?.includes('service:ui-review@1'); } catch { return false; } }); } catch { return undefined; } })();
const intake = owner ? `${PLUGINS}/${owner}/server/` : '';
for (const f of files) {
  if ((intake && f.startsWith(intake)) || f === 'framework/spec/check-ui-review.mjs') continue; // the intake itself, this check
  const s = readFileSync(join(ROOT, f), 'utf8');
  if (/\.(mjs|js|ts|tsx|mts|py)$/.test(f) && API.test(s)) { callers++; ok(SCHEMA_AWARE.test(s), `${f} submits to UI Review without the ui-review-item@1 validator`, 'import framework/core/ui-review-schema.mjs (prepareItem) or call review.mjs / shot.mjs'); }
  // every invocation (a command with flags) in code, scripts and docs: up to the end of its code span / line
  const CMD = /(?:review\.mjs\s+submit|(?:cli\/)?shot\.mjs\s+(?!list\b|groups?\b|move\b|promote\b|migrate\b|paths\b|\||…)|\baxf shot\s+(?!list\b|groups?\b|move\b|promote\b|migrate\b|paths\b))([^`'"\n]*)/g;
  for (const m of s.matchAll(CMD)) {
    const rest = m[1];
    if (!/(^|\s)--[a-z]/.test(rest) || /\[--name|usage:/i.test(rest)) continue; // a mention, or the usage line itself
    commands++;
    ok(/--(name|title)\b/.test(rest), `${f}: a UI Review submit command without --name`, m[0].trim().slice(0, 160));
  }
}
console.log(failed ? `${failed} ui-review schema check(s) failed (${passed} passed)` : `✓ ui-review-item@1: ${passed} checks (${Object.keys(fx.items).length + Object.keys(fx.groups).length} fixtures, ${callers} API callers, ${commands} submit commands)`);
process.exit(failed ? 1 : 0);
