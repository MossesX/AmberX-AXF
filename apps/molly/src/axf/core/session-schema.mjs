/**
 * session@1 — one stored chat session, whatever it came from: claude.ai text or voice chats (data export or the hub
 * drop folder), Claude Code sessions (~/.claude/projects JSONL), headless build logs. Brett, Nov 1 2026: "store ALL our
 * sessions … export any session as audio with two voices".
 *
 * Pure and dependency-free (no DOM, no Node APIs), so the Chat viewer's page, its tests and any CLI run the same checks.
 * The Chat viewer console plugin mirrors it in Python from framework/schemas/session.json, which `axf schemas` writes
 * from REGISTRY below (framework/spec/check-session.mjs keeps them in step). Fixtures: framework/spec/fixtures/session.json.
 *
 * Two rules both ports must give the same answer for:
 *   - redact(text): the REGISTRY.redact patterns, applied in order, each match → `<pre>[redacted:<id>]<post>`.
 *   - chainHash(messages): h0 = '', h(i) = sha256hex(h(i-1) + '\n' + role + US + kind + US + toolName + US + text)
 *     (US = \u001f). A chain, so a continued session's hash is computed from the old hash and the new messages only.
 */

export const TAG = 'session@1';

export const REGISTRY = {
  $id: 'axf/session',
  tag: TAG,
  sources: ['claude-ai-text', 'claude-ai-voice', 'claude-code', 'headless', 'hub-drop'],
  roles: ['user', 'assistant', 'tool'],
  kinds: ['speech', 'text', 'tool'],
  changes: ['new', 'continued', 'changed'],
  idPattern: '^[a-z][a-z0-9-]{0,15}:[A-Za-z0-9._:-]{1,160}$',
  maxTitle: 300,
  maxText: 200000,
  required: ['$axf', 'id', 'source', 'title', 'startedAt', 'updatedAt', 'project', 'messages', 'hash'],
  optional: ['versions', 'via', 'origin', 'model', 'branch', 'cwd', 'host', 'meta'],
  messageRequired: ['role', 'text', 'at', 'kind'],
  messageOptional: ['toolName', 'id'],
  versionRequired: ['version', 'hash', 'updatedAt', 'messageCount', 'change'],
  /**
   * Secret patterns, applied in this order on every ingest. JS and Python regex syntax both (no lookbehind, no named
   * groups). `pre` / `post` are capture groups kept around the marker (0 = none); `flags` is "" or "i".
   */
  redact: [
    { id: 'private-key', pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----', flags: '', pre: 0, post: 0 },
    { id: 'anthropic-key', pattern: '\\bsk-ant-[A-Za-z0-9_-]{20,}', flags: '', pre: 0, post: 0 },
    { id: 'openai-key', pattern: '\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}', flags: '', pre: 0, post: 0 },
    { id: 'github-token', pattern: '\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\\bgithub_pat_[A-Za-z0-9_]{30,}', flags: '', pre: 0, post: 0 },
    { id: 'aws-key', pattern: '\\bAKIA[0-9A-Z]{16}', flags: '', pre: 0, post: 0 },
    { id: 'slack-token', pattern: '\\bxox[abposr]-[A-Za-z0-9-]{10,}', flags: '', pre: 0, post: 0 },
    { id: 'google-key', pattern: '\\bAIza[0-9A-Za-z_-]{35}', flags: '', pre: 0, post: 0 },
    { id: 'jwt', pattern: '\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}', flags: '', pre: 0, post: 0 },
    { id: 'bearer', pattern: '(Bearer\\s+)(?!\\[redacted)[A-Za-z0-9._~+/=-]{16,}', flags: 'i', pre: 1, post: 0 },
    { id: 'url-credentials', pattern: '(://[^/\\s:@]{1,64}:)[^@\\s/]{3,}(@)', flags: '', pre: 1, post: 2 },
    { id: 'secret-value', pattern: '((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["\']?\\s*[:=]\\s*["\']?)(?![\\[$<{(])[^\\s"\'&,;]{6,}', flags: 'i', pre: 1, post: 0 },
  ],
};

const ID_RE = new RegExp(REGISTRY.idPattern);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim());

