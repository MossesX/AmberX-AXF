#!/usr/bin/env node
/**
 * emergency-builds — send a Pipeline 2.0 build to emergency (Brett, Nov 20 2026: two emergency slots beside the
 * orchestrator's, for work he rams through by hand).
 *
 * An emergency build:
 *   - carries `emergency: { at, by }` in the builds store (pipeline-2@1, framework/core/pipeline-status.mjs);
 *   - holds an emergency grant on the VPS hard limit (build-limit.mjs), so its sessions are counted and admitted in the
 *     emergency slot pool (2 places, apart from maxBuilds) by the hard limit and the slot queue alike;
 *   - skips the one-active-build line in the dispatcher and goes to the front of the lander's merge line.
 *
 * Only Brett starts one, from his own signed-in console: the console server sets AXF_APPROVER (the signed-in hub
 * admin) + AXF_APPROVER_VIA=console for his click and nothing else does. A Claude session, a headless build, an agent,
 * the console token (MCP, REST, voice) and an axHub approval are all refused (framework/core/model-switch.mjs
 * approverFrom tells who is asking).
 *
 *   node framework/cli/emergency-builds.mjs send <build> [--json]    exit 0 sent · 3 refused (not Brett's console) · 2 bad build
 *   node framework/cli/emergency-builds.mjs clear <build> [--json]   back to an ordinary build (anyone: it removes a privilege)
 *   node framework/cli/emergency-builds.mjs list [--json]            the emergency builds and their grants
 */
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { approverFrom } from '../core/model-switch.mjs';
import * as P2 from '../core/pipeline-status.mjs';
import { findBuild } from '../plan/builds-store-core.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { grantEmergency, loadEmergency, revokeEmergency } from './build-limit.mjs';

export class EmergencyRefused extends Error { constructor(message, code = 3) { super(message); this.code = code; } }

/**
 * Who is asking, from the environment: { ok: true, by } only for Brett's own click in his signed-in console
 * (AXF_APPROVER + AXF_APPROVER_VIA=console, and nothing that marks the caller as a session, a build or an agent).
 */
export function ownerFrom(env = process.env) {
  const a = approverFrom(env);
  if (a.ok && a.via === 'console') return { ok: true, by: a.by };
  return { ok: false, why: 'only Brett sends a build to emergency, from his own signed-in console (Plan Studio 2.0 or the Build orchestrator): a session, an agent, the console token, MCP and voice cannot' };
}

/** The tag an emergency build carries. */
export const emergencyTag = (by, at = new Date().toISOString()) => ({ at, by: String(by || 'Brett').slice(0, 80) });

/** May this build go to emergency? → '' or the reason it may not. */
export function refusal(b) {
  if (!b || b.deleted) return 'no such build';
  if (b.flow !== P2.FLOW) return `${b.id} is not a Pipeline 2.0 build: only a build sent from Plan Studio 2.0 can go to emergency`;
  if (b.status === 'landed' || b.status === P2.EXIT) return `${b.id} is ${b.status}: nothing left to build`;
  return '';
}

/**
 * Tag a build as emergency and grant it the emergency slot pool. Brett's signed-in console only (ownerFrom).
 * → { ok, id, emergency: { at, by }, already } · throws EmergencyRefused (code 3 not Brett, 2 the build can't go).
 */
export function sendToEmergency(id, { env = process.env } = {}) {
  const who = ownerFrom(env);
  if (!who.ok) throw new EmergencyRefused(who.why, 3);
  const found = findBuild(loadStore(), id);
  const no = refusal(found);
  if (no) throw new EmergencyRefused(found ? no : `no build "${id}"`, 2);
  const tag = emergencyTag(who.by);
  let out = null;
  // the grant first: a tagged build without a grant would be sent out and refused by the hard limit
  grantEmergency(found.id, { by: who.by, owner: true });
  try {
    withStore((s) => {
      const b = findBuild(s, found.id);
      const why = refusal(b);
      if (why) throw new EmergencyRefused(why, 2);
      if (P2.isEmergency(b)) { out = { ok: true, id: b.id, emergency: b.emergency, already: true }; return s; }
      b.emergency = tag;
      b.notes = [...(b.notes ?? []), { text: `Sent to emergency by ${tag.by}: it skips the line, builds in the emergency slots and lands first.`, at: tag.at, by: tag.by }];
      out = { ok: true, id: b.id, emergency: tag, already: false };
      return s;
    }, { by: who.by, action: 'emergency:send', note: found.id });
  } catch (e) { if (!P2.isEmergency(findBuild(loadStore(), found.id))) revokeEmergency(found.id, { by: 'emergency-builds' }); throw e; }
  return out;
}

