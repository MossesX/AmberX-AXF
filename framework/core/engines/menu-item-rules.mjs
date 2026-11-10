/**
 * Menu item rules (menu-item@2, build molly-flagship-skin, Brett Nov 10 2026: "Sub menus keep the main menu short …
 * Choices in the app menu change instantly with status listed beside them. Live info next to entries like the little
 * green axHub logo, red if not. Hover explains icons.").
 *
 * The part of the menu-item contract that is pure data rules, shared by the TS app-menu engine (appmenu.ts), the build
 * engine's validator (cli/build-engine.mjs), the control@1 token target `tokens.menu` and the migration CLI, so the
 * four never disagree:
 *
 *   - kinds: what an item is (`action`, `submenu`, `choice`, `separator`, `live-list`), derived from its shape when
 *     the author gives none and checked against it when they do;
 *   - choice settings: `setting` + `choices` (a pick list, the current value beside the label) or `setting` alone (a
 *     switch); the action spec a pick runs (`setting.set:<key>:<value>`) and how the runtime reads it back;
 *   - live status slots: the source grammar (`counter:` | `setting:` | `slot:` | `hidden:` | `source:`), the five
 *     states and the tone / animation each one gets by default (theme tokens only);
 *   - paths and per-item token overrides: every item has a stable path (`app-menu/file/exports/json`,
 *     `context-menu/default/copy`); behaviour and appearance overrides are tokens under that path in one settings
 *     key (`axf.tokens.menu`, control@1 `tokens.menu`), the same shape as the other token sets (control-tokens.mjs)
 *     and the inline-edit build's per-element model (element path → token → value, inherited value kept beside it);
 *   - migration: menu-item@1 definitions (every starter, every app's baked asset) are valid as they are; `migrate`
 *     rewrites one to @2 (explicit kinds, a check mark bound to a setting with nothing to run becomes a switch).
 *
 * Constants mirror schemas/asset-types.json → menuItems (check-app-menu.mts keeps them equal). Pure, no DOM.
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const MENU_ITEMS_VERSION = 2;
export const MENU_KINDS = ['action', 'submenu', 'choice', 'separator', 'live-list'];
export const MENU_STATUS_KINDS = ['counter', 'setting', 'slot', 'hidden', 'source'];
export const MENU_STATUS_STATES = ['on', 'off', 'busy', 'warn', 'unknown'];
/** The tone each state gets unless the item says otherwise (colour-theme tokens: --fx-success, --fx-danger, …). */
export const MENU_STATUS_TONES = { on: 'success', off: 'danger', busy: 'accent', warn: 'warning', unknown: 'muted' };
export const MENU_STATUS_TONE_OPTIONS = ['success', 'danger', 'accent', 'warning', 'info', 'muted'];
export const MENU_STATUS_ANIMS = ['none', 'pulse', 'spin', 'blink'];
/** The animation each state gets unless the item says otherwise (every other state is still). */
export const MENU_STATUS_DEFAULT_ANIMS = { busy: 'pulse' };
/** What a state reads as when the source gives no text of its own. */
export const MENU_STATUS_TEXT = { on: 'On', off: 'Off', busy: 'Working', warn: 'Needs attention', unknown: 'Unknown' };
export const MENU_STATUS_DEFAULT_ICON = 'circle';
export const MENU_CHOICES_MIN = 2;
export const MENU_CHOICES_MAX = 24;
/** Settings key (and control@1 target `tokens.menu`) that holds every per-item override. */
export const MENU_TOKENS_KEY = 'axf.tokens.menu';
export const MENU_TOKENS_TARGET = 'tokens.menu';
/** Action ids a choice setting runs (the runtime registers them; MENUS.md). */
export const MENU_SETTING_SET = 'setting.set';
export const MENU_SETTING_TOGGLE = 'setting.toggle';
/** Path roots: which menu an item path starts with. */
export const MENU_PATH_ROOTS = ['app-menu', 'context-menu'];

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const nonEmpty = (v) => typeof v === 'string' && v.length > 0;

/* ---------------- kinds ---------------- */

/**
 * What an item is, from its shape: a separator, a live list (`provider`), a choice setting (`setting`), a submenu
 * (`items`, with or without an action of its own) or an action. An item with nothing at all is an action (a stub
 * row: the renderer shows it disabled).
 */
export function menuItemKind(item) {
  if (!isObj(item)) return 'action';
  if (item.separator) return 'separator';
  if (nonEmpty(item.provider)) return 'live-list';
  if (nonEmpty(item.setting)) return 'choice';
  if (Array.isArray(item.items)) return 'submenu';
  return 'action';
}

