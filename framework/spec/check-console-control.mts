/**
 * console-control@1 (core/engines/console-control.ts + console-control-rules.mjs; build full-api-and-voice-control, Nov 13
 * 2026): the grammar (kinds, parents, verbs append-only; every verb has an effect and a control@1 permission), parse / format
 * round trips and every refused address with its wire code, command errors name every problem, resolving (full, trailing,
 * tab value, ambiguous, not_found with nearest, verb checks in the INTEROP order), search ranking, scroll maths, answer
 * envelopes, the JSON Schemas (every command field and code is in them), the snapshot framework/schemas/console-control.json
 * and the fixture are current, and the spec doc names every kind, verb and code.
 *   npx -y tsx framework/spec/check-console-control.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONSOLE_CONTROL_CODES, CONSOLE_CONTROL_DEFAULT_CAN, CONSOLE_CONTROL_FRAME, CONSOLE_CONTROL_KINDS, CONSOLE_CONTROL_PARENTS, CONSOLE_CONTROL_VERBS, CONSOLE_CONTROL_VERB_IDS, CONSOLE_CONTROL_WIRE,
  ConsoleControlError, addressEndsWith, consoleControlEffect, consoleControlErrors, consoleControlFailure, consoleControlPermission, consoleControlRegistry, consoleControlResult, failureOf, focusOptions, formatAddress, listTargets, nearestTargets,
  normalizeConsoleControl, parseAddress, resolveAddress, resolveForVerb, scrollState, scrollStep, searchTargets, splitTabId, type ConsoleControlScrollDir, type ConsoleControlVerb, type TargetSnapshot,
} from '../core/engines/console-control';
import { CONTROL_PERMISSIONS } from '../core/engines/control-rules.mjs';
import { MCP_WIRE } from '../core/engines/mcp';

let n = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); n++; };
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };
const root = new URL('../../', import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const fails = (fn: () => unknown, code: string, m: string) => { try { fn(); assert.fail(`${m}: did not throw`); } catch (e) { ok(e instanceof ConsoleControlError && e.code === code, `${m} (${e instanceof ConsoleControlError ? e.code : String(e)})`); } };

/* ---- registry ---- */
eq(CONSOLE_CONTROL_KINDS.slice(0, 12), ['view', 'tab', 'subtab', 'setting', 'button', 'function', 'plugin', 'grid', 'row', 'step', 'panel', 'scroll'], 'twelve kinds, append-only');
eq(CONSOLE_CONTROL_VERB_IDS.slice(0, 10), ['open', 'state', 'press', 'set', 'scroll', 'focus', 'search', 'list', 'plugin.enable', 'plugin.disable'], 'ten verbs, append-only');
for (const k of CONSOLE_CONTROL_KINDS) {
  ok(CONSOLE_CONTROL_PARENTS[k].every((p) => p === null || CONSOLE_CONTROL_KINDS.includes(p)), `${k} parents are kinds`);
  ok((CONSOLE_CONTROL_DEFAULT_CAN[k] ?? []).every((v) => CONSOLE_CONTROL_VERB_IDS.includes(v)) && CONSOLE_CONTROL_DEFAULT_CAN[k].includes('state'), `${k} default can is verbs and reads state`);
}
for (const [v, spec] of Object.entries(CONSOLE_CONTROL_VERBS)) {
  ok(['read', 'navigate', 'write'].includes(spec.effect) && spec.requires in CONTROL_PERMISSIONS, `${v}: effect ${spec.effect}, permission ${spec.requires} is a control@1 permission`);
  ok(spec.doc.length > 30 && spec.takes.length >= 1, `${v} documented`);
  eq(consoleControlEffect(v), spec.effect, `${v} effect`); eq(consoleControlPermission(v), spec.requires, `${v} permission`);
}
eq(consoleControlPermission('open'), 'control.console.navigate', 'open only navigates');
eq(consoleControlPermission('plugin.disable'), 'control.plugins.write', 'plugin verbs write plugins');
eq(consoleControlEffect('nope'), null, 'unknown verb has no effect');
for (const code of CONSOLE_CONTROL_CODES) ok(code === 'ambiguous' || Object.values(MCP_WIRE).includes(code as never), `wire code ${code} is an INTEROP code (ambiguous added by this contract)`);