/** Back to an ordinary build: the tag and the grant go. Sessions already running finish; new ones use the ordinary slots. */
export function clearEmergency(id, { by = 'console' } = {}) {
  let cleared = false; let real = id;
  withStore((s) => {
    const b = findBuild(s, id);
    if (!b) return s;
    real = b.id;
    if (P2.isEmergency(b)) { delete b.emergency; b.notes = [...(b.notes ?? []), { text: `No longer an emergency build (${by}).`, at: new Date().toISOString(), by }]; cleared = true; }
    return s;
  }, { by, action: 'emergency:clear', note: id });
  const revoked = revokeEmergency(real, { by });
  return { ok: true, id: real, cleared: cleared || revoked };
}

/**
 * A hand build (hand-build@1, framework/cli/hand-build.mjs) Brett started and signed as emergency, still open: it keeps
 * its grant (its tag lives in `hand.emergency`, since it is no Pipeline 2.0 build).
 */
export function isOpenHandEmergency(b) {
  const h = b?.mode === 'hand' ? b.hand : null;
  return !!h && !b.deleted && b.status === 'running' && !!h.emergency?.at && h.state !== 'failed' && !['merged', 'closed'].includes(h.live?.state);
}

/**
 * Housekeeping (the dispatcher's pass): a grant whose build is no longer a live emergency build (landed, archived,
 * deleted, tag removed) is taken back. → the ids revoked.
 */
export function syncGrants(store = loadStore()) {
  const live = new Set(store.builds.filter((b) => (P2.isEmergency(b) && !refusal(b)) || isOpenHandEmergency(b)).map((b) => b.id));
  const gone = loadEmergency().map((g) => g.id).filter((id) => !live.has(id));
  for (const id of gone) revokeEmergency(id, { by: 'orchestrator' });
  return gone;
}

/** Every emergency build with its status and whether its grant is on file. */
export function list(store = loadStore()) {
  const grants = new Set(loadEmergency().map((g) => g.id));
  const p2 = store.builds.filter((b) => P2.isEmergency(b) && !b.deleted).map((b) => ({ id: b.id, title: b.title, status: b.status, emergency: b.emergency, granted: grants.has(b.id) }));
  const hand = store.builds.filter(isOpenHandEmergency).map((b) => ({ id: b.id, title: b.title, status: b.status, emergency: b.hand.emergency, granted: grants.has(b.id), mode: 'hand' }));
  return [...p2, ...hand];
}

function cli(argv) {
  const json = argv.includes('--json');
  const [cmd = 'list', id = ''] = argv.filter((a) => !a.startsWith('--'));
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  try {
    if (cmd === 'send') { const r = sendToEmergency(id); return print(r, r.already ? `${r.id} is already an emergency build` : `${r.id} sent to emergency`); }
    if (cmd === 'clear') { const r = clearEmergency(id, { by: process.env.AXF_ACTOR || 'cli' }); return print(r, r.cleared ? `${r.id} is an ordinary build again` : `${r.id} was not an emergency build`); }
    if (cmd === 'list') { const rows = list(); return print({ ok: true, builds: rows }, rows.map((r) => `${r.id} · ${r.status} · by ${r.emergency.by} ${r.emergency.at}${r.granted ? '' : ' · NO GRANT'}`).join('\n') || 'no emergency builds'); }
    throw new EmergencyRefused('usage: emergency-builds.mjs send <build> | clear <build> | list [--json]', 2);
  } catch (e) {
    process.exitCode = e instanceof EmergencyRefused ? e.code : 1;
    if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(`emergency-builds: ${e.message}`);
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) cli(process.argv.slice(2));
