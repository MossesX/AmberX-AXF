/**
 * Veto passes (control-pass@1, framework/core/engines/control-pass.mjs; builds theme-veto-pass, pass-all): the store, the owner
 * approval, the change log every covered write adds to, undo, the signed publication axHub reads, and the log lines.
 *
 * Store: `passes.json` in the plugin's data folder (one file every transport on this machine shares, like the salt).
 * Owner approval: the transport says how it reached Brett (`approver`: his signed-in console session, a local console
 * with no token, a typed confirmation at a terminal) or carries axHub's signed approval (`proof`, verified here with
 * the shared secret). A command body can never say it was approved.
 * Secret: AXF_PASS_SECRET, else AXF_WALL_SECRET (the console's copy of the hub's wall secret, already on both sides).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PASS_APPROVED_VIA, PASS_FRAME, PASS_MAX_MINUTES, PASS_REQUEST_TTL_MS, PASS_SCOPES, PASS_SCOPE_IDS, passActive, passCommandChange, passCovering,
  passCoveringCall, passMinutes, passNotUndoable, passPending, passPublic, passPublication, passScopeOf, passSentence, passStateAt, passUndoPlan, passWithChange,
} from '../../../../../framework/core/engines/control-pass.mjs';
import { controlIrreversible } from '../../../../../framework/core/engines/control-rules.mjs';
import { ControlError, DATA_DIR, ROOT, audit } from './common.mjs';

const FILE = () => join(DATA_DIR, 'passes.json');
const SETTINGS = () => join(DATA_DIR, 'pass-settings.json');
/** Ended passes kept in the store (newest first) so undo and the log still find them. */
const KEEP_ENDED = 40;
/** How long an axHub approval signature is good for. */
const PROOF_TTL_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ settings + store */

/** { maxMinutes, timeZone }: the console's setting (Settings → Plugins → Token control), else env, else defaults. */
export function passSettings() {
  let s = {};
  try { s = JSON.parse(readFileSync(SETTINGS(), 'utf8')) ?? {}; } catch { /* defaults */ }
  const max = Number(s.maxMinutes ?? process.env.AXF_PASS_MAX_MINUTES ?? PASS_MAX_MINUTES);
  return { maxMinutes: Math.max(1, Math.min(PASS_MAX_MINUTES, Math.floor(max) || PASS_MAX_MINUTES)), timeZone: typeof s.timeZone === 'string' && s.timeZone ? s.timeZone : process.env.AXF_TIMEZONE || 'America/New_York' };
}
export function savePassSettings(patch) {
  const next = { ...passSettings(), ...(patch && typeof patch === 'object' ? patch : {}) };
  next.maxMinutes = Math.max(1, Math.min(PASS_MAX_MINUTES, Math.floor(Number(next.maxMinutes)) || PASS_MAX_MINUTES));
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function readStore() {
  try { const d = JSON.parse(readFileSync(FILE(), 'utf8')); if (d && d.$axf === PASS_FRAME && Array.isArray(d.passes)) return d; } catch { /* first run */ }
  return { $axf: PASS_FRAME, passes: [] };
}
function writeStore(d) {
  const ended = d.passes.filter((p) => p.state !== 'active' && p.state !== 'pending');
  const live = d.passes.filter((p) => p.state === 'active' || p.state === 'pending');
  const out = { $axf: PASS_FRAME, updatedAt: new Date().toISOString(), passes: [...live, ...ended.slice(0, KEEP_ENDED)] };
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE()}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 1)}\n`, { mode: 0o600 });
  renameSync(tmp, FILE());
  return out;
}

/** The store with every state brought up to `now` (an active pass past its end becomes expired, an old request lapsed), logged once. */
export function loadPasses(now = Date.now()) {
  const d = readStore();
  let moved = false;
  for (const p of d.passes) {
    const st = passStateAt(p, now);
    if (st !== p.state) {
      p.state = st;
      p.endedAt = new Date(st === 'expired' ? Date.parse(p.expiresAt) : Date.parse(p.requestedAt) + PASS_REQUEST_TTL_MS).toISOString();
      p.endedBy = 'clock';
      moved = true;
      logLine(p, st === 'expired' ? `ended at ${p.endedAt.slice(11, 16)} UTC with ${p.changes?.length ?? 0} change(s)` : 'request lapsed (not approved)');
    }
  }
  return moved ? writeStore(d) : d;
}

/* ------------------------------------------------------------------ log lines (audit) */

/** One audit row per pass moment (grant, request, approve, deny, revoke, lapse, end); the audit is the only log (Nov 4 2026). */
export function logLine(p, text, extra = {}) {
  const line = `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · pass \`${p.id}\` (${p.scope}) · ${text}`;
  audit({ by: extra.by || p.approvedBy || p.requestedBy || 'unknown', op: 'pass', target: 'pass.scopes', path: p.scope, action: extra.action ?? 'log', pass: p.id, text, ...(extra.change ? { change: extra.change } : {}) });
  return line;
}