/* ---- addresses ---- */
const deep = 'view:builds/tab:orchestrator.sections=pipeline/grid:queue/row:abc/step:s3';
eq(formatAddress(parseAddress(deep)), deep, 'round trip');
eq(parseAddress('VIEW:Builds/Tab:x=y'), [{ kind: 'view', id: 'Builds' }, { kind: 'tab', id: 'x=y' }], 'kinds fold to lower case, ids keep theirs');
eq(formatAddress(parseAddress('grid:a%2Fb/row:100%25')), 'grid:a%2Fb/row:100%25', 'encoded / and % survive');
eq(parseAddress('grid:a%2Fb')[0]!.id, 'a/b', '… and decode');
eq(formatAddress(parseAddress({ path: [{ kind: 'view', id: 'b' }, { kind: 'button', id: 'save' }] })), 'view:b/button:save', 'object form');
fails(() => parseAddress(''), 'invalid', 'empty'); fails(() => parseAddress(null), 'invalid', 'missing'); fails(() => parseAddress('builds'), 'invalid', 'no colon');
fails(() => parseAddress('screen:x'), 'invalid', 'bad kind'); fails(() => parseAddress('view:'), 'invalid', 'empty id'); fails(() => parseAddress('step:s3/row:abc'), 'invalid', 'wrong order');
fails(() => parseAddress('subtab:x=y'), 'invalid', 'subtab needs a tab'); fails(() => parseAddress('view:b/row:x'), 'invalid', 'a row needs a grid'); fails(() => parseAddress(`view:${'x'.repeat(161)}`), 'invalid', 'long id');
fails(() => parseAddress(Array.from({ length: 9 }, (_, i) => `panel:p${i}`).join('/')), 'invalid', 'too deep');
try { parseAddress('step:s3/row:abc'); } catch (e) { ok(e instanceof ConsoleControlError && e.extra.segment === 'row:abc' && (e.message as string).includes('grid'), 'the bad segment is named with what it may follow'); }
eq(splitTabId('row=val'), { row: 'row', value: 'val' }, 'tab id splits'); eq(splitTabId('a=b', 'setting'), { row: 'a=b', value: null }, 'other kinds never split');
ok(addressEndsWith(parseAddress(deep), parseAddress('row:abc/step:s3')) && !addressEndsWith(parseAddress(deep), parseAddress('row:abc')), 'trailing match');

/* ---- commands ---- */
eq(consoleControlErrors({ verb: 'open', address: 'tab:a=b' }), [], 'a good open');
eq(consoleControlErrors({ verb: 'state' }), [], 'state without an address = the screen in front');
ok(consoleControlErrors({ verb: 'focus' })[0]!.includes('needs an address'), 'focus needs an address');
ok(consoleControlErrors({ verb: 'set', address: 'setting:x' })[0]!.includes('needs a value'), 'set needs a value');
const se = consoleControlErrors({ verb: 'scroll', scroll: { dir: 'sideways', amount: -1, extra: 1 }, value: 1 });
ok(se.some((e) => e.includes('does not take value')) && se.some((e) => e.includes('scroll.dir')) && se.some((e) => e.includes('scroll.amount')) && se.some((e) => e.includes('no field extra')), `every scroll problem named: ${se.join(' | ')}`);
ok(consoleControlErrors({ verb: 'scroll', scroll: { dir: 'to' } })[0]!.includes('scroll.to'), 'scroll to needs a target');
const qe = consoleControlErrors({ verb: 'search', query: { q: '', kinds: ['screen'], limit: 99, sort: 'x' } });
ok(qe.length === 4, `every query problem named (${qe.length}): ${qe.join(' | ')}`);
ok(consoleControlErrors({ verb: 'explode' })[0]!.includes('verb must be one of'), 'unknown verb');
ok(consoleControlErrors({ $axf: 'control@1', verb: 'state' })[0]!.includes('$axf'), 'wrong frame');
ok(consoleControlErrors({ verb: 'state', target: 'x' })[0]!.includes('no field target'), 'unknown field');
ok(consoleControlErrors({ verb: 'open', address: 'step:s3/row:abc' })[0]!.startsWith('address:'), 'a bad address is a command error');
eq(consoleControlErrors('open view:builds'), ['command must be an object'], 'not an object');
const norm = normalizeConsoleControl({ verb: 'scroll', scroll: { dir: 'to', to: { path: [{ kind: 'row', id: 'abc' }] } }, by: ' me ', reason: '  ' });
eq(norm, { $axf: CONSOLE_CONTROL_FRAME, verb: 'scroll', scroll: { dir: 'to', to: 'row:abc' }, by: 'me' }, 'normalize: canonical address text, trimmed by, blank reason dropped');
eq(normalizeConsoleControl({ verb: 'search', query: { q: ' voice ', kinds: ['row', 'row'] } }).query, { q: 'voice', kinds: ['row'], limit: 12 }, 'normalize: query trimmed, kinds unique, default limit');
fails(() => normalizeConsoleControl({ verb: 'focus' }), 'invalid', 'normalize throws invalid with the problems');

