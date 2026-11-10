/**
 * molly-shell@1 (core/engines/molly-shell.ts): replays spec/fixtures/molly-shell.json through the reference engine (the
 * Kotlin twin, a native Molly shell, is deferred: spec/PORTING.md) and checks the rules the fixture states in words:
 * instance ids, the host catalog a guest console announces, host runs, the shell state snapshot, and the two embed@1
 * messages (`host-catalog`, `host-run`) that carry them.
 *   npx -y tsx framework/spec/check-molly-shell.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOST_ITEM_KINDS, HOST_ITEM_PREFIX, INSTANCE_SEP, MOLLY_SHELL_CONTRACT, SHELL_LIMITS, VIEW_SEP, hostCatalog, hostItemTarget, hostRunOf, hostRunSpec, instanceId, instanceOfView, instanceTitle, instancesOf, isHostItem, nextInstance, normalizeInstances, pageOfView, parseHostCatalog, parseHostRun, parseInstance, shellState, viewOn } from '../core/engines/molly-shell';
import { parseEmbedMessage } from '../core/engines/embed';

const root = new URL('../', import.meta.url).pathname;
const f = JSON.parse(readFileSync(join(root, 'spec/fixtures/molly-shell.json'), 'utf8'));
let checks = 0;
const ok = (c: unknown, msg: string) => { assert.ok(c, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg); checks++; };

// ---- registry ----
eq(f.contract, MOLLY_SHELL_CONTRACT, 'contract'); eq(f.sep, INSTANCE_SEP, 'separator'); eq(f.viewSep, VIEW_SEP, 'view separator'); eq(f.prefix, HOST_ITEM_PREFIX, 'host prefix'); eq(f.kinds, HOST_ITEM_KINDS, 'kinds'); eq(f.limits, SHELL_LIMITS, 'limits');

// ---- instances ----
for (const c of f.parse) eq(parseInstance(c.input), c.out, `parse ${JSON.stringify(c.input)}`);
eq(instanceId('console'), 'console', 'first copy is the app id'); eq(instanceId('console', 1), 'console', 'n=1 is the app id'); eq(instanceId('console', 2), 'console#2', 'second copy');
for (let n = 2; n <= SHELL_LIMITS.perApp; n++) eq(parseInstance(instanceId('console', n)), { id: `console#${n}`, app: 'console', n }, `round trip ${n}`);
ok(parseInstance(instanceId('console', SHELL_LIMITS.perApp + 1)) === null, 'past the per-app cap is not an instance');
for (const c of f.ofView) eq(instanceOfView(c.view, c.apps), c.out, `of view ${JSON.stringify(c.view)}`);
for (const c of f.pages) { eq(pageOfView(c.view), c.page, `page of ${c.view}`); eq(viewOn(instanceOfView(c.view)?.id ?? c.view, pageOfView(c.view)), c.back, `view on ${c.view}`); eq(c.back, c.view, `page + instance rebuild the view ${c.view}`); }
for (const c of f.next) { eq(nextInstance(c.open, c.app), c.out, `next ${JSON.stringify(c.open)} ${c.app}`); eq(instancesOf(c.open, c.app), c.of, `instances of ${c.app}`); }
ok(f.next.find((c: { open: string[] }) => c.open.length === SHELL_LIMITS.perApp)?.out === null, 'a full app hands out no more');
ok(f.next.find((c: { open: string[] }) => c.open.length === 1 && c.open[0] === 'console#2')?.out === 'console', 'the first copy is handed out even when a numbered one is open');
for (const c of f.titles) eq(instanceTitle(c.label, c.n), c.out, `title ${c.label} ${c.n}`);
for (const c of f.normalize) {
  eq(normalizeInstances(c.raw, f.apps), c.out, `normalize ${JSON.stringify(c.raw).slice(0, 60)}`);
  ok(c.out.length <= SHELL_LIMITS.instances, 'capped'); ok(new Set(c.out).size === c.out.length, 'unique');
  for (const id of c.out) { const i = parseInstance(id)!; ok(f.apps.includes(i.app), `known app ${id}`); if (i.n > 1) ok(c.out.indexOf(i.app) >= 0 && c.out.indexOf(i.app) < c.out.indexOf(id), `${id} comes after its first copy`); }
}

// ---- host catalog ----
eq(hostCatalog(f.catalog.host, f.catalog.src), f.catalog.out, 'host catalog'); eq(parseHostCatalog(f.catalog.src, f.catalog.host), f.catalog.parsed, 'parsed = built'); eq(f.catalog.parsed, f.catalog.out, 'parse and build agree'); eq(f.catalog.notList, null, 'not a list = null');
for (const it of f.catalog.out) {
  ok(isHostItem(it.id) && !isHostItem(hostItemTarget(it.id)), `${it.id} carries the prefix once`); ok(HOST_ITEM_KINDS.includes(it.kind), 'kind'); ok(it.detail.endsWith(`in ${f.catalog.host}`), 'detail says where'); ok(it.keywords.includes(f.catalog.host), 'host is a keyword');
  ok(it.label.length <= SHELL_LIMITS.label && it.detail.length <= SHELL_LIMITS.detail + 20 && it.keywords.length <= SHELL_LIMITS.keywords, 'clipped');
}
ok(!f.catalog.out.some((i: { id: string }) => i.id === 'host:molly.reload'), 'personOnly never handed out');
ok(f.catalog.out.filter((i: { id: string; kind: string }) => i.id === 'host:console' && i.kind === 'screen').length === 1, 'a duplicate is dropped');
ok(f.catalog.out.some((i: { id: string }) => i.id === 'host:molly.close-tab'), 'an already prefixed id is kept with one prefix');
ok(!f.catalog.out.some((i: { kind: string }) => i.kind === 'widget'), 'an unknown kind is dropped');
eq(f.big.out, SHELL_LIMITS.catalog, 'catalog cap'); eq(hostCatalog('molly', Array.from({ length: f.big.count }, (_, i) => ({ kind: 'action', id: `a${i}` })) as never).length, f.big.out, 'cap replay');

// ---- host runs ----
for (const c of f.runs) { const run = hostRunOf(c.item, c.opts); eq(run, c.run, `run of ${c.item.id}`); eq(hostRunSpec(run), c.spec, `spec of ${c.item.id}`); eq(parseHostRun(run), run, `a built run parses to itself (${c.item.id})`); ok(!isHostItem(run.target), 'target has no prefix'); }
for (const c of f.parseRuns) eq(parseHostRun(c.raw), c.out, `parse run ${JSON.stringify(c.raw).slice(0, 60)}`);
ok(f.parseRuns.find((c: { raw: { args?: unknown[] } }) => Array.isArray(c.raw?.args) && c.raw.args.length === 12)?.out.args.length === SHELL_LIMITS.args, 'args capped');

// ---- shell state ----
for (const c of f.states) {
  const s = shellState(c.input); eq(s, c.out, `state ${JSON.stringify(c.input.view)}`);
  eq(s.$axf, MOLLY_SHELL_CONTRACT, 'state contract'); ok(s.instances.every((i: { app: string }) => f.apps.includes(i.app)), 'known apps only'); ok(s.connected.every((a: string) => f.apps.includes(a)), 'connected are known apps');
  if (s.instance) ok(s.instances.some((i: { id: string }) => i.id === s.instance), 'the view’s instance counts as open');
  ok(s.ide.paneLimit >= 1 && s.ide.paneLimit <= 64 && typeof s.ide.on === 'boolean', 'ide checked');
}

// ---- embed@1 messages ----
for (const c of f.messages) { eq(parseEmbedMessage(c.input), c.message, `message ${c.input.type} ${JSON.stringify(c.input).slice(0, 50)}`); eq(parseEmbedMessage(JSON.stringify(c.input)), c.asString, `as string ${c.input.type}`); eq(c.asString, c.message, 'string and object agree'); }
ok(f.messages.some((c: { message: { type?: string } | null }) => c.message?.type === 'host-catalog'), 'a host-catalog parses'); ok(f.messages.some((c: { message: { type?: string } | null }) => c.message?.type === 'host-run'), 'a host-run parses');
// a big catalog still passes the string gate (same allowance as chrome)
const bigMsg = JSON.stringify({ $axf: 'embed@1', type: 'host-catalog', host: 'molly', items: Array.from({ length: 300 }, (_, i) => ({ kind: 'screen', id: `view${i}`, label: `Screen ${i} with a longer label`, detail: 'something long enough to push the message well past the small-message limit' })) });
ok(bigMsg.length > 4000 && (parseEmbedMessage(bigMsg) as { items: unknown[] } | null)?.items.length === 300, 'a long host-catalog string is read');

console.log(`check-molly-shell: ${checks} checks passed`);
