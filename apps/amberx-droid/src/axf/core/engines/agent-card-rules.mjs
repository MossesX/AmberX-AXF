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

import { AVATAR_FACES, AVATAR_GEAR, AVATAR_TOKENS } from './swarm-rules.mjs';

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

/* ------------------------------------------------------------------ */
/* Avatar: the drawn face every port renders from one part list        */
/* ------------------------------------------------------------------ */

/**
 * The avatar is data, not component code: an agent's `avatar` (face, hair 0–5, gear, hue 0–359, from agent@1) turns
 * into a list of parts in a 64×64 box, each a plain shape with a paint. Paints are theme roles only (`bg`, `skin`,
 * `ink`, `line`) or a theme token (`--fx-brand-1`…, from the agent's hue), so every avatar follows the theme and a
 * Kotlin port draws the same picture from the same list. The geometry lives here so no port draws its own.
 */
export const AVATAR_BOX = 64;
/** Hair shapes by the agent's `hair` index (SVG path data in the 64×64 box). */
export const AVATAR_HAIR = [
  'M14 22 Q32 4 50 22 L50 18 Q32 0 14 18 Z',
  'M12 26 Q14 8 32 8 Q50 8 52 26 Q44 14 32 14 Q20 14 12 26 Z',
  'M14 24 Q16 6 32 6 Q48 6 50 24 L46 16 L40 22 L34 14 L28 22 L22 14 L18 22 Z',
  'M10 34 Q8 6 32 6 Q56 6 54 34 Q50 16 32 14 Q14 16 10 34 Z',
  'M20 12 Q32 -2 44 12 Q38 8 32 10 Q26 8 20 12 Z',
  'M12 28 Q12 6 32 6 Q52 6 52 28 L52 40 Q48 20 32 16 Q16 20 12 40 Z',
];
/** Face shapes by `face`. */
export const AVATAR_FACE_SHAPES = {
  round: { tag: 'circle', attrs: { cx: 32, cy: 30, r: 16 } },
  square: { tag: 'rect', attrs: { x: 16, y: 14, width: 32, height: 32, rx: 7 } },
  tall: { tag: 'ellipse', attrs: { cx: 32, cy: 30, rx: 14, ry: 18 } },
};
/** Gear parts by `gear` (`none` draws nothing). `paint: 'shirt'` takes the shirt token so caps and beanies match it. */
export const AVATAR_GEAR_PARTS = {
  none: [],
  glasses: [{ id: 'gear-l', tag: 'circle', attrs: { cx: 26, cy: 30, r: 5 }, paint: 'line' }, { id: 'gear-r', tag: 'circle', attrs: { cx: 38, cy: 30, r: 5 }, paint: 'line' }, { id: 'gear-bridge', tag: 'path', attrs: { d: 'M31 30 L33 30' }, paint: 'line' }],
  shades: [{ id: 'gear', tag: 'path', attrs: { d: 'M19 27 H45 V31 Q45 35 40 35 H36 Q33 35 32 31 Q31 35 28 35 H24 Q19 35 19 31 Z' }, paint: 'ink' }],
  cap: [{ id: 'gear', tag: 'path', attrs: { d: 'M14 20 Q32 2 50 20 L58 22 L14 22 Z' }, paint: 'shirt' }],
  beanie: [{ id: 'gear', tag: 'path', attrs: { d: 'M14 22 Q14 4 32 4 Q50 4 50 22 Z' }, paint: 'shirt' }],
  headphones: [{ id: 'gear-band', tag: 'path', attrs: { d: 'M14 30 Q14 8 32 8 Q50 8 50 30' }, paint: 'line-thick' }, { id: 'gear-l', tag: 'rect', attrs: { x: 10, y: 26, width: 7, height: 11, rx: 3 }, paint: 'ink' }, { id: 'gear-r', tag: 'rect', attrs: { x: 47, y: 26, width: 7, height: 11, rx: 3 }, paint: 'ink' }],
};
/** Paint roles a part may use besides a theme token: what each means for the renderer (axf.css / Axf.colors). */
export const AVATAR_PAINTS = ['bg', 'skin', 'ink', 'line', 'line-thick', 'hair', 'shirt'];