/* ---- resolving ---- */
const fx = read('framework/spec/fixtures/console-control.json');
const snap = fx.snapshot as TargetSnapshot;
eq(resolveAddress(snap, 'step:s3').target.address, deep, 'a trailing step resolves to its one full address');
eq(resolveAddress(snap, 'ROW:ABC').target.kind, 'row', 'ids match case-insensitively');
eq(resolveAddress(snap, 'tab:orchestrator.sections=shipped').target.label, 'Shipped', 'a tab value matches the tab target');
eq(resolveAddress(snap, 'view:builds/tab:orchestrator.sections=pending').target.address, 'view:builds/tab:orchestrator.sections', 'an unregistered tab value falls back to its row');
eq(resolveAddress(snap, 'view:builds/button:save').target.address, 'view:builds/button:save', 'an exact full address wins over a longer one ending the same');
fails(() => resolveAddress(snap, 'button:save'), 'ambiguous', 'two Save buttons');
try { resolveAddress(snap, 'button:save'); } catch (e) { eq((e as ConsoleControlError).extra.candidates, ['view:builds/button:save', deep.replace('/step:s3', '/button:save')], 'candidates are listed sorted'); }
fails(() => resolveAddress(snap, 'row:nope'), 'not_found', 'nothing like it');
eq(nearestTargets(snap, parseAddress('row:abd')), [deep.replace('/step:s3', '')], 'nearest: one letter off');
eq(nearestTargets(snap, parseAddress('button:refesh')), ['view:builds/button:refresh'], 'nearest: a typo in a button');
eq(nearestTargets(snap, parseAddress('row:qqqqqqqq')), [], 'nearest: nothing close stays empty');
fails(() => resolveForVerb(snap, 'view:builds/button:save', 'press'), 'unavailable', 'a disabled button cannot be pressed');
fails(() => resolveForVerb(snap, 'step:s3', 'press'), 'not_implemented', 'a step is not pressed');
try { resolveForVerb(snap, 'step:s3', 'press'); } catch (e) { eq((e as ConsoleControlError).extra.can, ['open', 'state', 'focus'], 'not_implemented says what it can'); }
ok(resolveForVerb(snap, 'row:def', 'focus').target.virtual === true, 'a virtual row can be focused');
ok(resolveForVerb(snap, 'setting:axf.display.fontScale', 'set').can.includes('set'), 'a target\'s own can applies');
fails(() => resolveForVerb(snap, 'button:nope', 'press'), 'not_found', 'not_found comes before the verb check');
eq(listTargets(snap, 'grid:queue').length, 5, 'list under a short grid address');
eq(listTargets(snap).length, snap.targets.length, 'list everything');
fails(() => listTargets(snap, 'grid:nope'), 'not_found', 'list under nothing');

/* ---- search ---- */
const hits = searchTargets(snap, { q: 'voice' });
ok(hits.length === 2 && hits[0]!.kind === 'row' && hits[1]!.kind === 'step' && hits[0]!.score > hits[1]!.score, 'search by label words: the label hit outranks the detail hit');
eq(searchTargets(snap, { q: 'save', kinds: ['button'] }).length, 2, 'search narrowed to a kind');
eq(searchTargets(snap, { q: 'reload' })[0]!.address, 'view:builds/button:refresh', 'search by keyword');
ok(searchTargets(snap, { q: 'font scale' })[0]!.kind === 'setting', 'search finds a setting by its label');
eq(searchTargets(snap, { q: 's', limit: 2 }).length, 2, 'limit');
eq(searchTargets(snap, { q: '  ' }), [], 'blank query');