/* ------------------------------------------------------------------ signing (axHub reads passes, approves grants) */

export const passSecret = () => process.env.AXF_PASS_SECRET || process.env.AXF_WALL_SECRET || '';
const hmac = (secret, msg) => createHmac('sha256', secret).update(msg).digest('hex');

/** `t=<ms>,v1=<hex>` over `${t}.${payload}` (the header GET /pass answers with, X-AXF-Pass-Signature). */
export function signPayload(payload, now = Date.now(), secret = passSecret()) {
  if (!secret) return '';
  return `t=${now},v1=${hmac(secret, `${now}.${payload}`)}`;
}
function parseSig(h) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(h ?? '').trim());
  return m ? { t: Number(m[1]), v: m[2] } : null;
}
/** Does `header` sign `payload` with the shared secret, made within five minutes of `now`? */
export function verifyPayload(payload, header, now = Date.now(), secret = passSecret()) {
  const s = parseSig(header);
  if (!secret || !s || Math.abs(now - s.t) > PROOF_TTL_MS) return false;
  const want = Buffer.from(hmac(secret, `${s.t}.${payload}`), 'hex');
  const got = Buffer.from(s.v, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}
/**
 * The message axHub signs when Brett approves a grant: `approve.<request id>.<scope>.<minutes>.<approver>`, with
 * `.irreversible` on the end when the request includes irreversible commands (so an approval can't be replayed wider).
 */
export const approvalMessage = (requestId, scope, minutes, approver, includeIrreversible = false) => `approve.${requestId}.${scope}.${minutes}.${approver}${includeIrreversible ? '.irreversible' : ''}`;

/** The owner approval a transport hands in → { via, name } or null. axHub's proof is checked against the request. */
function ownerOf(approver, proof, req, now) {
  if (approver && PASS_APPROVED_VIA.includes(approver.via) && approver.via !== 'axhub') return { via: approver.via, name: String(approver.name || 'brett').slice(0, 80) };
  if (proof && req) {
    const name = String(proof.approver || '').slice(0, 80);
    if (name && verifyPayload(approvalMessage(req.id, req.scope, req.minutes, name, req.includeIrreversible === true), proof.signature, now)) return { via: 'axhub', name };
  }
  return null;
}

/* ------------------------------------------------------------------ the pass.scopes target */

/** "No theme pass is on." / "No pass is on." (the all scope needs no word). */
const passNoun = (id) => (id === 'all' ? '' : `${PASS_SCOPES[id].plain.toLowerCase()} `);
const newId = () => `pass-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const latest = (d, scope, states) => d.passes.find((p) => p.scope === scope && states.includes(p.state));

function activate(d, req, owner, now) {
  const prev = latest(d, req.scope, ['active']);
  req.state = 'active';
  req.approvedBy = owner.name;
  req.approvedVia = owner.via;
  req.grantedAt = new Date(now).toISOString();
  req.expiresAt = new Date(now + req.minutes * 60000).toISOString();
  if (prev && prev !== req) {
    // one pass per scope: the new one replaces it and carries its change log, so undo still reaches the first change
    req.changes = [...(prev.changes ?? []), ...(req.changes ?? [])];
    req.extends = prev.id;
    prev.state = 'revoked'; prev.endedAt = req.grantedAt; prev.endedBy = `replaced by ${req.id}`;
  }
  return req;
}

/**
 * Run one pass.scopes command (already through the gate). `approver` / `proof` come from the transport only.
 * list → every scope with its pass now · get <scope> → that scope's pass · act grant | approve | deny | revoke | undo.
 */
export function runPass(c, { approver = null, proof = null, now = Date.now(), runTokens } = {}) {
  const { maxMinutes, timeZone } = passSettings();
  const d = loadPasses(now);
  const view = (p) => (p ? passPublic(p, now, timeZone) : null);
  const scopeRow = (id) => {
    const active = latest(d, id, ['active']);
    const pending = d.passes.find((p) => p.scope === id && passPending(p, now));
    return { id, label: PASS_SCOPES[id].label, targets: PASS_SCOPES[id].targets, active: view(active), pending: view(pending), text: active ? passSentence(active, now, timeZone) : pending ? passSentence(pending, now, timeZone) : `${PASS_SCOPES[id].what} go${id === 'all' ? 'es' : ''} through the veto.` };
  };
  if (c.op === 'list') {
    const items = PASS_SCOPE_IDS.map(scopeRow);
    const on = items.filter((x) => x.active);
    return { items, total: items.length, maxMinutes, recent: d.passes.slice(0, 20).map(view), text: on.length ? on.map((x) => x.text).join(' ') : 'No veto pass is on: every command goes through the veto.' };
  }
  if (c.op === 'get') { const row = scopeRow(c.path); return { item: row, value: row.active ? 'active' : row.pending ? 'pending' : 'off', text: row.text }; }

  const input = c.input && typeof c.input === 'object' ? c.input : {};
  const by = c.by || 'unknown';
  switch (c.action) {
    case 'grant': {
      const minutes = passMinutes(input.minutes, maxMinutes);
      // a waiting request for the same scope is replaced (one request per scope)
      for (const p of d.passes) if (p.scope === c.path && passPending(p, now)) { p.state = 'lapsed'; p.endedAt = new Date(now).toISOString(); p.endedBy = 'replaced'; }
      const irr = c.path === 'all' && input.include_irreversible === true;
      const req = { id: newId(), scope: c.path, state: 'pending', minutes, reason: String(input.reason ?? c.reason ?? '').slice(0, 300), ...(irr ? { includeIrreversible: true } : {}), requestedBy: by, requestedAt: new Date(now).toISOString(), changes: [] };
      d.passes.unshift(req);
      const owner = ownerOf(approver, proof, req, now);
      if (owner) {
        activate(d, req, owner, now);
        writeStore(d);
        logLine(req, `granted ${minutes} min${irr ? ' (irreversible included)' : ''} by ${owner.name} (${owner.via})${req.extends ? `, replacing ${req.extends}` : ''}${req.reason ? ` — ${req.reason}` : ''}`, { by: owner.name, action: 'grant' });
        return { changed: true, item: view(req), text: passSentence(req, now, timeZone) };
      }
      writeStore(d);
      logLine(req, `requested ${minutes} min${irr ? ' (irreversible included)' : ''} by ${by}, waiting for Brett${req.reason ? ` — ${req.reason}` : ''}`, { by, action: 'request' });
      return {
        changed: true, item: view(req), text: passSentence(req, now, timeZone),
        approval: { required: true, request: req.id, expiresAt: new Date(now + PASS_REQUEST_TTL_MS).toISOString(), how: ['Brett taps Approve on the console banner (Token pass) or on Token control → Passes', 'or approves the held call in axHub (it signs the approval: framework/spec/CONTROL.md → Veto passes)'] },
      };
    }
    case 'approve': case 'deny': {
      const req = d.passes.find((p) => p.id === input.request && p.scope === c.path);
      if (!req || !passPending(req, now)) throw new ControlError('not_found', `no waiting pass request ${String(input.request)} for ${c.path}`);
      const owner = ownerOf(approver, proof, req, now);
      if (!owner) throw new ControlError('denied', `only Brett can ${c.action} a veto pass: from his console session (banner → Token pass) or with axHub's signed approval`);
      if (c.action === 'deny') {
        req.state = 'denied'; req.endedAt = new Date(now).toISOString(); req.endedBy = owner.name;
        writeStore(d);
        logLine(req, `denied by ${owner.name}`, { by: owner.name, action: 'deny' });
        return { changed: true, item: view(req), text: passSentence(req, now, timeZone) };
      }
      activate(d, req, owner, now);
      writeStore(d);
      logLine(req, `approved ${req.minutes} min by ${owner.name} (${owner.via}), requested by ${req.requestedBy}${req.reason ? ` — ${req.reason}` : ''}`, { by: owner.name, action: 'approve' });
      return { changed: true, item: view(req), text: passSentence(req, now, timeZone) };
    }
    case 'revoke': {
      const p = latest(d, c.path, ['active']);
      const pend = d.passes.filter((x) => x.scope === c.path && passPending(x, now));
      if (!p && !pend.length) return { changed: false, item: null, text: `No ${passNoun(c.path)}pass is on.` };
      const at = new Date(now).toISOString();
      for (const x of [p, ...pend].filter(Boolean)) { x.state = x.state === 'pending' ? 'denied' : 'revoked'; x.endedAt = at; x.endedBy = by; }
      writeStore(d);
      if (p) logLine(p, `revoked by ${by} with ${p.changes?.length ?? 0} change(s)`, { by, action: 'revoke' });
      for (const x of pend) logLine(x, `request withdrawn by ${by}`, { by, action: 'revoke' });
      return { changed: true, item: view(p ?? pend[0]), text: p ? `${PASS_SCOPES[c.path].label} pass revoked: ${c.path === 'all' ? 'commands' : 'changes'} need the veto again.` : 'The waiting request was withdrawn.' };
    }
    case 'undo': {
      const p = d.passes.find((x) => x.scope === c.path && (x.changes?.length ?? 0) > 0 && !x.undoneAt);
      if (!p) return { changed: false, item: null, restored: [], notUndoable: [], text: `Nothing to undo: no ${passNoun(c.path)}pass has changes left.` };
      const plan = passUndoPlan(p);
      const manual = passNotUndoable(p);
      const done = []; const failed = [];
      for (const step of plan) {
        try { runTokens({ ...step, by: `pass-undo:${by}` }); done.push(step); } catch (e) { failed.push({ ...step, error: e?.message ?? String(e) }); }
      }
      p.undoneAt = new Date(now).toISOString(); p.undoneBy = by; p.undoneChanges = p.changes.length; p.notUndone = manual; p.changes = [];
      writeStore(d);
      logLine(p, `undo by ${by}: ${done.length} token(s) put back${failed.length ? `, ${failed.length} failed` : ''}${manual.length ? `, ${manual.length} command(s) can't be rolled back: ${manual.map((m) => m.what).join('; ').slice(0, 400)}` : ''}`, { by, action: 'undo' });
      const tail = manual.length ? ` ${manual.length} command(s) can't be rolled back automatically: ${manual.map((m) => m.what).join('; ')}.` : '';
      return {
        changed: done.length > 0, item: view(p), restored: done, notUndoable: manual, ...(failed.length ? { failed } : {}),
        text: `Rolled back ${done.length} token(s) changed under the ${PASS_SCOPES[c.path].label.toLowerCase()} pass${failed.length ? ` (${failed.length} could not be put back)` : ''}.${tail}${passActive(p, now) ? ' The pass is still on.' : ''}`,
      };
    }
    default: throw new ControlError('invalid', `pass.scopes has no action ${c.action}`);
  }
}

