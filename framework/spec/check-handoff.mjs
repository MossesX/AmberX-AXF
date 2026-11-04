#!/usr/bin/env node
// handoff@1 + session-link@1 (framework/core/engines/handoff.mjs, spec/HANDOFF.md): replays spec/fixtures/handoff.json —
// roles and the gate, two sessions racing for the same area, claim overlap and expiry, offer → accept → step done →
// replan, reject / hold / release reactions, take-back + undo, dedupe, slot split, helper status, sync file round trip,
// channel lines, events with resume — and keeps framework/schemas/handoff.json equal to the engine's registry.
// `--update` rewrites the fixture and the snapshot from the engine. Exit 1 on any difference.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as H from '../core/engines/handoff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, 'fixtures', 'handoff.json');
const SNAP = join(here, '..', 'schemas', 'handoff.json');
const update = process.argv.includes('--update');
let fails = 0; let n = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${detail}` : ''}`); } };
const clone = (v) => JSON.parse(JSON.stringify(v));
const T = (min) => new Date(Date.UTC(2026, 10, 4, 19, 0, 0) + min * 60000).toISOString();

/* ---- the scenario: everything computed here, then compared with the fixture (or written into it) ---- */
const out = {};
const link = H.emptyLink('amberx-axf');
link.settings = { claimTtlSec: 1200, heartbeatSec: 60, idleSec: 600, lunchSec: 1800, offlineSec: 3600 };

// 1. joins: first = primary; a new account waits for approval; same account as primary = primary
const j1 = H.join(link, { id: 's-1', account: 'brett', agent: 'rio', client: 'code', machine: 'vps', branch: 'claude/handoff-2' }, T(0));
const j2 = H.join(link, { id: 's-2', account: 'acct2', agent: 'paulie', client: 'code', machine: 'laptop' }, T(1));
const approved = H.approveAccount(link, 'acct2', T(2));
const j3 = H.join(link, { id: 's-3', account: 'brett', agent: 'joey', client: 'chat' }, T(3));
out.joins = { s1: { role: j1.session.role, becamePrimary: j1.becamePrimary, needsApproval: j1.needsApproval }, s2: { role: j2.session.role, becamePrimary: j2.becamePrimary, needsApproval: j2.needsApproval }, approved, s3: { role: j3.session.role, becamePrimary: j3.becamePrimary } };
out.roles = { 's-1': H.roleOf(link, 's-1'), 's-2': H.roleOf(link, 's-2'), 's-3': H.roleOf(link, 's-3'), unknown: H.roleOf(link, 'nope'), byAccount: H.roleOf(link, { account: 'acct2' }), brettAccount: H.roleOf(link, { account: 'brett' }) };

// 2. the gate
out.gate = {};
for (const a of ['state', 'claim', 'send', 'request-work', 'respond', 'step', 'build-add', 'build-reorder', 'offer', 'take-back', 'replan', 'settings', 'approve-account', 'nope']) out.gate[a] = { primary: H.gate('primary', a), secondary: H.gate('secondary', a), brett: H.gate('secondary', a, { brett: true }), none: H.gate('none', a) };

