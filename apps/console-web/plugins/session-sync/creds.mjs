/**
 * Helper logins (spec/HANDOFF.md § 14): every helper runs on its own Claude subscription, never on the main account.
 *
 * A token from `claude setup-token` arrives once, through the one-time pairing page, and is kept sealed:
 *  - the console container holds only the public key (`<data>/creds/seal.pub`) and can seal but never open;
 *  - the private key lives on the VPS host (`<accounts>/.seal-key`, 0600, outside the console's mounts), so only the launcher
 *    there can open a token, for the one process that needs it;
 *  - `<data>/creds/<id>.sealed` is X25519 + HKDF-SHA256 + AES-256-GCM with the account id bound in as AAD, so a sealed file
 *    can't be moved to another account.
 * The link, the store, the sync file, chat and logs only ever see labels (state, email, plan, last 4). Plaintext tokens are
 * never written anywhere except the launcher's 0600 env file, which its run reads and deletes at once. Errors go through
 * `scrub` so a token can't leave in a message.
 *
 * Pairing codes: 32 random bytes, only their SHA-256 is stored, single use, 10 minutes.
 * The Anthropic calls take AXF_CLAUDE_API_URL (tests point it at a fake). No dependencies, no shell.
 */
import { createCipheriv, createDecipheriv, createHash, createPublicKey, createPrivateKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MODEL_IDS } from '../../../../framework/core/model-policy.mjs';

const env = (k, d = '') => process.env[k] ?? d;
export const TOKEN_RE = /^sk-ant-oat[A-Za-z0-9_-]{20,400}$/;
export const ACCOUNT_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const INFO = 'axf-helper-token-v1';
export const PAIR_TTL_MS = 10 * 60 * 1000;
/** `claude setup-token` tokens last about a year; the API doesn't say, so this is the date the pre-expiry alert counts from. */
export const TOKEN_LIFE_MS = 365 * 86400000;
const PROBE_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

export const accountsDir = () => env('AXF_CLAUDE_ACCOUNTS_DIR', '/root/.claude-accounts');
export const accountId = (account) => String(account ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
export const scrub = (text) => String(text ?? '').replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[redacted token]').replace(/bearer\s+\S+/gi, 'bearer [redacted]').slice(0, 400);
const writeAtomic = (f, data, mode = 0o600) => { mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, data, { mode }); renameSync(tmp, f); chmodSync(f, mode); };
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

export function credsApi(dataDir) {
  const dir = () => env('AXF_SESSION_CREDS_DIR') || join(dataDir(), 'creds');
  const pubFile = () => join(dir(), 'seal.pub');
  const keyFile = () => join(accountsDir(), '.seal-key');
  const sealedFile = (id) => join(dir(), `${id}.sealed`);
  const pairFile = () => join(dir(), 'pairing.json');
  const mustId = (id) => { if (!ACCOUNT_ID_RE.test(id)) throw new Error('bad account id'); return id; };

  /** On the VPS host: make the keypair once. The private half stays in the accounts folder; re-running changes nothing. */
  function initKeys() {
    mkdirSync(accountsDir(), { recursive: true, mode: 0o700 }); chmodSync(accountsDir(), 0o700);
    if (!existsSync(keyFile())) {
      const { publicKey, privateKey } = generateKeyPairSync('x25519');
      writeAtomic(keyFile(), privateKey.export({ type: 'pkcs8', format: 'pem' }));
      writeAtomic(pubFile(), publicKey.export({ type: 'spki', format: 'pem' }), 0o644);
      return { ok: true, created: true };
    }
    if (!existsSync(pubFile())) writeAtomic(pubFile(), createPublicKey(createPrivateKey(readFileSync(keyFile()))).export({ type: 'spki', format: 'pem' }), 0o644);
    return { ok: true, created: false };
  }
  const canSeal = () => existsSync(pubFile());
  const derive = (shared, id) => Buffer.from(hkdfSync('sha256', shared, Buffer.from(id), Buffer.from(INFO), 32));
  function seal(id, token) {
    mustId(id); if (!TOKEN_RE.test(token)) throw new Error('that is not a subscription token from `claude setup-token`');
    if (!canSeal()) throw new Error('the VPS has no sealing key yet: run `session-sync creds-init` on the host');
    const pub = createPublicKey(readFileSync(pubFile())); const eph = generateKeyPairSync('x25519');
    const key = derive(diffieHellman({ privateKey: eph.privateKey, publicKey: pub }), id); const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(id));
    const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
    writeAtomic(sealedFile(id), JSON.stringify({ $axf: 'sealed-token@1', alg: 'x25519-hkdf-sha256-aes-256-gcm', account: id, epk: eph.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }));
    key.fill(0);
  }
  const hasToken = (id) => existsSync(sealedFile(mustId(id)));
  /** Host only (the private key isn't reachable anywhere else). */
  function unseal(id) {
    mustId(id);
    const s = readJson(sealedFile(id), null); if (!s) throw new Error('no sealed token for this account');
    if (!existsSync(keyFile())) throw new Error('the sealing key is not on this machine');
    const epk = createPublicKey({ key: Buffer.from(s.epk, 'base64'), format: 'der', type: 'spki' });
    const key = derive(diffieHellman({ privateKey: createPrivateKey(readFileSync(keyFile())), publicKey: epk }), id);
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64')); d.setAAD(Buffer.from(id)); d.setAuthTag(Buffer.from(s.tag, 'base64'));
    const out = Buffer.concat([d.update(Buffer.from(s.ct, 'base64')), d.final()]).toString('utf8'); key.fill(0);
    return out;
  }
  const drop = (id) => { rmSync(sealedFile(mustId(id)), { force: true }); };

  /* one-time pairing codes */
  const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex');
  const livePairs = (now) => readJson(pairFile(), []).filter((p) => Date.parse(p.expiresAt) > now && !p.used);
  function pairStart({ account, session, agent }) {
    const code = randomBytes(32).toString('base64url'); const now = Date.now();
    const rows = livePairs(now).filter((p) => p.account !== account);
    rows.push({ hash: hashCode(code), account, session, agent, at: new Date(now).toISOString(), expiresAt: new Date(now + PAIR_TTL_MS).toISOString() });
    writeAtomic(pairFile(), JSON.stringify(rows));
    return { code, expiresAt: rows[rows.length - 1].expiresAt };
  }
  /** Who a code belongs to (never consumes it). */
  const pairPeek = (code) => { const h = hashCode(code); const p = livePairs(Date.now()).find((x) => x.hash === h); return p ? { account: p.account, session: p.session, agent: p.agent, expiresAt: p.expiresAt } : null; };
  function pairConsume(code) { const h = hashCode(code); const now = Date.now(); const rows = livePairs(now); const p = rows.find((x) => x.hash === h); if (!p) return null; writeAtomic(pairFile(), JSON.stringify(rows.filter((x) => x !== p))); return p; }

  return { dir, pubFile, keyFile, sealedFile, initKeys, canSeal, seal, hasToken, unseal, drop, pairStart, pairPeek, pairConsume };
}