/** Avatar palette: theme colours only; the agent's hue picks its pair (hair, shirt) from the roles. */
export function avatarColors(av) {
  const i = Math.floor((Number(av?.hue) || 0) / 45) % AVATAR_TOKENS.length;
  return { hair: AVATAR_TOKENS[i], shirt: AVATAR_TOKENS[(i + 3 + (Number(av?.hair) || 0)) % AVATAR_TOKENS.length] };
}

/**
 * What a renderer draws for one agent's avatar: { box, face, hair, gear, hue, tokens: { hair, shirt }, parts }. Each
 * part is { id, tag, attrs, paint } with `paint` a role from AVATAR_PAINTS; `hair` and `shirt` resolve to `tokens`.
 * Unknown values fall back like agent@1's normalizer (round face, hair 0, no gear, hue 0).
 */
export function avatarModel(av) {
  const o = isObj(av) ? av : {};
  const face = AVATAR_FACES.includes(o.face) ? o.face : 'round';
  const hair = Number.isFinite(Number(o.hair)) ? Math.min(AVATAR_HAIR.length - 1, Math.max(0, Math.trunc(Number(o.hair)))) : 0;
  const gear = AVATAR_GEAR.includes(o.gear) ? o.gear : 'none';
  const hue = Number.isFinite(Number(o.hue)) ? Math.min(359, Math.max(0, Math.trunc(Number(o.hue)))) : 0;
  const tokens = avatarColors({ hue, hair });
  const parts = [
    { id: 'bg', tag: 'circle', attrs: { cx: 32, cy: 32, r: 32 }, paint: 'bg' },
    { id: 'shirt', tag: 'path', attrs: { d: 'M8 64 Q10 46 32 46 Q54 46 56 64 Z' }, paint: 'shirt' },
    { id: 'face', ...AVATAR_FACE_SHAPES[face], paint: 'skin' },
    { id: 'hair', tag: 'path', attrs: { d: AVATAR_HAIR[hair] }, paint: 'hair' },
    { id: 'eye-l', tag: 'circle', attrs: { cx: 26, cy: 30, r: 2 }, paint: 'ink' },
    { id: 'eye-r', tag: 'circle', attrs: { cx: 38, cy: 30, r: 2 }, paint: 'ink' },
    { id: 'mouth', tag: 'path', attrs: { d: 'M26 38 Q32 42 38 38' }, paint: 'line' },
    ...AVATAR_GEAR_PARTS[gear],
  ];
  return { box: AVATAR_BOX, face, hair, gear, hue, tokens, parts };
}

/** A sample agent for previews, the designer and the fixture (identity + stats + avatar). */
export const AGENT_CARD_SAMPLE = {
  identity: { id: 'kat', name: 'Kotlin Kat', role: 'Android engineer', specialty: 'Kotlin kernel twins and Jetpack Compose screens', hiredAt: '2026-10-31', status: 'On duty', catchphrase: "Gradle's cookin', grab me a cold one.", signature: 'K. Kat', page: 'axf://agent-swarm/kat' },
  stats: { jobs: 42, successRate: 93.4, spend: 12.5, favoriteModel: 'Opus' },
  avatar: { face: 'round', hair: 2, gear: 'headphones', hue: 0 },
};

/** JSON-schema `properties` for the generated agent-card.schema.json (the build engine's schema writer). */
export function agentCardSchemaProperties() {
  const props = {};
  for (const [k, allowed] of Object.entries(CARD_ENUMS)) props[k] = { enum: allowed, default: CARD_DEFAULTS[k] };
  for (const side of ['front', 'back']) props[side] = { type: 'array', maxItems: CARD_MAX_FIELDS, items: { enum: Object.keys(CARD_FIELDS) }, default: CARD_DEFAULTS[side] };
  props.labels = { type: 'object', propertyNames: { enum: Object.keys(CARD_FIELDS) }, additionalProperties: { type: 'string', maxLength: CARD_LABEL_MAX } };
  return props;
}