/* ---------------- choice settings ---------------- */

/** The action spec a pick of `value` for the setting `key` runs: `setting.set:<key>:<json, URI-encoded>`. */
export function choiceAction(key, value) {
  return `${MENU_SETTING_SET}:${encodeURIComponent(key)}:${encodeURIComponent(JSON.stringify(value))}`;
}

/** The action spec a switch runs. */
export const switchAction = (key) => `${MENU_SETTING_TOGGLE}:${encodeURIComponent(key)}`;

/** The runtime's side: the args of a `setting.set` action back to `{ key, value }`, or null when they don't parse. */
export function parseChoiceAction(args) {
  if (!Array.isArray(args) || args.length < 2) return null;
  try {
    const key = decodeURIComponent(args[0]);
    const value = JSON.parse(decodeURIComponent(args.slice(1).join(':')));
    return nonEmpty(key) && isScalar(value) ? { key, value } : null;
  } catch { return null; }
}

/** Does a stored settings value pick this choice? Loose on type: a saved "2" matches the choice 2. */
export const choiceMatches = (choiceValue, settingValue) => settingValue !== null && settingValue !== undefined && String(choiceValue) === String(settingValue);

/**
 * The choice to show for a setting's current value: the one it matches, else the first (a setting that was never
 * saved shows the author's first choice; the renderer marks none as picked until it is).
 */
export function currentChoice(choices, settingValue) {
  if (!Array.isArray(choices) || !choices.length) return null;
  const hit = choices.find((c) => choiceMatches(c.value, settingValue));
  return hit ? { choice: hit, picked: true } : { choice: choices[0], picked: false };
}

/** With `cycle`: the choice after the current one (wrapping). */
export function nextChoice(choices, settingValue) {
  if (!Array.isArray(choices) || !choices.length) return null;
  const at = choices.findIndex((c) => choiceMatches(c.value, settingValue));
  return choices[(at + 1) % choices.length];
}

/* ---------------- live status ---------------- */

/** `source:hub` → { kind, ref }; null when the kind isn't one of MENU_STATUS_KINDS or the ref is empty. */
export function parseStatusSource(source) {
  if (typeof source !== 'string') return null;
  const i = source.indexOf(':');
  if (i <= 0) return null;
  const kind = source.slice(0, i);
  const ref = source.slice(i + 1);
  return MENU_STATUS_KINDS.includes(kind) && ref ? { kind, ref } : null;
}

/** A `status` field (a source string or the full spec) as the full spec, or null when it doesn't parse. */
export function statusSpec(status) {
  const spec = typeof status === 'string' ? { source: status } : isObj(status) ? status : null;
  return spec && parseStatusSource(spec.source) ? spec : null;
}

/** The tone a state is drawn in: the item's own for that state, else the default. */
export function statusTone(spec, state) {
  const own = spec?.tones?.[state];
  return MENU_STATUS_TONE_OPTIONS.includes(own) ? own : MENU_STATUS_TONES[state] ?? MENU_STATUS_TONES.unknown;
}

/** The animation a state gets: the item's own for that state, else the default (`pulse` while busy, else none). */
export function statusAnim(spec, state) {
  const own = spec?.anims?.[state];
  return MENU_STATUS_ANIMS.includes(own) ? own : MENU_STATUS_DEFAULT_ANIMS[state] ?? 'none';
}

/**
 * The slot to draw for a status spec and what its source answered. `reading` is `{ state, text?, icon? }` from the
 * environment (counter / setting / slot / hidden are resolved by the engine; `source:` by a registered source), or
 * null when the source is unknown. The tooltip always explains the icon: the item's text, then the live state.
 */
export function compileStatus(spec, reading, fallbackLabel) {
  const s = statusSpec(spec);
  if (!s) return null;
  const state = reading && MENU_STATUS_STATES.includes(reading.state) ? reading.state : 'unknown';
  const text = reading && nonEmpty(reading.text) ? reading.text : MENU_STATUS_TEXT[state];
  const icon = nonEmpty(s.icon) ? s.icon : reading && nonEmpty(reading.icon) ? reading.icon : MENU_STATUS_DEFAULT_ICON;
  const what = nonEmpty(s.tooltip) ? s.tooltip : fallbackLabel;
  return { source: s.source, state, tone: statusTone(s, state), anim: statusAnim(s, state), icon, text, tooltip: what ? `${what}: ${text}` : text };
}

/* ---------------- paths + per-item token overrides ---------------- */

const PATH_PART = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/** `menuItemPath('app-menu', ['file', 'exports', 'json'])` → `app-menu/file/exports/json`. */
export function menuItemPath(root, trail) {
  return [root, ...trail].join('/');
}

