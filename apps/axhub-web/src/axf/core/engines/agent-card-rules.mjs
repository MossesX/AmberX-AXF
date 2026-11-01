/**
 * agent-card rules — agent-card@1 (Brett, Oct 31 2026: "ID cards are assets"). An agent's ID card is an asset in the
 * asset@1 envelope, loadable by every AXF app and hot-swappable like the rest (`runtime.swap('agent-card', id)`). The
 * asset decides only the design: which design family, orientation, where the brand logo sits, which theme roles colour
 * it, the finish, the photo size, the code strip and the fields on each side. Colours and sizes always come from the
 * active colour and style themes (the renderer reads tokens only), so swapping the theme rebrands every card.
 *
 * ONE registry (CARD_ENUMS, CARD_FIELDS, CARD_DEFAULTS) drives both validators (core/validate.ts and the build engine),
 * the normalizer and the card model the renderers draw from. Pure, no DOM. Every field has a default, unknown fields
 * are dropped (open registry: later designs add enum words and fields here, never a new type).
 *
 * The card model is what any port draws: { design, orientation, logo, surface, accent, finish, photo, front[], back[],
 * code } where each side is a list of { id, label, value } in the asset's order. Values are formatted here so every
 * port shows the same text.
 */

export const AGENT_CARD_TYPE = 'agent-card';

export const CARD_ENUMS = {
  design: ['badge', 'license', 'trading', 'backstage'],
  orientation: ['vertical', 'horizontal'],
  logo: ['banner', 'watermark', 'corner', 'none'],
  surface: ['surface', 'raised', 'inverse', 'accent'],
  accent: ['accent', 'brand-1', 'brand-2', 'brand-3', 'info', 'success', 'warning', 'danger'],
  finish: ['flat', 'foil', 'hologram', 'neon'],
  photo: ['large', 'small', 'none'],
  code: ['barcode', 'qr', 'none'],
};

/** Identity and stat fields a card side may show, with their default labels. */
export const CARD_FIELDS = {
  name: 'Name',
  role: 'Role',
  specialty: 'Specialty',
  employeeId: 'Employee ID',
  email: 'Email',
  hiredAt: 'Hired',
  status: 'Status',
  catchphrase: 'Catchphrase',
  signature: 'Signature',
  jobs: 'Jobs',
  successRate: 'Success rate',
  spend: 'Spend',
  favoriteModel: 'Favorite model',
};

export const CARD_MAX_FIELDS = 12;
export const CARD_LABEL_MAX = 24;