/* ---------------- the real check: does this token work, whose is it, which models can it run ---------------- */

const api = () => env('AXF_CLAUDE_API_URL', 'https://api.anthropic.com').replace(/\/+$/, '');
const headers = (token) => ({ authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', accept: 'application/json' });
/** `{ state, resetsAt }` from a refused call. */
const limitOf = (r) => { const iso = r.headers.get('anthropic-ratelimit-unified-reset') ?? ''; const n = Number(iso); return n > 0 ? new Date(n * 1000).toISOString() : /^\d{4}-/.test(iso) ? iso : ''; };
export async function probeModel(token, model) {
  const id = MODEL_IDS[model] ?? model;
  let r; try { r = await fetch(`${api()}/v1/messages`, { method: 'POST', redirect: 'error', headers: headers(token), signal: AbortSignal.timeout(30000), body: JSON.stringify({ model: id, max_tokens: 1, system: PROBE_SYSTEM, messages: [{ role: 'user', content: 'ok' }] }) }); } catch { return { result: 'unknown' }; }
  if (r.ok) return { result: 'yes' };
  if (r.status === 401) return { result: 'bad-token' };
  if (r.status === 429) return { result: 'limited', resetsAt: limitOf(r) };
  if (r.status === 403 || r.status === 404) return { result: 'no' };
  return { result: 'unknown' };
}
/** The verify on connect: a tiny call per model and the profile for the email. Answers labels only, never the token. */
export async function verifyToken(token, models = ['opus', 'fable']) {
  const can = {}; let limited = null;
  for (const m of models) {
    const p = await probeModel(token, m);
    if (p.result === 'bad-token') return { ok: false, why: 'that token was refused: make a new one with `claude setup-token`' };
    if (p.result === 'limited') limited = p; if (p.result === 'yes') can[m] = true; if (p.result === 'no') can[m] = false;
  }
  if (!Object.keys(can).length && !limited) return { ok: false, why: "couldn't check that token (Anthropic didn't answer): try again" };
  let email = ''; let plan = '';
  try { const r = await fetch(`${api()}/api/oauth/profile`, { redirect: 'error', headers: headers(token), signal: AbortSignal.timeout(15000) }); if (r.ok) { const j = await r.json(); email = String(j?.account?.email ?? '').slice(0, 200); plan = String(j?.organization?.organization_type ?? '').replace(/^claude_/, '').slice(0, 40); } } catch { /* a setup-token may lack the profile scope: the account is named by its label */ }
  return { ok: true, can, email, plan, limited: limited ? { resetsAt: limited.resetsAt ?? '' } : null };
}