// 3. claims: the race for one area
const c1 = H.claim(link, { session: 's-1', kind: 'area', area: 'kernel', reason: 'engine work', build: 'handoff-2', step: 's2' }, T(4));
const c2 = H.claim(link, { session: 's-2', kind: 'path', paths: ['framework/core/engines/x.mjs'], reason: 'same area' }, T(4));
const c3 = H.claim(link, { session: 's-2', kind: 'path', paths: ['apps/console-web/plugins/foo/**'], reason: 'plugin', build: 'foo' }, T(5));
const c4 = H.claim(link, { session: 's-1', kind: 'area', area: 'plugins', reason: 'all plugins' }, T(5));
const c5 = H.claim(link, { session: 's-1', kind: 'path', paths: ['apps/console-web/plugins/bar/**'], reason: 'another plugin' }, T(5));
const c1again = H.claim(link, { session: 's-1', kind: 'area', area: 'kernel', reason: 'renew' }, T(6));
const bad = H.claim(link, { session: 's-1', kind: 'area', area: 'nope' }, T(6));
const noSession = H.claim(link, { session: 'zz', kind: 'area', area: 'kernel' }, T(6));
out.claims = { c1: { ok: c1.ok, id: c1.claim?.id, expiresAt: c1.claim?.expiresAt }, c2: { ok: c2.ok, code: c2.code, by: c2.by, until: c2.until }, c3: { ok: c3.ok, id: c3.claim?.id }, c4: { ok: c4.ok, code: c4.code, by: c4.by?.session }, c5: { ok: c5.ok }, renewed: { ok: c1again.ok, renewed: c1again.renewed === true, expiresAt: c1again.claim?.expiresAt }, bad: { ok: bad.ok, code: bad.code }, noSession: { ok: noSession.ok, code: noSession.code }, held: Object.keys(link.claims) };
out.checkPaths = {
  s1Kernel: H.checkPaths(link, 's-1', ['framework/core/engines/handoff.mjs', 'framework/spec/HANDOFF.md'], T(6)),
  s2Plugin: H.checkPaths(link, 's-2', ['apps/console-web/plugins/foo/web/index.tsx'], T(6)),
  s2Kernel: H.checkPaths(link, 's-2', ['framework/core/runtime.ts'], T(6)),
};
out.covering = { s1: H.coveringClaim(link, 's-1', 'framework/core/a.ts')?.id ?? null, s2: H.coveringClaim(link, 's-2', 'framework/core/a.ts')?.id ?? null };
const hb = H.heartbeat(link, 's-2', { build: 'foo', step: 's1', note: 'wiring the panel' }, T(10));
out.heartbeat = { lastSeenAt: hb.lastSeenAt, doing: hb.doing, c3ExpiresAt: link.claims[c3.claim.id].expiresAt };
const afterTtl = clone(link); const gone = H.expireClaims(afterTtl, T(27)); // s-1's claims (T5 → T25, renewed T6 → T26) are gone at T27; s-2's (heartbeat T10 → T30) stays
out.expiry = { gone, left: Object.keys(afterTtl.claims) };
out.globs = [['a/b/**', 'a/b/c.ts'], ['a/**', 'a/b/**'], ['a/b/**', 'a/c/**'], ['a/*.ts', 'a/b.ts'], ['a/*.ts', 'a/b/c.ts'], ['framework/react/components/Banner*.tsx', 'framework/react/components/BannerStrip.tsx'], ['apps/x', 'apps/x/y/z.ts'], ['apps/x', 'apps/xy/z.ts'], ['**/foo.ts', 'a/b/foo.ts']].map(([g, p]) => ({ glob: g, path: p, matches: H.pathMatches(g, p), overlap: H.globOverlap(g, p), prefix: H.globPrefix(g) }));
out.release = { one: H.release(link, 's-1', c5.claim.id, T(11)), all: H.release(link, 's-1', null, T(11)), left: Object.keys(link.claims) };