export const CARD_DEFAULTS = {
  design: 'badge', orientation: 'vertical', logo: 'banner', surface: 'surface', accent: 'accent', finish: 'flat', photo: 'large', code: 'barcode',
  front: ['name', 'role', 'specialty', 'employeeId'],
  back: [],
  labels: {},
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validation messages for an agent-card asset's data (empty for other types). Same messages in both validators. */
export function agentCardErrors(type, raw) {
  if (type !== AGENT_CARD_TYPE) return [];
  if (!isObj(raw)) return ['data must be an object'];
  const errors = [];
  for (const [k, allowed] of Object.entries(CARD_ENUMS)) {
    if (k in raw && !allowed.includes(raw[k])) errors.push(`data.${k} must be one of: ${allowed.join(', ')}`);
  }
  for (const side of ['front', 'back']) {
    if (!(side in raw)) continue;
    const v = raw[side];
    if (!Array.isArray(v)) { errors.push(`data.${side} must be a list of card fields`); continue; }
    if (v.length > CARD_MAX_FIELDS) errors.push(`data.${side} has more than ${CARD_MAX_FIELDS} fields`);
    v.forEach((f, i) => { if (!Object.hasOwn(CARD_FIELDS, f)) errors.push(`data.${side}[${i}] is not a card field (one of: ${Object.keys(CARD_FIELDS).join(', ')})`); });
  }
  if ('labels' in raw) {
    if (!isObj(raw.labels)) errors.push('data.labels must map card fields to labels');
    else for (const [k, v] of Object.entries(raw.labels)) {
      if (!Object.hasOwn(CARD_FIELDS, k)) errors.push(`data.labels.${k} is not a card field`);
      else if (typeof v !== 'string' || !v.trim() || v.length > CARD_LABEL_MAX) errors.push(`data.labels.${k} must be text up to ${CARD_LABEL_MAX} characters`);
    }
  }
  return errors;
}

/** Fill defaults, drop unknown fields and bad values (never throws). */
export function normalizeCard(raw) {
  const o = isObj(raw) ? raw : {};
  const out = {};
  for (const [k, allowed] of Object.entries(CARD_ENUMS)) out[k] = allowed.includes(o[k]) ? o[k] : CARD_DEFAULTS[k];
  for (const side of ['front', 'back']) {
    const v = Array.isArray(o[side]) ? o[side].filter((f) => Object.hasOwn(CARD_FIELDS, f)) : CARD_DEFAULTS[side];
    out[side] = [...new Set(v)].slice(0, CARD_MAX_FIELDS);
  }
  out.labels = {};
  if (isObj(o.labels)) for (const [k, v] of Object.entries(o.labels)) if (Object.hasOwn(CARD_FIELDS, k) && typeof v === 'string' && v.trim()) out.labels[k] = v.trim().slice(0, CARD_LABEL_MAX);
  return out;
}

/** A stable employee number from an agent id: AX-0000 … AX-9999. */
export function employeeId(agentId) {
  let h = 2166136261;
  for (const ch of String(agentId)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `AX-${String(h % 10000).padStart(4, '0')}`;
}

/** The internal address shown on a card (an identity inside the system only: no real mailbox). */
export const internalEmail = (agentId) => `${String(agentId).toLowerCase().replace(/[^a-z0-9-]+/g, '-')}@agents.axf`;

/**
 * Bar widths for the card's barcode strip (decorative, drawn from the text so each card looks its own): alternating
 * bar / gap widths 1–3, starting and ending with a bar. Same list on every port.
 */
export function barcodeBars(text) {
  const s = String(text || '');
  const bars = [2, 1, 1, 1];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    bars.push((c % 3) + 1, ((c >> 2) % 2) + 1, ((c >> 3) % 3) + 1, 1);
  }
  bars.push(2, 1, 1);
  return bars;
}

const fmtDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');
const fmtUsd = (v) => { const n = Number(v) || 0; return `$${n < 10 ? n.toFixed(2) : Math.round(n)}`; };

/** The text a field shows for an agent (identity + stats), '—' when unknown. */
export function cardValue(field, identity = {}, stats = {}) {
  const id = isObj(identity) ? identity : {}; const st = isObj(stats) ? stats : {};
  switch (field) {
    case 'employeeId': return String(id.employeeId || (id.id ? employeeId(id.id) : '')) || '—';
    case 'email': return String(id.email || (id.id ? internalEmail(id.id) : '')) || '—';
    case 'hiredAt': return fmtDay(id.hiredAt) || '—';
    case 'jobs': return Number.isFinite(Number(st.jobs)) ? String(Math.round(Number(st.jobs))) : '—';
    case 'successRate': return Number.isFinite(Number(st.successRate)) ? `${Math.round(Number(st.successRate))}%` : '—';
    case 'spend': return Number.isFinite(Number(st.spend)) ? fmtUsd(st.spend) : '—';
    case 'favoriteModel': return typeof st.favoriteModel === 'string' && st.favoriteModel ? st.favoriteModel : '—';
    default: { const v = id[field]; return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : '—'; }
  }
}

/** What a renderer draws for one agent on one card design. */
export function cardModel(raw, identity = {}, stats = {}) {
  const d = normalizeCard(raw);
  const side = (list) => list.map((f) => ({ id: f, label: d.labels[f] ?? CARD_FIELDS[f], value: cardValue(f, identity, stats) }));
  const codeValue = d.code === 'none' ? '' : d.code === 'qr' ? String(identity?.page || '') : cardValue('employeeId', identity, stats);
  return {
    design: d.design, orientation: d.orientation, logo: d.logo, surface: d.surface, accent: d.accent, finish: d.finish, photo: d.photo,
    front: side(d.front), back: side(d.back),
    code: { kind: d.code, value: codeValue, bars: d.code === 'barcode' ? barcodeBars(codeValue) : [] },
  };
}

/** A sample agent for previews, the designer and the fixture (identity + stats). */
export const AGENT_CARD_SAMPLE = {
  identity: { id: 'kat', name: 'Kotlin Kat', role: 'Android engineer', specialty: 'Kotlin kernel twins and Jetpack Compose screens', hiredAt: '2026-10-31', status: 'On duty', catchphrase: "Gradle's cookin', grab me a cold one.", signature: 'K. Kat', page: 'axf://agent-swarm/kat' },
  stats: { jobs: 42, successRate: 93.4, spend: 12.5, favoriteModel: 'Sonnet' },
};

/** JSON-schema `properties` for the generated agent-card.schema.json (the build engine's schema writer). */
export function agentCardSchemaProperties() {
  const props = {};
  for (const [k, allowed] of Object.entries(CARD_ENUMS)) props[k] = { enum: allowed, default: CARD_DEFAULTS[k] };
  for (const side of ['front', 'back']) props[side] = { type: 'array', maxItems: CARD_MAX_FIELDS, items: { enum: Object.keys(CARD_FIELDS) }, default: CARD_DEFAULTS[side] };
  props.labels = { type: 'object', propertyNames: { enum: Object.keys(CARD_FIELDS) }, additionalProperties: { type: 'string', maxLength: CARD_LABEL_MAX } };
  return props;
}