/** Is this a well-formed item path (a known root, then one or more ids)? */
export function isMenuItemPath(path) {
  if (typeof path !== 'string' || path.length > 240) return false;
  const parts = path.split('/');
  return parts.length >= 2 && MENU_PATH_ROOTS.includes(parts[0]) && parts.slice(1).every((p) => PATH_PART.test(p));
}

/**
 * The tokens a menu item can carry as overrides. `behavior` tokens change what the row is and does; `appearance`
 * tokens how it looks, each mapping to theme tokens only (a tone is a colour-theme token id, never a literal colour).
 * The right-click item-settings dialog (s4) writes these; the inline-edit build's element dialog lists the same.
 */
export const MENU_ITEM_TOKENS = {
  label: { group: 'behavior', kind: 'text', label: 'Label' },
  icon: { group: 'behavior', kind: 'icon', label: 'Icon' },
  hint: { group: 'behavior', kind: 'text', label: 'Hint (tooltip)' },
  action: { group: 'behavior', kind: 'action', label: 'Action' },
  shortcut: { group: 'behavior', kind: 'text', label: 'Shortcut' },
  visible: { group: 'behavior', kind: 'boolean', label: 'Visible', default: true },
  order: { group: 'behavior', kind: 'number', label: 'Order', min: 0, max: 1000 },
  tone: { group: 'appearance', kind: 'enum', label: 'Text colour', options: ['theme', 'text', 'muted', 'accent', 'info', 'success', 'warning', 'danger'], default: 'theme' },
  iconTone: { group: 'appearance', kind: 'enum', label: 'Icon colour', options: ['theme', 'text', 'muted', 'accent', 'info', 'success', 'warning', 'danger'], default: 'theme' },
  weight: { group: 'appearance', kind: 'enum', label: 'Weight', options: ['theme', 'regular', 'medium', 'semibold', 'bold'], default: 'theme' },
  emphasis: { group: 'appearance', kind: 'enum', label: 'Emphasis', options: ['none', 'soft', 'outline', 'filled'], default: 'none' },
  size: { group: 'appearance', kind: 'enum', label: 'Text size', options: ['theme', 'sm', 'md', 'lg'], default: 'theme' },
};
export const MENU_ITEM_TOKEN_IDS = Object.keys(MENU_ITEM_TOKENS);
export const MENU_ITEM_APPEARANCE_TOKENS = MENU_ITEM_TOKEN_IDS.filter((t) => MENU_ITEM_TOKENS[t].group === 'appearance');
export const MENU_ITEM_BEHAVIOR_TOKENS = MENU_ITEM_TOKEN_IDS.filter((t) => MENU_ITEM_TOKENS[t].group === 'behavior');

/** One override value checked against its token (wrong kind, out of range, unknown option = undefined, dropped). */
export function normalizeMenuToken(token, v) {
  const t = MENU_ITEM_TOKENS[token];
  if (!t) return undefined;
  switch (t.kind) {
    case 'boolean': return typeof v === 'boolean' ? v : undefined;
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? Math.min(t.max, Math.max(t.min, Math.round(v))) : undefined;
    case 'enum': return typeof v === 'string' && t.options.includes(v) ? v : undefined;
    default: return typeof v === 'string' && v.length <= 200 ? v : undefined;
  }
}

/**
 * The saved settings value shaped: `{ [item path]: { [token]: value } }`, every entry checked, defaults dropped (a
 * default is "as the asset says"). Anything else is left out, never an error.
 */
export function normalizeMenuOverrides(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [path, map] of Object.entries(raw)) {
    if (!isMenuItemPath(path) || !isObj(map)) continue;
    const m = {};
    for (const [token, v] of Object.entries(map)) {
      const n = normalizeMenuToken(token, v);
      if (n !== undefined && n !== MENU_ITEM_TOKENS[token].default) m[token] = n;
    }
    if (Object.keys(m).length) out[path] = m;
  }
  return out;
}

/** A settings value with one token set on one item (or cleared with null / its default). */
export function withMenuOverride(raw, path, token, value) {
  const o = normalizeMenuOverrides(raw);
  if (!isMenuItemPath(path) || !MENU_ITEM_TOKENS[token]) return o;
  const n = value === null ? undefined : normalizeMenuToken(token, value);
  const m = { ...(o[path] ?? {}) };
  if (n === undefined || n === MENU_ITEM_TOKENS[token].default) delete m[token]; else m[token] = n;
  if (Object.keys(m).length) o[path] = m; else delete o[path];
  return o;
}