/* ------------------------------------------------------------------ covered writes */

/**
 * The active pass covering a command now, or null (reads and the pass target: always null). Irreversible commands
 * (control@1 marks them per target) are covered only by an `all` pass granted with include_irreversible.
 */
export function coveringPass(command, now = Date.now()) {
  if (!passScopeOf(command)) return null;
  return passCovering(loadPasses(now).passes, command, now, { irreversible: controlIrreversible(command) });
}

/** The active pass covering a call axHub holds (any service and tool; `irreversible` as axHub marks it), or null. */
export function coveringCall(call, now = Date.now()) {
  return passCoveringCall(loadPasses(now).passes, call, now);
}

/** Record a command an `all` pass let through that isn't a token write: logged on the pass, listed by undo. */
export function recordPassCommand(passId, command, what = '', now = Date.now()) {
  const d = readStore();
  const p = d.passes.find((x) => x.id === passId);
  if (!p) return null;
  const ch = passCommandChange(command, now, what);
  Object.assign(p, passWithChange(p, ch));
  writeStore(d);
  logLine(p, `${ch.by}: ${ch.what}`, { by: ch.by, action: 'change', change: { target: ch.target, ...(ch.path ? { path: ch.path } : {}), op: ch.op, undoable: false } });
  return ch;
}