// 4. builds and offers
const builds = [
  { id: 'handoff-2', title: 'Session sync', status: 'running', createdAt: T(-60), touches: ['spec', 'kernel'], steps: [{ id: 's1', text: 'Spec', model: 'Fable', done: true, estimate: '30 min' }, { id: 's2', text: 'Engine', model: 'Fable', estimate: '30 min', files: ['framework/core/engines/handoff.mjs'] }, { id: 's3', text: 'Plugin server', model: 'Fable', estimate: '30 min', after: ['s2'], files: ['apps/console-web/plugins/session-sync/server/**'] }, { id: 's4', text: 'Docs', model: 'Opus', estimate: '20 min', files: ['framework/spec/HANDOFF.md'] }, { id: 's5', text: 'Shots', model: 'Opus', estimate: '20 min', files: ['_claude/builds/reports/handoff-2/**'] }] },
  { id: 'foo', title: 'Foo plugin', status: 'pending', createdAt: T(-30), steps: [{ id: 's1', text: 'Foo one', model: 'Opus', estimate: '20 min', files: ['apps/console-web/plugins/foo/**'] }, { id: 's2', text: 'Foo two', model: 'Opus', estimate: '20 min' }] },
  { id: 'bar', title: 'Bar screen', status: 'pending', createdAt: T(-20), after: ['foo'], steps: [{ id: 's1', text: 'Bar', model: 'Opus', estimate: '1 h', files: ['apps/console-web/src/views/Bar.tsx'] }] },
  { id: 'baz', title: 'Baz kernel twin', status: 'pending', createdAt: T(-10), touches: ['kernel'], steps: [{ id: 's1', text: 'Baz', model: 'Fable', estimate: '30 min' }] },
  { id: 'old', title: 'Old thing', status: 'complete', createdAt: T(-500), steps: [] },
];
H.claim(link, { session: 's-1', kind: 'area', area: 'kernel', build: 'handoff-2', step: 's2' }, T(12));
H.heartbeat(link, 's-1', { build: 'handoff-2', step: 's2' }, T(12));
out.pickOffers = { paulie: H.pickOffers(builds, link, { session: 's-2', minutes: 60, max: 3 }, T(12)), opusOnly: H.pickOffers(builds, link, { session: 's-2', model: 'Opus', max: 5 }, T(12)), kernelArea: H.pickOffers(builds, link, { session: 's-2', areas: ['kernel'] }, T(12)) };
const o1 = H.makeOffer(link, { build: 'foo', mode: 'whole', to: 's-2', from: 's-1', reason: 'queued, fits an hour' }, T(13));
const o1dup = H.makeOffer(link, { build: 'foo', mode: 'whole', to: 's-2', from: 's-1' }, T(13));
const o2 = H.makeOffer(link, { build: 'handoff-2', steps: ['s4', 's5'], mode: 'steps-new-build', to: 's-2', from: 's-1', reason: 'docs + shots split out' }, T(13));
out.offers = { o1: clone(o1.offer), dup: o1dup.duplicate === true && o1dup.offer.id === o1.offer.id, o2: { id: o2.offer.id, childBuild: o2.offer.childBuild, steps: o2.offer.steps, mode: o2.offer.mode }, open: H.openOffers(link, 's-2').map((o) => o.id), openOther: H.openOffers(link, 's-3').map((o) => o.id) };
let threw = '';
try { H.respond(link, { session: 's-3', offer: o1.offer.id, response: 'accept' }, T(14)); } catch (e) { threw = e.message; }
out.respondWrongSession = threw;
try { H.respond(link, { session: 's-2', offer: o1.offer.id, response: 'reject' }, T(14)); threw = ''; } catch (e) { threw = e.message; }
out.rejectNeedsReason = threw;
const acc = H.respond(link, { session: 's-2', offer: o1.offer.id, response: 'accept' }, T(14));
out.accept = clone({ assignment: acc.assignment, offerStatus: acc.offer.status, reaction: acc.reaction });
out.badgeQueued = H.assignedBadge(link, 'foo', '', T(14), H.settingsOf(link), builds[1]);
H.heartbeat(link, 's-2', { build: 'foo', step: 's1' }, T(15));
const st1 = H.stepState(link, { session: 's-2', assignment: acc.assignment.id, step: 's1', state: 'started' }, T(15));
out.badgeWorking = H.assignedBadge(link, 'foo', 's1', T(15), H.settingsOf(link), builds[1]);
const st2 = H.stepState(link, { session: 's-2', assignment: acc.assignment.id, step: 's1', state: 'done' }, T(25));
out.steps = clone({ started: { status: st1.assignment.status, state: st1.assignment.stepStates.s1 }, done: { status: st2.assignment.status, reaction: st2.reaction, stepsDone: link.stats.acct2.stepsDone, msPerStep: link.stats.acct2.msPerStep } });
const acc2 = H.respond(link, { session: 's-2', offer: o2.offer.id, response: 'accept' }, T(26));
try { H.stepState(link, { session: 's-2', assignment: acc2.assignment.id, step: 's9', state: 'done' }, T(26)); threw = ''; } catch (e) { threw = e.message; }
out.stepNotOnAssignment = threw;
out.accept2 = clone({ build: acc2.assignment.build, parent: acc2.assignment.parent, steps: acc2.assignment.steps, order: acc2.assignment.order });
out.patches = H.assignmentPatches(builds, link);
out.scoped = { s2: H.scopedBuilds(builds, link, 's-2').map((b) => ({ id: b.id, steps: b.steps.map((s) => s.id), assignedTo: b.assignedTo, offer: b.offer, managedBy: b.managedBy, pending: b.pending === true })), s3: H.scopedBuilds(builds, link, 's-3').map((b) => b.id), nobody: H.scopedBuilds(builds, link, 'zz') };
const blocked = H.stepState(link, { session: 's-2', assignment: acc2.assignment.id, step: 's4', state: 'blocked', reason: 'needs the schema' }, T(26));
out.blocked = clone({ status: blocked.assignment.status, reaction: blocked.reaction, steps: blocked.assignment.steps, stepStates: blocked.assignment.stepStates });
const hold = H.respond(link, { session: 's-2', assignment: acc2.assignment.id, response: 'hold', reason: 'lunch', backAt: T(60) }, T(27));
out.hold = clone({ status: hold.assignment.status, backAt: hold.assignment.backAt, reaction: hold.reaction });
out.badgeHeld = H.assignedBadge(link, 'handoff-2', 's5', T(27), H.settingsOf(link));
const tb0 = H.takeBack(link, { assignment: acc2.assignment.id }, T(29));
const tbWorking = (() => { const l = clone(link); l.assignments[acc2.assignment.id].status = 'working'; return { noConfirm: H.takeBack(l, { assignment: acc2.assignment.id }, T(29)), confirmed: H.takeBack(l, { assignment: acc2.assignment.id, confirm: true, reason: 'needed now' }, T(29)).assignment.status }; })();
out.takeBack = clone({ held: { ok: tb0.ok, status: tb0.assignment.status }, working: { noConfirm: { ok: tbWorking.noConfirm.ok, code: tbWorking.noConfirm.code }, confirmed: tbWorking.confirmed }, nothing: H.takeBack(link, { build: 'nothing' }, T(29)) });
const tbSeq = link.events.filter((e) => e.type === 'handover' && e.data.action === 'take-back').pop().seq;
out.undo = { ok: H.undoHandover(link, tbSeq, T(30)).ok, status: link.assignments[acc2.assignment.id].status, bad: H.undoHandover(link, 1, T(30)).ok };
const j4 = H.join(link, { id: 's-4', account: 'acct2', agent: 'tex', client: 'headless' }, T(30));
const rel = H.respond(link, { session: 's-2', assignment: acc2.assignment.id, response: 'release', reason: 'out of time' }, T(31));
out.release2 = clone({ approvedWithoutAsk: j4.needsApproval === false, status: rel.assignment.status, reaction: rel.reaction, reOffered: Object.values(link.offers).filter((o) => o.status === 'offered' && o.to === 's-4').map((o) => ({ build: o.build, childBuild: o.childBuild, steps: o.steps, mode: o.mode })) });
const relAlone = (() => { const l = clone(link); delete l.sessions['s-4']; const a = Object.values(l.assignments).find((x) => x.build === 'foo'); a.status = 'queued'; return H.respond(l, { session: 's-2', assignment: a.id, response: 'release' }, T(32)).reaction; })();
out.releaseAlone = relAlone;
out.stats = clone(link.stats);

