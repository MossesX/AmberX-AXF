/**
 * interface@1: one asset (type `interface`) that names a whole interface, so the same app can be drawn as several
 * "different apps" (GizmoX's interface tabs) and an interface roller can produce a complete new one:
 *
 *   design      a design-package id: style, colour, layout and behaviour themes (+ its extras, lowest layer)
 *   branding    a branding id (logos, animated logo, icon pack); '' = the app's current branding
 *   slots       asset type → asset id for every other slot (chrome, controls, widgets, settings interface …);
 *               an OPEN list: any registered asset type except the never list, so new chrome joins by itself
 *   spacing     tight | compact | regular;  hidden  asset type → true / false;  settings  appearance key → value
 *   tab         { label, icon } for a host that shows interfaces as tabs
 *
 * Layers, lowest first: the design package's own themes and extras → the interface's slots / spacing / hidden /
 * settings → (at run time) nothing else: an interface is complete by itself. `resolveInterface` turns one into the
 * full active map against a registry, skipping ids the app doesn't ship (reported in `missing`, never a crash).
 *
 * Scopes (step s2): several interfaces drawn at once in one page. A scope is an id + a resolved interface; its CSS
 * lives under `[data-fx-scope="<id>"]` instead of `:root`, so nothing leaks between scopes or into the app's own look.
 * `scopeSelector`, `scopeSheet` (re-root a sheet's selectors under a scope) and `scopeAttrs` are the pure parts; the
 * runtime's `scoped(id, interfaceId)` view and React's <InterfaceScope> use them.
 *
 * Pure; fixture `spec/fixtures/interface.json`, checker `spec/check-interface.mts`. Kotlin twin deferred (PORTING.md).
 */
import { DESIGN_PACKAGE_TYPE, DESIGN_THEMES, designPackageSlots, isAppearanceSetting, normalizeDesignPackage } from './designpackage';
import { spacingOf } from './spacing';

export const INTERFACE_TYPE = 'interface';
export const INTERFACE_SETTING_KEY = 'axf.appearance.interface';

/** Slot types an interface never sets directly (the themes come from its design package). */
export const INTERFACE_NEVER: readonly string[] = ['uac-policy', INTERFACE_TYPE, DESIGN_PACKAGE_TYPE, 'appearance-package', ...DESIGN_THEMES];

export interface InterfaceData {
  design: string;
  branding: string;
  slots: Record<string, string>;
  spacing?: string;
  hidden?: Record<string, boolean>;
  settings?: Record<string, unknown>;
  tab?: { label: string; icon: string };
  tagline?: string;
}

export interface ResolvedInterface {
  /** asset type → id for every slot the interface sets (themes included); only ids the registry has */
  active: Record<string, string>;
  spacing: string;
  hidden: Record<string, boolean>;
  settings: Record<string, unknown>;
  branding: string;
  design: string;
  /** `type/id` of everything named but not shipped by the app */
  missing: string[];
}

export interface InterfaceRegistry {
  has(type: string, id: string): boolean;
  /** the raw data of a design package, or undefined */
  designPackage(id: string): unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SCOPE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function normalizeInterface(raw: unknown): InterfaceData {
  const d = isObj(raw) ? raw : {};
  const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : '');
  const slots: Record<string, string> = {};
  if (isObj(d.slots)) for (const [t, v] of Object.entries(d.slots)) if (!INTERFACE_NEVER.includes(t) && ID.test(t) && id(v)) slots[t] = v as string;
  const out: InterfaceData = { design: id(d.design), branding: id(d.branding), slots };
  if (typeof d.spacing === 'string' && spacingOf(d.spacing) === d.spacing) out.spacing = d.spacing;
  if (isObj(d.hidden)) { out.hidden = {}; for (const [t, v] of Object.entries(d.hidden)) if (typeof v === 'boolean' && ID.test(t)) out.hidden[t] = v; }
  if (isObj(d.settings)) { out.settings = {}; for (const [k, v] of Object.entries(d.settings)) if (isAppearanceSetting(k) && v !== undefined) out.settings[k] = v; }
  if (isObj(d.tab)) out.tab = { label: typeof d.tab.label === 'string' ? d.tab.label.slice(0, 40) : '', icon: typeof d.tab.icon === 'string' ? d.tab.icon.slice(0, 40) : '' };
  if (typeof d.tagline === 'string') out.tagline = d.tagline.slice(0, 120);
  return out;
}

