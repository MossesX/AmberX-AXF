#!/usr/bin/env node
/**
 * session@1 conformance (Chat viewer, Brett Nov 1 2026: every session stored, synced, searchable).
 *   1. the validator reports exactly the fixture fields (fixtures/session.json → sessions)
 *   2. redaction gives the fixture output and is idempotent (→ redact)
 *   3. the chain hash gives the fixture hashes and extends (→ hashes, chain)
 *   4. the registry snapshot (schemas/session.json) and the JSON Schema (schemas/json/session.schema.json) match
 *      framework/core/session-schema.mjs (run `node framework/cli/axf.mjs schemas` after changing it)
 * The Chat viewer plugin's test.py replays the same fixture against its Python port.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from '../core/session-schema.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const rd = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
let failed = 0, passed = 0;
const ok = (cond, what, detail = '') => { if (cond) passed++; else { failed++; console.error(`✗ ${what}${detail ? `\n  ${detail}` : ''}`); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fx = rd('framework/spec/fixtures/session.json');
for (const [name, f] of Object.entries(fx.sessions)) {
  const v = S.validateSession(f.session);
  ok(v.ok === f.ok && same(v.errors.map((e) => e.field), f.errors), `session fixture "${name}"`, `want ${f.ok} ${f.errors}, got ${v.ok} ${v.errors.map((e) => e.field)}`);
}
for (const r of fx.redact) {
  const out = S.redact(r.input);
  ok(out === r.output, `redact ${JSON.stringify(r.input.slice(0, 40))}`, `got ${out}`);
  ok(S.redact(out) === out, `redact is idempotent on ${JSON.stringify(r.input.slice(0, 40))}`);
}
for (const h of fx.hashes) ok(S.chainHash(h.messages) === h.hash, `chain hash of ${h.messages.length} message(s)`);
const m = fx.sessions['valid voice chat'].session.messages;
ok(S.chainHash(m.slice(1), S.chainHash(m.slice(0, 1))) === S.chainHash(m), 'the chain hash extends (continued sessions)');
ok(S.isTimestamp('2024-06-01T12:34:56.789012Z') && !S.isTimestamp('2024-06-01'), 'timestamps');

ok(same(rd('framework/schemas/session.json'), S.REGISTRY), 'schemas/session.json matches REGISTRY (run axf schemas)');
for (const [n, schema] of Object.entries(S.jsonSchemas())) ok(same(rd(`framework/schemas/json/${n}`), schema), `schemas/json/${n} is current (run axf schemas)`);

console.log(`session@1: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
