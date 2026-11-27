#!/usr/bin/env node
/**
 * emergency-send — the console server's write for POST /pipeline/emergency (Brett, Nov 24 2026: Claude may send a
 * build to emergency when he says so, logged with who asked and why).
 *
 * The route decides who may (Brett's own signed-in click, or a console-token caller with a reason and a name while
 * the Claude setting builds.claudeEmergency is on); this script only writes, through the builds store and the hard
 * limit's emergency grants, the same way framework/cli/emergency-builds.mjs does:
 *
 *   echo '{"by":"…","via":"person"|"console-token","askedBy":"…","reason":"…"}' | node emergency-send.mjs <build>
 *
 * Prints one JSON line: { ok, id, emergency: { by, via, askedBy, reason, at }, already } · exit 2 bad request or
 * build, 3 refused. `via: 'person'` is taken only with the approver the server sets for Brett's click (ownerFrom).
 */
import { readFileSync } from 'node:fs';
import * as P2 from '../../../../../framework/core/pipeline-status.mjs';
import { findBuild } from '../../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../../framework/cli/builds-store.mjs';
import { grantEmergency, revokeEmergency } from '../../../../../framework/cli/build-limit.mjs';
import { EmergencyRefused, ownerFrom, refusal } from '../../../../../framework/cli/emergency-builds.mjs';

const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function send(id, input) {
  const via = input.via === 'person' ? 'person' : 'console-token';
  let by; let askedBy; let reason;
  if (via === 'person') {
    const who = ownerFrom(process.env);
    if (!who.ok) throw new EmergencyRefused(who.why, 3);
    by = text(who.by, 80); askedBy = text(input.askedBy, 80) || by; reason = text(input.reason, 400);
  } else {
    askedBy = text(input.askedBy, 80); reason = text(input.reason, 400);
    if (!reason) throw new EmergencyRefused('reason is missing: say why this build goes to emergency', 2);
    if (!askedBy) throw new EmergencyRefused('askedBy is missing: name the session or agent that asks', 2);
    by = askedBy;
  }
  const found = findBuild(loadStore(), id);
  const no = refusal(found);
  if (no) throw new EmergencyRefused(found ? no : `no build "${id}"`, 2);
  const at = new Date().toISOString();
  const tag = P2.normEmergency({ by, via, askedBy, reason, at });
  const note = via === 'person'
    ? `Sent to emergency by ${by}: it skips the line, builds in the emergency slots and lands first.`
    : `Sent to emergency by ${askedBy} (a Claude session, with the console token). Why: ${reason} It skips the line, builds in the emergency slots and lands first.`;
  let out = null;
  // the grant first: a tagged build without a grant would be sent out and refused by the hard limit
  grantEmergency(found.id, { by, owner: true });
  try {
    withStore((s) => {
      const b = findBuild(s, found.id);
      const why = refusal(b);
      if (why) throw new EmergencyRefused(why, 2);
      if (P2.isEmergency(b)) { out = { ok: true, id: b.id, emergency: b.emergency, already: true }; return s; }
      b.emergency = tag;
      b.notes = [...(b.notes ?? []), { text: note, at, by }];
      out = { ok: true, id: b.id, emergency: tag, already: false };
      return s;
    }, { by, action: 'emergency:send', note: found.id });
  } catch (e) { if (!P2.isEmergency(findBuild(loadStore(), found.id))) revokeEmergency(found.id, { by: 'emergency-send' }); throw e; }
  return out;
}

try {
  const id = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { throw new EmergencyRefused('the request is not JSON', 2); }
  console.log(JSON.stringify(send(id, input && typeof input === 'object' ? input : {})));
} catch (e) {
  process.exitCode = e instanceof EmergencyRefused ? e.code : e?.code === 2 || e?.code === 3 ? e.code : 1;
  console.log(JSON.stringify({ ok: false, error: e.message }));
}