// 5. replan
out.replan = (() => {
  const l = clone(link);
  const bs = clone(builds).map((b) => ({ ...b, order: { current: ['bar', 'baz', 'foo', 'handoff-2'].indexOf(b.id) + 1 } }));
  const dry = H.replan(bs, l, { profile: 'current', dryRun: true, maxAgents: 6 }, T(33));
  const real = H.replan(bs, l, { profile: 'current', maxAgents: 6 }, T(33));
  const pinned = H.replan(bs.map((b) => (b.id === 'bar' ? { ...b, pinned: true } : b)), clone(link), { profile: 'current', dryRun: true }, T(33));
  return { before: dry.before, order: dry.order, moves: dry.moves, summary: dry.summary, helperOrder: dry.helperOrder, caps: dry.caps, dryNoEvent: dry.seq === 0 && real.seq > 0, pinnedOrder: pinned.order, pinnedMoves: pinned.moves.map((m) => m.id) };
})();

// 6. dedupe, slot split, status
out.match = [
  H.matchJob({ id: 'foo', title: 'x' }, builds), H.matchJob({ title: 'Foo Plugin!' }, builds), H.matchJob({ title: 'Session sync for two Claude sessions', detail: 'Spec Engine Plugin server Docs Shots session sync', steps: ['Spec', 'Engine', 'Plugin server'] }, builds), H.matchJob({ title: 'Totally different thing' }, builds), H.matchJob({ title: 'Old thing' }, builds),
].map((m) => ({ match: m.match?.id ?? null, score: m.score, how: m.how }));
const sess = Object.values(link.sessions);
out.slots = { equal: H.slotSplit(6, sess), split: H.slotSplit(6, sess, { 's-1': 0.5 }), tight: H.slotSplit(2, sess), none: H.slotSplit(6, []) };
out.status = {};
for (const [name, s, at] of [['working', link.sessions['s-1'], T(13)], ['idle', link.sessions['s-1'], T(20)], ['lunchQuiet', link.sessions['s-1'], T(45)], ['offline', link.sessions['s-1'], T(90)], ['paused', { ...link.sessions['s-1'], pause: { reason: 'usage limit', until: T(120) } }, T(13)], ['pausedOver', { ...link.sessions['s-1'], pause: { reason: 'usage limit', until: T(12) } }, T(13)], ['ended', { ...link.sessions['s-1'], endedAt: T(13) }, T(13)], ['pending', { ...link.sessions['s-1'], approved: false }, T(13)], ['none', null, T(13)]]) {
  out.status[name] = { status: H.sessionStatus(s, at, H.settingsOf(link)), helper: H.helperStatus(s, at, H.settingsOf(link)) };
}