export function interfaceErrors(raw: unknown): string[] {
  if (!isObj(raw)) return ['data must be an object'];
  const e: string[] = [];
  if (typeof raw.design !== 'string' || !ID.test(raw.design)) e.push('data.design must be a design-package asset id');
  if (raw.branding !== undefined && (typeof raw.branding !== 'string' || !ID.test(raw.branding))) e.push('data.branding must be a branding asset id');
  if (raw.slots !== undefined) {
    if (!isObj(raw.slots)) e.push('data.slots must be an object (asset type → asset id)');
    else for (const [t, v] of Object.entries(raw.slots)) {
      if (INTERFACE_NEVER.includes(t)) e.push(`data.slots.${t}: ${(DESIGN_THEMES as readonly string[]).includes(t) ? 'the themes come from the design package' : `an interface never sets ${t}`}`);
      else if (!ID.test(t)) e.push(`data.slots.${t}: not an asset type name`);
      else if (typeof v !== 'string' || !ID.test(v)) e.push(`data.slots.${t} must be an asset id`);
    }
  }
  if (raw.spacing !== undefined && (typeof raw.spacing !== 'string' || spacingOf(raw.spacing) !== raw.spacing)) e.push('data.spacing must be tight, compact or regular');
  if (raw.hidden !== undefined && (!isObj(raw.hidden) || Object.values(raw.hidden).some((v) => typeof v !== 'boolean'))) e.push('data.hidden must map asset types to true / false');
  if (raw.settings !== undefined) {
    if (!isObj(raw.settings)) e.push('data.settings must be an object');
    else for (const k of Object.keys(raw.settings)) if (!isAppearanceSetting(k)) e.push(`data.settings.${k} is not an appearance setting`);
  }
  if (raw.tab !== undefined && (!isObj(raw.tab) || typeof raw.tab.label !== 'string')) e.push('data.tab must be { label, icon? }');
  return e;
}

/** The full look an interface stands for, against what the app ships. Layer order: design package → interface. */
export function resolveInterface(raw: unknown, registry: InterfaceRegistry): ResolvedInterface {
  const i = normalizeInterface(raw);
  const missing: string[] = [];
  const active: Record<string, string> = {};
  let spacing = 'tight';
  const hidden: Record<string, boolean> = {};
  const settings: Record<string, unknown> = {};
  const pkgRaw = i.design ? registry.designPackage(i.design) : undefined;
  if (i.design && pkgRaw === undefined) missing.push(`${DESIGN_PACKAGE_TYPE}/${i.design}`);
  if (pkgRaw !== undefined) {
    const pkg = normalizeDesignPackage(pkgRaw);
    for (const [t, id] of Object.entries(designPackageSlots(pkg))) { if (registry.has(t, id)) active[t] = id; else missing.push(`${t}/${id}`); }
    if (pkg.extras?.spacing) spacing = pkg.extras.spacing;
    Object.assign(hidden, pkg.extras?.hidden ?? {});
    Object.assign(settings, pkg.extras?.settings ?? {});
    active[DESIGN_PACKAGE_TYPE] = i.design;
  }
  for (const [t, id] of Object.entries(i.slots)) { if (registry.has(t, id)) active[t] = id; else missing.push(`${t}/${id}`); }
  let branding = '';
  if (i.branding) { if (registry.has('branding', i.branding)) { active.branding = i.branding; branding = i.branding; } else missing.push(`branding/${i.branding}`); }
  if (i.spacing) spacing = i.spacing;
  Object.assign(hidden, i.hidden ?? {});
  Object.assign(settings, i.settings ?? {});
  return { active, spacing, hidden, settings, branding, design: i.design, missing };
}

/** What capturing needs. */
export interface InterfaceCaptureEnv { active: Record<string, string>; types: readonly string[]; spacing: string; hidden: Record<string, boolean>; values: Record<string, unknown>; design: string }