/* ---- scroll maths ---- */
const main = scrollState('scroll:main', 100, 600, 3000);
eq(main, { container: 'scroll:main', top: 100, left: 0, height: 600, extent: 3000, atTop: false, atBottom: false, fraction: 0.042 }, 'state');
ok(scrollState('scroll:main', 9999, 600, 3000).top === 2400 && scrollState('scroll:main', 9999, 600, 3000).atBottom, 'state clamps and flags the bottom');
ok(scrollState('scroll:main', 0, 600, 400).atTop && scrollState('scroll:main', 0, 600, 400).atBottom && scrollState('scroll:main', 0, 600, 400).fraction === 0, 'content shorter than the view is at both ends');
eq(scrollStep(main, { dir: 'down' }), 300, 'down = a third of the view');
eq(scrollStep(main, { dir: 'up' }), 0, 'up clamps at 0');
eq(scrollStep(main, { dir: 'down', amount: 250 }), 350, 'px amount');
eq(scrollStep(main, { dir: 'down', amount: 0.5 }), 400, 'fraction amount');
eq(scrollStep(main, { dir: 'down', amount: 1 }), 700, '1 = a whole view');
eq(scrollStep(main, { dir: 'page-down' }, 32), 668, 'page down = view less one line');
eq(scrollStep(main, { dir: 'page-up' }, 32), 0, 'page up clamps');
eq(scrollStep(main, { dir: 'bottom' }), 2400, 'bottom = extent - height');
eq(scrollStep(main, { dir: 'top' }), 0, 'top');
eq(scrollStep(main, { dir: 'to' }, 0, 1500), 1200, 'to centres the target');
eq(scrollStep(main, { dir: 'to' }, 0, 2900), 2400, 'to clamps at the end');
eq(scrollStep(main, { dir: 'to' }, 0, 1500, false), 1500, 'to without centring');
fails(() => scrollStep(main, { dir: 'to' }), 'validation', 'to needs a target inside the container');
fails(() => scrollStep(main, { dir: 'sideways' as ConsoleControlScrollDir }), 'invalid', 'unknown direction');
eq(focusOptions(undefined), { select: true, expand: false, highlight: true, highlightMs: 1800 }, 'focus defaults');

/* ---- answers ---- */
const r = consoleControlResult({ verb: 'press', address: 'button:refresh', by: 'claude', reason: 'reload' }, { pressed: 'view:builds/button:refresh' }, { at: 'T' });
eq(r, { $axf: CONSOLE_CONTROL_FRAME, ok: true, verb: 'press', address: 'button:refresh', pressed: 'view:builds/button:refresh', audit: { by: 'claude', reason: 'reload', at: 'T' } }, 'a write result carries the audit');
ok(!('audit' in consoleControlResult({ verb: 'state' }, { state: {} })), 'a read result has no audit');
eq(consoleControlFailure('boom', 'x').code, 'unexpected', 'unknown codes read as unexpected');
eq(failureOf(new Error('secret')), { $axf: CONSOLE_CONTROL_FRAME, ok: false, code: 'unexpected', message: 'the command failed' }, 'a plain error never leaks its text');
eq(failureOf(new ConsoleControlError(CONSOLE_CONTROL_WIRE.DENIED, 'no', { requires: 'p' })), { $axf: CONSOLE_CONTROL_FRAME, ok: false, code: 'denied', message: 'no', requires: 'p' }, 'typed error → envelope');