export const isId = (v) => typeof v === 'string' && ID_RE.test(v);
export const isTimestamp = (v) => typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));

const err = (field, code, message) => ({ field, code, message });

/** One message check; `at` may be '' (unknown time) but must be a timestamp when set. */
export function validateMessage(m, i = 0) {
  const p = `messages[${i}]`;
  if (!isObj(m)) return [err(p, 'invalid', `${p} must be an object`)];
  const out = [];
  if (!REGISTRY.roles.includes(m.role)) out.push(err(`${p}.role`, blank(m.role) ? 'missing' : 'invalid', `${p}.role must be one of ${REGISTRY.roles.join(', ')}`));
  if (typeof m.text !== 'string') out.push(err(`${p}.text`, 'missing', `${p}.text must be a string`));
  else if (m.text.length > REGISTRY.maxText) out.push(err(`${p}.text`, 'invalid', `${p}.text is longer than ${REGISTRY.maxText}`));
  if (typeof m.at !== 'string') out.push(err(`${p}.at`, 'missing', `${p}.at must be an ISO timestamp or ""`));
  else if (m.at && !isTimestamp(m.at)) out.push(err(`${p}.at`, 'invalid', `${p}.at "${m.at}" is not an ISO timestamp`));
  if (!REGISTRY.kinds.includes(m.kind)) out.push(err(`${p}.kind`, blank(m.kind) ? 'missing' : 'invalid', `${p}.kind must be one of ${REGISTRY.kinds.join(', ')}`));
  if (m.toolName !== undefined && typeof m.toolName !== 'string') out.push(err(`${p}.toolName`, 'invalid', `${p}.toolName must be a string`));
  if (m.kind === 'tool' && m.role === 'user') out.push(err(`${p}.kind`, 'invalid', `${p} is a tool message from the user (use role tool)`));
  return out;
}

/** Full session check. Returns { ok, errors: [{ field, code: missing|invalid, message }] }. */
export function validateSession(s) {
  if (!isObj(s)) return { ok: false, errors: [err('session', 'invalid', 'the session must be a JSON object')] };
  const errors = [];
  if (s.$axf !== TAG) errors.push(err('$axf', s.$axf === undefined ? 'missing' : 'invalid', `$axf must be "${TAG}"`));
  if (blank(s.id)) errors.push(err('id', 'missing', 'id is missing — "<prefix>:<origin id>", e.g. cai:<uuid>, cc:<session id>'));
  else if (!isId(s.id)) errors.push(err('id', 'invalid', `id "${s.id}" must look like "cai:<uuid>"`));
  if (blank(s.source)) errors.push(err('source', 'missing', `source is missing — one of ${REGISTRY.sources.join(', ')}`));
  else if (!REGISTRY.sources.includes(s.source)) errors.push(err('source', 'invalid', `source "${s.source}" is not one of ${REGISTRY.sources.join(', ')}`));
  if (typeof s.title !== 'string' || !s.title.trim()) errors.push(err('title', 'missing', 'title is missing'));
  else if (s.title.length > REGISTRY.maxTitle) errors.push(err('title', 'invalid', `title is longer than ${REGISTRY.maxTitle}`));
  for (const f of ['startedAt', 'updatedAt']) {
    if (blank(s[f])) errors.push(err(f, 'missing', `${f} is missing — an ISO timestamp`));
    else if (!isTimestamp(s[f])) errors.push(err(f, 'invalid', `${f} "${s[f]}" is not an ISO timestamp`));
  }
  if (typeof s.project !== 'string') errors.push(err('project', 'missing', 'project is missing (a name or "")'));
  if (!Array.isArray(s.messages)) errors.push(err('messages', 'missing', 'messages must be a list'));
  else s.messages.forEach((m, i) => errors.push(...validateMessage(m, i)));
  if (blank(s.hash)) errors.push(err('hash', 'missing', 'hash is missing — chainHash(messages)'));
  else if (!/^[0-9a-f]{64}$/.test(s.hash) && !(s.hash === '' && Array.isArray(s.messages) && !s.messages.length)) errors.push(err('hash', 'invalid', 'hash must be 64 hex characters'));
  if (s.versions !== undefined) {
    if (!Array.isArray(s.versions)) errors.push(err('versions', 'invalid', 'versions must be a list'));
    else s.versions.forEach((v, i) => {
      if (!isObj(v)) { errors.push(err(`versions[${i}]`, 'invalid', 'must be an object')); return; }
      if (!Number.isInteger(v.version) || v.version < 1) errors.push(err(`versions[${i}].version`, 'invalid', 'a whole number from 1'));
      if (!REGISTRY.changes.includes(v.change)) errors.push(err(`versions[${i}].change`, 'invalid', `one of ${REGISTRY.changes.join(', ')}`));
      if (!Number.isInteger(v.messageCount) || v.messageCount < 0) errors.push(err(`versions[${i}].messageCount`, 'invalid', 'a whole number'));
    });
  }
  return { ok: !errors.length, errors };
}