/** A settings value with every override of one item dropped (or of every item under a prefix when `deep`). */
export function withoutMenuOverrides(raw, path, deep = false) {
  const o = normalizeMenuOverrides(raw);
  for (const p of Object.keys(o)) if (p === path || (deep && p.startsWith(`${path}/`))) delete o[p];
  return o;
}

/** Every override as flat records (the overrides list, the control@1 `list`): `{ path, token, value }`. */
export function listMenuOverrides(raw) {
  const out = [];
  for (const [path, map] of Object.entries(normalizeMenuOverrides(raw))) for (const [token, value] of Object.entries(map)) out.push({ path, token, value });
  return out;
}

/* ---------------- migration (menu-item@1 → @2) ---------------- */

/**
 * One list of items to menu-item@2: every item gets its explicit `kind`; a check mark bound to a setting on an item
 * with nothing to run (`checked: setting:<k>`, no action, no items, no provider) becomes a switch (`setting: k`), the
 * one case where @1 data meant a choice setting. Everything else is kept as written. Returns the new list and notes
 * (one per change, with the item's path).
 */
export function migrateMenuItems(items, trail = []) {
  const notes = [];
  if (!Array.isArray(items)) return { items, notes };
  const out = items.map((it) => {
    if (!isObj(it)) return it;
    const path = [...trail, typeof it.id === 'string' ? it.id : '?'].join('/');
    const next = { ...it };
    if (typeof next.checked === 'string' && next.checked.startsWith('setting:') && next.checked.length > 'setting:'.length && !('action' in next) && !('items' in next) && !('provider' in next) && !('setting' in next)) {
      next.setting = next.checked.slice('setting:'.length);
      delete next.checked;
      notes.push(`${path}: check mark bound to setting "${next.setting}" with nothing to run → a switch (setting)`);
    }
    const kind = menuItemKind(next);
    if (next.kind !== kind) { if (next.kind !== undefined) notes.push(`${path}: kind "${next.kind}" does not match the item; set to ${kind}`); next.kind = kind; }
    if (Array.isArray(next.items)) {
      const sub = migrateMenuItems(next.items, [...trail, path.split('/').pop()]);
      next.items = sub.items;
      notes.push(...sub.notes);
    }
    return next;
  });
  return { items: out, notes };
}

/**
 * An app-menu or context-menu asset to menu-item@2 (a copy; the input is never changed): `data.menus[].items` or
 * `data.targets.*`, plus `data.menuItems: 2`. Other asset types pass through with `changed: false`.
 */
export function migrateMenuAsset(asset) {
  if (!isObj(asset) || !isObj(asset.data)) return { asset, notes: [], changed: false };
  const notes = [];
  const out = structuredClone(asset);
  if (asset.type === 'app-menu' && Array.isArray(out.data.menus)) {
    out.data.menus = out.data.menus.map((m) => {
      if (!isObj(m) || !Array.isArray(m.items)) return m;
      const r = migrateMenuItems(m.items, [m.id]);
      notes.push(...r.notes);
      return { ...m, items: r.items };
    });
  } else if (asset.type === 'context-menu' && isObj(out.data.targets)) {
    for (const [t, items] of Object.entries(out.data.targets)) {
      const r = migrateMenuItems(items, [t]);
      out.data.targets[t] = r.items;
      notes.push(...r.notes);
    }
  } else return { asset, notes, changed: false };
  out.data.menuItems = MENU_ITEMS_VERSION;
  return { asset: out, notes, changed: JSON.stringify(out) !== JSON.stringify(asset) };
}

/* ---------------- validation (the menu-item@2 fields; shared by core/validate and the build engine) ---------------- */

/**
 * Errors in the @2 fields of one item (`p` = its path in the messages). The @1 fields (provider, badge, checked,
 * order, before, after, items depth) are checked by the caller, which also recurses.
 */