/* ---- schemas + snapshot + fixture current ---- */
const reg = consoleControlRegistry() as { schemas: Record<string, { properties: Record<string, unknown>; [k: string]: unknown }> };
eq(read('framework/schemas/console-control.json'), JSON.parse(JSON.stringify(reg)), 'framework/schemas/console-control.json is the registry (node framework/cli/axf.mjs schemas rewrites it)');
for (const f of Object.keys(reg.schemas)) eq(read(`framework/schemas/json/${f}`), JSON.parse(JSON.stringify(reg.schemas[f])), `schemas/json/${f} is current`);
const cmdSchema = reg.schemas['console-control-command.schema.json']!;
for (const f of ['verb', 'address', 'value', 'scroll', 'query', 'options', 'confirm', 'by', 'reason']) ok(f in cmdSchema.properties, `command schema has ${f}`);
eq((cmdSchema.properties.verb as { enum: string[] }).enum, [...CONSOLE_CONTROL_VERB_IDS], 'schema verbs');
eq(((reg.schemas['console-control-result.schema.json']!.properties.code) as { enum: string[] }).enum, [...CONSOLE_CONTROL_CODES], 'schema codes');
const addrRe = new RegExp((cmdSchema.properties.address as { anyOf: { pattern: string }[] }).anyOf[0]!.pattern);
ok(addrRe.test(deep) && !addrRe.test('screen:x') && !addrRe.test('view:'), 'the schema address pattern agrees with the parser on the basics');
eq(fx.registry, JSON.parse(JSON.stringify({ kinds: CONSOLE_CONTROL_KINDS, verbs: CONSOLE_CONTROL_VERB_IDS, codes: CONSOLE_CONTROL_CODES, defaultCan: CONSOLE_CONTROL_DEFAULT_CAN })), 'fixture registry');
for (const [k, c] of Object.entries<unknown>(fx.commands)) {
  eq(consoleControlErrors(c), fx.errors[k], `fixture errors ${k}`);
  let got: unknown; try { got = normalizeConsoleControl(c); } catch (e) { got = failureOf(e); }
  eq(JSON.parse(JSON.stringify(got)), fx.normalize[k], `fixture normalize ${k}`);
}
for (const [k, a] of Object.entries<string>(fx.resolveCases)) {
  let got: unknown; try { const r = resolveAddress(snap, a); got = { address: r.target.address, kind: r.target.kind, can: r.can }; } catch (e) { got = failureOf(e); }
  eq(JSON.parse(JSON.stringify(got)), fx.resolve[k], `fixture resolve ${k}`);
}
for (const [k, [a, v]] of Object.entries<[string, ConsoleControlVerb]>(fx.verbCases)) {
  let got: unknown; try { const r = resolveForVerb(snap, a, v); got = { address: r.target.address, can: r.can }; } catch (e) { got = failureOf(e); }
  eq(JSON.parse(JSON.stringify(got)), fx.verbs[k], `fixture verb ${k}`);
}
eq(scrollStep(fx.scroll.states.main, { dir: 'page-down' }, 32), fx.scroll.steps['page-down'], 'fixture scroll step');
eq(scrollStep(fx.scroll.states.main, { dir: 'to' }, 0, 1500), fx.scroll.steps['to-centred'], 'fixture scroll to');
const verbs: ConsoleControlVerb[] = [...CONSOLE_CONTROL_VERB_IDS];
ok(verbs.length === 10, 'ten verbs on the type too');

/* ---- spec doc ---- */
const doc = readFileSync(new URL('framework/spec/CONSOLE-CONTROL.md', root), 'utf8');
for (const k of CONSOLE_CONTROL_KINDS) ok(doc.includes(`\`${k}\``), `CONSOLE-CONTROL.md names kind ${k}`);
for (const v of CONSOLE_CONTROL_VERB_IDS) ok(doc.includes(`\`${v}\``), `CONSOLE-CONTROL.md names verb ${v}`);
for (const c of CONSOLE_CONTROL_CODES) ok(doc.includes(`\`${c}\``), `CONSOLE-CONTROL.md names code ${c}`);
ok(readFileSync(new URL('framework/spec/INTEROP.md', root), 'utf8').includes('`ambiguous`'), 'INTEROP.md lists ambiguous');
ok(readFileSync(new URL('framework/spec/PORTING.md', root), 'utf8').includes('console-control@1'), 'PORTING.md records the Kotlin twin');

console.log(`✓ console-control@1 — ${n} checks, ${CONSOLE_CONTROL_KINDS.length} kinds, ${CONSOLE_CONTROL_VERB_IDS.length} verbs`);