/** One line naming every problem, for refusals. */
export const rejection = (errors) => errors.map((e) => e.message).join('; ');

/* ------------------------------------------------------------------ */
/* Redaction                                                            */
/* ------------------------------------------------------------------ */

const RULES = REGISTRY.redact.map((r) => ({ ...r, re: new RegExp(r.pattern, `g${r.flags}`) }));

/** Replace every secret-looking value with `[redacted:<id>]`. Idempotent: a redacted text stays the same. */
export function redact(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const r of RULES) {
    out = out.replace(r.re, (...m) => `${r.pre ? m[r.pre] ?? '' : ''}[redacted:${r.id}]${r.post ? m[r.post] ?? '' : ''}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Chain hash (sha256, pure JS)                                         */
/* ------------------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** sha256 of a string's UTF-8 bytes, as lowercase hex. */
export function sha256hex(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const total = ((len + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(total - 4, bits >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}

const US = '\u001f';

/** Extend a chain hash with more messages (prev = '' for a new session). */
export function chainHash(messages, prev = '') {
  let h = prev;
  for (const m of messages ?? []) h = sha256hex(`${h}\n${m.role}${US}${m.kind}${US}${m.toolName ?? ''}${US}${m.text}`);
  return h;
}

/* ------------------------------------------------------------------ */
/* JSON Schema (written by `axf schemas`)                               */
/* ------------------------------------------------------------------ */

export function jsonSchemas() {
  const R = REGISTRY;
  const ts = { type: 'string', format: 'date-time', pattern: ISO_RE.source };
  const message = {
    type: 'object', required: R.messageRequired,
    properties: {
      role: { enum: R.roles }, text: { type: 'string', maxLength: R.maxText }, at: { anyOf: [ts, { const: '' }] },
      kind: { enum: R.kinds }, toolName: { type: 'string' }, id: { type: 'string' },
    },
  };
  const version = {
    type: 'object', required: R.versionRequired,
    properties: { version: { type: 'integer', minimum: 1 }, hash: { type: 'string' }, updatedAt: ts, messageCount: { type: 'integer', minimum: 0 }, change: { enum: R.changes } },
  };
  return {
    'session.schema.json': {
      $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'axf/session.schema.json', title: `AmberX AXF stored chat session (${TAG})`,
      description: 'Generated from framework/core/session-schema.mjs. One chat session (claude.ai, Claude Code, headless build, hub drop).',
      type: 'object', required: R.required,
      properties: {
        $axf: { const: TAG }, id: { type: 'string', pattern: R.idPattern }, source: { enum: R.sources },
        title: { type: 'string', minLength: 1, maxLength: R.maxTitle }, startedAt: ts, updatedAt: ts, project: { type: 'string' },
        messages: { type: 'array', items: message }, hash: { type: 'string' }, versions: { type: 'array', items: version },
        via: { type: 'string' }, origin: { type: 'string' }, model: { type: 'string' }, branch: { type: 'string' }, cwd: { type: 'string' },
        host: { type: 'string' }, meta: { type: 'object' },
      },
    },
  };
}