/** Record what a covered write changed: one change per token whose value or override state moved. */
export function recordPassChanges(passId, command, before, after, now = Date.now()) {
  const d = readStore();
  const p = d.passes.find((x) => x.id === passId);
  if (!p) return [];
  const changed = [];
  for (const [id, b] of Object.entries(before)) {
    const a = after[id];
    if (!a || (a.overridden === b.overridden && JSON.stringify(a.value) === JSON.stringify(b.value))) continue;
    changed.push({ at: new Date(now).toISOString(), by: command.by || 'unknown', target: command.target, path: id, op: command.op, before: b, after: a });
  }
  let next = p;
  for (const ch of changed) next = passWithChange(next, ch);
  Object.assign(p, next);
  writeStore(d);
  const show = (v) => (v.overridden ? JSON.stringify(v.value) : `${JSON.stringify(v.value)} (theme)`);
  for (const ch of changed) logLine(p, `${ch.by}: ${ch.target} ${ch.path} ${show(ch.before)} → ${show(ch.after)}`, { by: ch.by, action: 'change', change: { target: ch.target, path: ch.path, before: ch.before, after: ch.after } });
  return changed;
}

/** The publication axHub reads (GET /pass): the passes now + the scope table, signed when a secret is set. */
export function publication(now = Date.now()) {
  const { timeZone } = passSettings();
  const body = passPublication(loadPasses(now).passes, now, timeZone);
  const payload = JSON.stringify(body);
  return { body, payload, signature: signPayload(payload, now) };
}