// 7. end a session (primary hands over to the same account)
const ended = H.endSession(link, 's-1', T(40), 'engine + spec done');
out.end = clone({ ...ended, primary: link.primary, s3Role: link.sessions['s-3'].role, s1Status: H.sessionStatus(link.sessions['s-1'], T(40), H.settingsOf(link)) });
const endedHelper = H.endSession(link, 's-2', T(41));
out.endHelper = { ...endedHelper, foo: link.assignments[acc.assignment.id].status };

// 8. sync file
const doc = H.makeSync(link, { builds, console: 'https://console.amberxai.com', prs: [{ number: 321, title: 'Session sync', branch: 'claude/handoff-2', state: 'open', ci: 'green' }], attention: [{ kind: 'ci-red', ref: 'main', text: 'kernel test' }], decisions: [{ at: T(0), text: 'no more THREADS' }], rules: ['CLAUDE.md'], next: ['land it', 'token: ghp_abcdefghijklmnopqrstuvwxyz0123456789'] }, { session: 's-3', account: 'brett', agent: 'joey', client: 'chat' }, T(42));
const md = H.renderSync(doc);
out.sync = { doc, fresh: { now: H.isFresh(doc, T(50)), later: H.isFresh(doc, T(80)) }, roundTrip: isDeepStrictEqual(H.parseSync(md), doc), mdHead: md.split('\n').slice(0, 4), errors: H.syncErrors(doc), badErrors: H.syncErrors({ $axf: 'nope', next: ['sk-ant-abcdefghijklmnopqrstuvwxyz'] }), parseNone: H.parseSync('# nothing') };
out.redact = { text: H.redactText('token=abcdef123456 and Bearer abcdefghijklmnopqrst and https://u:pw123@x.y/z'), has: H.hasSecret('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), clean: H.hasSecret('plain words') };

// 9. channel lines, filters, events
const names = { rio: 'Rio React', paulie: 'Ping Paulie', joey: 'Janitor Joey', tex: 'Tex Tester', 's-1': 'Rio React', 's-2': 'Ping Paulie' };
out.lines = link.events.map((e) => ({ seq: e.seq, type: e.type, line: H.channelLine(e, names) }));
const msgs = out.lines.filter((l) => l.line).map((l, i) => ({ id: `m${i}`, from: 'boss', channel: 'sessions', ...l.line }));
out.filters = { all: H.filterChannel([...msgs, { id: 'x', from: 'rio', kind: 'banter', text: 'hi', channel: '' }], 'all').length, handovers: H.filterChannel(msgs, 'handovers').length, blockers: H.filterChannel(msgs, 'blockers').map((m) => m.text), mine: H.filterChannel(msgs, 'mine', 'boss', ['foo']).length };
out.events = { since0: H.eventsSince(link, 0, 5), sinceLast: H.eventsSince(link, link.seq), gap: (() => { const l = clone(link); l.events = l.events.slice(-3); return H.eventsSince(l, 1, 10); })() };
const trimmed = clone(link); trimmed.settings.eventLimit = 5; for (let i = 0; i < 8; i++) H.pushEvent(trimmed, 'link', { i }, T(50));
out.eventLimit = { kept: trimmed.events.length, seq: trimmed.seq, rev: trimmed.rev };
out.linkErrors = { ok: H.linkErrors(link), bad: H.linkErrors({ $axf: 'x', sessions: { a: {} }, claims: { c: { kind: 'area' } }, offers: { o: { mode: 'x' } }, assignments: { a: { status: 'x' } }, primary: {} }) };
out.normRoundTrip = isDeepStrictEqual(H.normLink(clone(link)), link);
out.registry = H.registrySnapshot();

/* ---- compare or update ---- */
if (update) {
  writeFileSync(FX, JSON.stringify({ $axf: 'handoff-fixture@1', note: 'Generated by framework/spec/check-handoff.mjs --update from framework/core/engines/handoff.mjs. Do not edit by hand.', results: out }, null, 1) + '\n');
  writeFileSync(SNAP, JSON.stringify(out.registry, null, 2) + '\n');
  console.log(`wrote ${FX} and ${SNAP}`);
}
const fx = JSON.parse(readFileSync(FX, 'utf8')).results;
for (const k of Object.keys(out)) check(`fixture: ${k}`, isDeepStrictEqual(clone(out[k]), fx[k]), `got ${JSON.stringify(out[k]).slice(0, 600)}`);
for (const k of Object.keys(fx)) check(`fixture key still computed: ${k}`, k in out);
check('schemas/handoff.json = the engine registry', isDeepStrictEqual(JSON.parse(readFileSync(SNAP, 'utf8')), out.registry));
const sessionRedact = JSON.parse(readFileSync(join(here, '..', 'schemas', 'session.json'), 'utf8')).redact.map((r) => ({ id: r.id, pattern: r.pattern, flags: r.flags || '' }));
check('redact rules = session@1 redact', isDeepStrictEqual(H.REDACT_RULES, sessionRedact));

/* ---- the rules in words (so a fixture regenerated by mistake still has to obey them) ---- */
check('first join is primary, a new account waits, same account is primary', out.joins.s1.becamePrimary && out.joins.s1.role === 'primary' && out.joins.s2.needsApproval && out.joins.s2.role === 'secondary' && out.joins.s3.role === 'primary' && !out.joins.s3.becamePrimary);
check('secondary is refused on build and orchestrator writes, allowed on reads / claims / respond', !out.gate['build-add'].secondary.ok && out.gate['build-add'].secondary.code === 'secondary' && !out.gate.offer.secondary.ok && !out.gate.replan.secondary.ok && out.gate.state.secondary.ok && out.gate.claim.secondary.ok && out.gate.respond.secondary.ok && out.gate['request-work'].secondary.ok);
check('owner-only actions are refused for both roles, allowed for Brett', !out.gate.settings.primary.ok && out.gate.settings.primary.code === 'owner' && out.gate.settings.brett.ok && out.gate['approve-account'].brett.ok);
check('unknown action and no session are refused', out.gate.nope.primary.code === 'unknown-action' && out.gate.state.none.code === 'no-session');
check('the race: the second session gets claimed-by with the holder', out.claims.c1.ok && !out.claims.c2.ok && out.claims.c2.code === 'claimed' && out.claims.c2.by.session === 's-1' && out.claims.c2.by.agent === 'rio');
check('an area claim overlaps a path claim under it', out.claims.c3.ok && !out.claims.c4.ok && out.claims.c4.by === 's-2' && out.claims.c5.ok);
check('a repeated claim renews instead of duplicating', out.claims.renewed.ok && out.claims.renewed.renewed && out.claims.held.length === 3);
check('checkPaths: covered / outside / claimed by', !out.checkPaths.s1Kernel.ok && out.checkPaths.s1Kernel.outside.length === 1 && out.checkPaths.s1Kernel.claimedBy.length === 0 && out.checkPaths.s2Plugin.ok && !out.checkPaths.s2Kernel.ok && out.checkPaths.s2Kernel.claimedBy[0].session === 's-1');
check('heartbeat renews the session\'s claims', out.heartbeat.c3ExpiresAt === T(30) && out.heartbeat.doing.step === 's1');
check('expired claims go, live ones stay', out.expiry.gone.length === 2 && out.expiry.left.length === 1);
check('glob rules', out.globs[0].matches && out.globs[1].overlap && !out.globs[2].overlap && out.globs[3].matches && !out.globs[4].matches && out.globs[5].matches && out.globs[6].matches && !out.globs[7].matches && out.globs[8].matches);
check('pickOffers: queued builds first (foo; bar waits on foo), never the kernel one the primary holds', out.pickOffers.paulie[0]?.build === 'foo' && out.pickOffers.paulie.every((o) => o.build !== 'baz' && o.build !== 'bar') && out.pickOffers.kernelArea.every((o) => o.build !== 'baz'));
check('pickOffers: steps split out of a running build skip the running step and its dependents', out.pickOffers.opusOnly.some((o) => o.build === 'handoff-2' && o.mode === 'steps-new-build' && !o.steps.includes('s2') && !o.steps.includes('s3')));
check('an offer twice is one offer; offers to a session are only its', out.offers.dup && out.offers.open.length === 2 && out.offers.openOther.length === 0);
check('wrong session / missing reason are refused', /not for you/.test(out.respondWrongSession) && /needs a reason/.test(out.rejectNeedsReason));
check('accept makes a queued assignment and replans', out.accept.assignment.status === 'queued' && out.accept.offerStatus === 'accepted' && out.accept.reaction.decision === 'replan');
check('badges: queued → working (animated, step n/m from the build) → held', out.badgeQueued.kind === 'queued' && /queue \(#1\)/.test(out.badgeQueued.text) && out.badgeWorking.kind === 'working' && out.badgeWorking.animated && /step 1\/2/.test(out.badgeWorking.text) && out.badgeHeld.kind === 'held');
check('steps: started → working; done counts and times; a step not on the assignment is refused', out.steps.started.status === 'working' && out.steps.done.stepsDone === 1 && out.steps.done.msPerStep[0] === 600000 && /not on this assignment/.test(out.stepNotOnAssignment));
check('steps as a new build keep the parent', out.accept2.parent === 'handoff-2' && out.accept2.build === 'handoff-2-s-2-4-5' && out.accept2.order === 2);
check('patches put assignedTo on steps with withHelper', out.patches.find((p) => p.id === 'handoff-2')?.steps.s4.withHelper === 'handoff-2-s-2-4-5' && out.patches.find((p) => p.id === 'foo')?.assignedTo.session === 's-2');
check('a secondary sees only its assignments (+ the child build not in the store yet); the primary account and unknown sessions see nothing through scope', out.scoped.s2.some((b) => b.id === 'foo' && b.assignedTo?.status === 'working') && out.scoped.s2.some((b) => b.id === 'handoff-2-s-2-4-5' && b.pending && b.steps.length === 2) && out.scoped.s2.every((b) => b.managedBy === 'orchestrator') && out.scoped.s3.length === 0 && out.scoped.nobody.length === 0);
check('hold → wait until backAt', out.hold.status === 'held' && out.hold.reaction.decision === 'wait' && out.hold.reaction.until === T(60));
check('blocked step → that step taken back, the rest stays', out.blocked.reaction.decision === 'take-back' && isDeepStrictEqual(out.blocked.steps, ['s5']) && out.blocked.status === 'queued' && out.blocked.stepStates.s4.state === 'blocked');
check('take back: held any time; working needs confirm; undo restores', out.takeBack.held.ok && out.takeBack.held.status === 'taken-back' && !out.takeBack.working.noConfirm.ok && out.takeBack.working.noConfirm.code === 'confirm' && out.takeBack.working.confirmed === 'taken-back' && out.undo.ok && out.undo.status === 'queued' && !out.undo.bad);
check('release → re-offer to another helper when one is on, else take back', out.release2.reaction.decision === 're-offer' && out.release2.reaction.to === 's-4' && out.release2.reOffered.length === 1 && out.releaseAlone.decision === 'take-back');
check('a second session of an approved account needs no approval', out.release2.approvedWithoutAsk);
check('stats count accepts / holds / released', out.stats.acct2.accepts === 2 && out.stats.acct2.holds === 1 && out.stats.acct2.released === 1 && out.stats.acct2.offers >= 2);
check('replan: running builds (handoff-2, and foo where the helper works) first and never moved, bar after foo (depends), baz last (kernel held by the running build), dry run makes no event', isDeepStrictEqual(out.replan.order.slice(0, 2), ['foo', 'handoff-2']) && out.replan.order.indexOf('bar') > out.replan.order.indexOf('foo') && out.replan.order[out.replan.order.length - 1] === 'baz' && out.replan.dryNoEvent && out.replan.moves.length >= 1 && out.replan.moves.every((m) => m.why) && out.replan.summary.length === out.replan.moves.length);
check('replan: a pinned build keeps its place (right after the running ones)', out.replan.pinnedOrder[2] === 'bar' && !out.replan.pinnedMoves.includes('bar'));
check('dedupe: id, title, similar, none, finished builds never match', out.match[0].how === 'id' && out.match[1].how === 'title' && out.match[2].how === 'similar' && out.match[2].match === 'handoff-2' && out.match[3].match === null && out.match[4].match === 'old');
check('slot split: equal shares, a fixed share, the primary never below one', Object.values(out.slots.equal).every((v) => v === 1) && out.slots.split['s-1'] === 3 && out.slots.tight['s-1'] >= 1 && isDeepStrictEqual(out.slots.none, {}));
check('session status ladder', out.status.working.status === 'working' && out.status.idle.status === 'idle' && out.status.lunchQuiet.status === 'lunch' && out.status.offline.status === 'offline' && out.status.paused.status === 'lunch' && out.status.pausedOver.status === 'working' && out.status.ended.status === 'ended' && out.status.pending.status === 'pending');
check('helper widget states', out.status.working.helper.state === 'working' && /handoff-2/.test(out.status.working.helper.tooltip) && out.status.lunchQuiet.helper.state === 'lunch' && out.status.offline.helper.state === 'none' && out.status.none.helper.state === 'none' && out.status.idle.helper.state === 'idle');
check('ending the primary hands primary to the same account; ending a helper gives its work back', out.end.primaryTo === 's-3' && out.end.primary.session === 's-3' && out.end.s3Role === 'primary' && out.end.released.length === 1 && out.endHelper.givenBack.length >= 1 && out.endHelper.foo === 'released');
check('sync file: fresh for 30 min, round trips through the .md, secrets redacted', out.sync.fresh.now && !out.sync.fresh.later && out.sync.roundTrip && out.sync.errors.length === 0 && out.sync.doc.next[1].includes('[redacted github-token]') && out.sync.badErrors.some((e) => e.field === 'secret') && out.sync.parseNone === null);
check('redact keeps the prefix of key=value and bearer', /token=\[redacted secret-value\]/.test(out.redact.text) && /Bearer \[redacted bearer\]/.test(out.redact.text) && /u:\[redacted url-credentials\]@/.test(out.redact.text) && out.redact.has && !out.redact.clean);
check('every event that matters becomes a channel line with the agent\'s name', out.lines.filter((l) => l.type === 'handover').every((l) => l.line && l.line.kind === 'handover') && out.lines.some((l) => l.line?.text.includes('Ping Paulie joined as secondary')) && out.lines.some((l) => /took foo/.test(l.line?.text ?? '')));
check('chat filters', out.filters.handovers > 0 && out.filters.blockers.length > 0 && out.filters.mine > 0);
check('events: resume, next, gap', out.events.since0.events.length === 5 && out.events.since0.more && out.events.sinceLast.events.length === 0 && out.events.gap.gap && out.eventLimit.kept === 5);
check('link validation', out.linkErrors.ok.length === 0 && out.linkErrors.bad.length >= 5 && out.normRoundTrip);

console.log(`${fails ? '✗' : '✓'} handoff@1 / session-link@1: ${n - fails}/${n} checks`);
process.exit(fails ? 1 : 0);
