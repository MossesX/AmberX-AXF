#!/usr/bin/env node
// ref@1 (framework/core/engines/refs.mjs): replays spec/fixtures/refs.json (targets from search entries and builds,
// every findRefs case, resolveRef, refPeek) and checks the small helpers. Exit 1 on any difference.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as R from '../core/engines/refs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, 'fixtures', 'refs.json'), 'utf8'));
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };

const targets = [...fx.search.map(R.refTargetFromSearch).filter(Boolean), ...fx.builds.map(R.refTargetFromBuild)];
check('targets from search entries and builds', isDeepStrictEqual(targets, fx.targets), JSON.stringify(targets).slice(0, 400));
const index = R.refIndex(targets);
for (const c of fx.cases) {
  const got = R.findRefs(c.text, index, c.opts).spans;
  check(`findRefs: ${c.name}`, isDeepStrictEqual(got, c.spans), `got ${JSON.stringify(got)}`);
}
for (const r of fx.resolve) {
  const x = R.resolveRef(index, r.query);
  const got = { target: x.target?.id ?? null, ...(x.ambiguous ? { ambiguous: true, candidates: x.candidates.map((c) => c.id) } : {}), ...(x.missing ? { missing: true } : {}), ...(x.unknown ? { unknown: true } : {}) };
  check(`resolveRef: ${r.query}`, isDeepStrictEqual(got, r.result), `got ${JSON.stringify(got)}`);
}
const builds = targets.filter((t) => t.kind === 'build');
for (const p of fx.peek) check(`refPeek: ${p.span.ref}`, isDeepStrictEqual(R.refPeek(p.span, index, builds), p.peek), JSON.stringify(R.refPeek(p.span, index, builds)));

// helpers
const merged = R.refIndex([{ id: 'build:x-y', kind: 'build', label: 'X y', focus: { kind: 'action', spec: 'open:x' } }, { id: 'build:x-y', kind: 'build', label: 'The X', touches: ['screen:a'], focus: { kind: 'action', spec: 'other' } }]).byId.get('build:x-y');
check('refIndex merges one id from two sources (first wins, second fills)', merged.focus.spec === 'open:x' && merged.touches?.[0] === 'screen:a' && merged.aliases?.includes('The X'));
check('refId: dotted and colon forms', R.refId('settings.terminal') === 'settings:terminal' && R.refId('Screen:plan-studio') === 'screen:plan-studio' && R.refId('plain') === '');
check('normalizeRefTarget: needs an id and a label', R.normalizeRefTarget({ id: 'screen:x' }) === null && R.normalizeRefTarget({ label: 'X' }) === null && R.normalizeRefTarget(null) === null);
const text = 'See Plan Studio screen and #12 in apps/x/y.ts.';
const res = R.findRefs(text, index);
check('refSegments rebuild the text', R.refSegments(text, res.spans).map((s) => s.text).join('') === text);
check('refSegments mark every span', R.refSegments(text, res.spans).filter((s) => s.span).length === res.spans.length);
check('parseTouches: positions point at the ids', R.parseTouches('x touches: a.b, c:d').every((d) => 'x touches: a.b, c:d'.slice(d.start, d.end).replace(':', '.').replace(/^c\./, 'c:').length > 0) && R.parseTouches('touches: a.b, c:d').map((d) => d.id).join() === 'a:b,c:d');
check('refs lists explicit first', R.findRefs('Terminal settings', index, { explicit: ['dialog:about'] }).refs[0] === 'dialog:about');
check('empty and huge text are safe', R.findRefs('', index).spans.length === 0 && Array.isArray(R.findRefs('Plan Studio '.repeat(5000), index).spans));
check('an empty index finds only patterns', R.findRefs('Plan Studio #4', []).spans.map((s) => s.ref).join() === 'pr:4');

console.log(`${fails ? '✗' : '✓'} ref@1: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