export function menuItemV2Errors(o, p) {
  const errors = [];
  if (!isObj(o)) return errors;
  if ('kind' in o) {
    if (!MENU_KINDS.includes(o.kind)) errors.push(`${p}.kind must be one of: ${MENU_KINDS.join(', ')}`);
    else if (o.kind !== menuItemKind(o)) errors.push(`${p}.kind is ${o.kind} but the item is a ${menuItemKind(o)} (separator / provider / setting / items decide)`);
  }
  if ('hint' in o && (typeof o.hint !== 'string' || !o.hint)) errors.push(`${p}.hint must be a non-empty string`);
  if ('setting' in o) {
    if (!nonEmpty(o.setting)) errors.push(`${p}.setting must be a non-empty string (a settings key)`);
    if ('provider' in o) errors.push(`${p} has both setting and provider`);
    if ('items' in o) errors.push(`${p} has both setting and items (a choice setting lists its own choices)`);
    if ('checked' in o) errors.push(`${p} has both setting and checked (a choice setting draws its own check)`);
  }
  if ('choices' in o) {
    if (!('setting' in o)) errors.push(`${p}.choices needs a setting`);
    if (!Array.isArray(o.choices)) errors.push(`${p}.choices must be a list`);
    else {
      if (o.choices.length < MENU_CHOICES_MIN || o.choices.length > MENU_CHOICES_MAX) errors.push(`${p}.choices must have ${MENU_CHOICES_MIN} to ${MENU_CHOICES_MAX} entries`);
      const seen = new Set();
      o.choices.forEach((c, i) => {
        const cp = `${p}.choices[${i}]`;
        if (!isObj(c)) { errors.push(`${cp} must be an object`); return; }
        if (!isScalar(c.value)) errors.push(`${cp}.value must be a string, number or boolean`);
        else if (seen.has(String(c.value))) errors.push(`${cp}.value repeats ${JSON.stringify(c.value)}`);
        else seen.add(String(c.value));
        if (!nonEmpty(c.label)) errors.push(`${cp}.label must be a non-empty string`);
        for (const k of ['icon', 'hint']) if (k in c && !nonEmpty(c[k])) errors.push(`${cp}.${k} must be a non-empty string`);
      });
    }
  }
  if ('cycle' in o) {
    if (typeof o.cycle !== 'boolean') errors.push(`${p}.cycle must be a boolean`);
    else if (o.cycle && !('choices' in o)) errors.push(`${p}.cycle needs choices`);
  }
  if ('status' in o) {
    const s = o.status;
    if (typeof s === 'string') { if (!parseStatusSource(s)) errors.push(`${p}.status must be one of: ${MENU_STATUS_KINDS.map((k) => `${k}:<ref>`).join(', ')}`); }
    else if (!isObj(s)) errors.push(`${p}.status must be a source string or an object`);
    else {
      if (!parseStatusSource(s.source)) errors.push(`${p}.status.source must be one of: ${MENU_STATUS_KINDS.map((k) => `${k}:<ref>`).join(', ')}`);
      for (const k of ['icon', 'tooltip']) if (k in s && !nonEmpty(s[k])) errors.push(`${p}.status.${k} must be a non-empty string`);
      for (const [field, allowed] of [['tones', MENU_STATUS_TONE_OPTIONS], ['anims', MENU_STATUS_ANIMS]]) {
        if (!(field in s)) continue;
        if (!isObj(s[field])) { errors.push(`${p}.status.${field} must be an object keyed by state`); continue; }
        for (const [st, v] of Object.entries(s[field])) {
          if (!MENU_STATUS_STATES.includes(st)) errors.push(`${p}.status.${field}.${st}: unknown state (${MENU_STATUS_STATES.join(', ')})`);
          else if (!allowed.includes(v)) errors.push(`${p}.status.${field}.${st} must be one of: ${allowed.join(', ')}`);
        }
      }
    }
  }
  return errors;
}

/** JSON Schema fragments for the @2 fields (the generated app-menu / context-menu schemas, `menuItemSchema`). */
export function menuItemV2SchemaProperties(doc = {}) {
  const src = `^(${MENU_STATUS_KINDS.join('|')}):.+$`;
  const byState = (values) => ({ type: 'object', propertyNames: { enum: MENU_STATUS_STATES }, additionalProperties: { enum: values } });
  return {
    kind: { enum: MENU_KINDS, description: doc.kind },
    hint: { type: 'string', minLength: 1, description: doc.hint },
    setting: { type: 'string', minLength: 1, description: doc.setting },
    choices: {
      type: 'array', minItems: MENU_CHOICES_MIN, maxItems: MENU_CHOICES_MAX, description: doc.choices,
      items: { type: 'object', required: ['value', 'label'], properties: { value: { type: ['string', 'number', 'boolean'] }, label: { type: 'string', minLength: 1 }, icon: { type: 'string', minLength: 1 }, hint: { type: 'string', minLength: 1 } } },
    },
    cycle: { type: 'boolean', description: doc.cycle },
    status: {
      description: doc.status,
      oneOf: [
        { type: 'string', pattern: src },
        { type: 'object', required: ['source'], properties: { source: { type: 'string', pattern: src }, icon: { type: 'string', minLength: 1 }, tooltip: { type: 'string', minLength: 1 }, tones: byState(MENU_STATUS_TONE_OPTIONS), anims: byState(MENU_STATUS_ANIMS) } },
      ],
    },
  };
}