/** The current look as an interface over design package `env.design` (its extras are not repeated: the interface lists every slot itself, so it is complete without them). */
export function captureInterface(env: InterfaceCaptureEnv, tab?: { label: string; icon: string }): InterfaceData {
  const slots: Record<string, string> = {};
  for (const t of env.types) if (!INTERFACE_NEVER.includes(t) && t !== 'branding' && env.active[t]) slots[t] = env.active[t]!;
  const settings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(env.values).sort(([a], [b]) => a.localeCompare(b))) if (isAppearanceSetting(k) && k !== INTERFACE_SETTING_KEY && v !== undefined && v !== null) settings[k] = v;
  return { design: env.design, branding: env.active.branding ?? '', slots, spacing: env.spacing, hidden: { ...env.hidden }, settings, ...(tab ? { tab } : {}) };
}

/** The slots two interfaces disagree on (for the roller's diff and the tabs' "what changes" note). */
export function interfaceDiff(a: ResolvedInterface, b: ResolvedInterface): string[] {
  const keys = new Set([...Object.keys(a.active), ...Object.keys(b.active)]);
  const out: string[] = [];
  for (const k of [...keys].sort()) if (a.active[k] !== b.active[k]) out.push(k);
  if (a.spacing !== b.spacing) out.push('spacing');
  if (JSON.stringify(a.hidden) !== JSON.stringify(b.hidden)) out.push('hidden');
  return out;
}

/* ---------------- scopes (s2) ---------------- */

/** A scope id as used in `data-fx-scope`; anything else is refused by the runtime. */
export function isScopeId(id: unknown): id is string { return typeof id === 'string' && SCOPE_ID.test(id); }

/** The selector a scope's CSS is rooted under. */
export function scopeSelector(id: string): string { return `[data-fx-scope="${id}"]`; }

/** The data attributes a scope's root element carries (over the compiled attrs, which stay per scope). */
export function scopeAttrs(id: string, interfaceId: string, attrs: Record<string, string>): Record<string, string> {
  return { ...attrs, 'data-fx-scope': id, 'data-fx-interface': interfaceId };
}

/**
 * Re-root a stylesheet under a scope: every selector of every top-level rule gets the scope prefix, `:root` / `html`
 * / `body` become the scope element itself, and at-rules (`@media`, `@supports`, `@container`) are descended into;
 * `@keyframes` / `@font-face` are kept verbatim (their names are global and the sheet owns them).
 * Good enough for the sheets the engines emit (custom tokens, behaviour, brand, look): plain selector lists with
 * balanced braces; strings in selectors are not special-cased beyond quoted attribute values.
 */
export function scopeSheet(css: string, scopeId: string): string {
  const scope = scopeSelector(scopeId);
  const out: string[] = [];
  let i = 0;
  const n = css.length;
  const skipWs = () => { while (i < n && /\s/.test(css[i]!)) i++; };
  const readBlock = (): string => { // from the '{' at i to its matching '}', returned without the braces
    let depth = 0; const start = i + 1;
    for (; i < n; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') { depth--; if (depth === 0) { const body = css.slice(start, i); i++; return body; } } }
    return css.slice(start);
  };
  const prefix = (selectors: string): string => selectors.split(',').map((s) => {
    const t = s.trim();
    if (!t) return t;
    if (/^(:root|html|body)(\b|$)/.test(t)) return t.replace(/^(:root|html|body)/, scope);
    return `${scope} ${t}`;
  }).join(', ');
  while (i < n) {
    skipWs();
    if (i >= n) break;
    if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    const braceAt = css.indexOf('{', i);
    const semiAt = css.indexOf(';', i);
    if (braceAt < 0 || (semiAt >= 0 && semiAt < braceAt && css[i] === '@')) { // statement at-rule (@import, @charset) or trailing text: keep
      const end = semiAt < 0 ? n : semiAt + 1; out.push(css.slice(i, end)); i = end; continue;
    }
    const head = css.slice(i, braceAt).trim();
    i = braceAt;
    const body = readBlock();
    if (head.startsWith('@')) {
      if (/^@(keyframes|-webkit-keyframes|font-face|property|counter-style|page)\b/.test(head)) out.push(`${head} {${body}}`);
      else out.push(`${head} {${scopeSheet(body, scopeId)}}`);
    } else out.push(`${prefix(head)} {${body}}`);
  }
  return out.join('\n');
}

/** The vars of a scope as one declaration block under its selector (the scope's own `:root`). */
export function scopeVarsCss(id: string, vars: Record<string, string>): string {
  const decl = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  return `${scopeSelector(id)} { ${decl} }`;
}
