/**
 * Host widgets engine: the widgets a person puts on one toolbar or tab row, and their choices for them
 * (Brett, Nov 13 2026, build toolbar-widgets-attach-any-banner-style: "I can attach widgets to the toolbar right, just
 * like the banner widgets").
 *
 * Every toolbar and every tab row is a widget host instance (engines/widgets.ts: `toolbar@<instance>`, `tab-group@<id>`;
 * the app toolbar is plain `toolbar`). What sits on one is three layers, the same as the banner's:
 *   1. the host asset's own `widgets` list and what modules attached at run time (rt.attachToToolbar);
 *   2. what the person added from the picker or by voice ("add the CPU widget to the main toolbar"): this file's
 *      `HostWidgetChoice.attach`, picked from the one widget registry the banner uses (every widget asset, every chip a
 *      plugin attached to the banner, with its hint);
 *   3. their choices per widget (hidden, size, shows, width, priority, hide when empty, overflow): the banner's
 *      `BannerWidgetPref` rules, unchanged, in `HostWidgetChoice.prefs`.
 * Order and side stay in the host arrangement (`axf.widgets.arrange.<host id>`, rt.moveHostItem), so arrange mode and
 * the picker never disagree. The choice is one look setting per app, form factor and instance
 * (`axf.widgets.on.<host>.<app>.<phone|desktop>.<instance>`), so it syncs through axHub with the banner's.
 *
 * Pure functions. Kotlin twin deferred (spec/PORTING.md); checks in spec/check-widgets.mts.
 */
import { BANNER_WIDGET_SIZES, normalizeBannerWidgetPrefs, patchBannerWidget, type BannerWidgetPrefs } from './bannerwidgets';
import { attachmentKey, type HostAttachment } from './widgets';

/** Most widgets a person may add to one host instance. */
export const HOST_WIDGETS_MAX = 60;
const ID = /^[A-Za-z0-9._-]{1,80}$/;
const TYPE = /^[a-z0-9-]{1,40}$/;
const INSTANCE = /^[a-z0-9][a-z0-9._:/-]{0,119}$/i;

/** One host instance's saved choice: the widgets the person added, and their choices for every widget on it. */
export interface HostWidgetChoice { attach: HostAttachment[]; prefs: BannerWidgetPrefs }

export const emptyHostWidgetChoice = (): HostWidgetChoice => ({ attach: [], prefs: {} });
export const isHostInstanceId = (id: unknown): id is string => typeof id === 'string' && INSTANCE.test(id);

/** The setting holding one instance's choice. */
export function hostWidgetsKey(host: string, app: string, form: 'phone' | 'desktop', instance: string): string {
  const a = app.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'app';
  return `axf.widgets.on.${host}.${a}.${form}.${instance}`;
}

/** A saved choice with only valid entries (widget types the host takes, known sides, sane ids). Anything else is dropped. */
export function normalizeHostWidgetChoice(raw: unknown, types: readonly string[], sides: readonly string[]): HostWidgetChoice {
  const out = emptyHostWidgetChoice();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as { attach?: unknown; prefs?: unknown };
  const seen = new Set<string>();
  for (const a of Array.isArray(r.attach) ? r.attach : []) {
    if (out.attach.length >= HOST_WIDGETS_MAX || !a || typeof a !== 'object') continue;
    const e = a as { type?: unknown; id?: unknown; at?: unknown; order?: unknown };
    if (typeof e.type !== 'string' || !TYPE.test(e.type) || !types.includes(e.type) || typeof e.id !== 'string' || !ID.test(e.id) || typeof e.at !== 'string' || !sides.includes(e.at)) continue;
    const key = attachmentKey(e.type, e.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.attach.push({ type: e.type, id: e.id, at: e.at, order: typeof e.order === 'number' && Number.isFinite(e.order) ? e.order : 2000 + out.attach.length * 10, origin: 'person' });
  }
  out.prefs = normalizeBannerWidgetPrefs(r.prefs);
  return out;
}

/** Is there anything saved? (an empty choice is cleared, not stored) */
export const hostWidgetChoiceEmpty = (c: HostWidgetChoice): boolean => !c.attach.length && !Object.keys(c.prefs).length;

/** The choice with a widget added at a side (after everything already there). The same widget again moves it to that side. */
export function addHostWidget(c: HostWidgetChoice, type: string, id: string, at: string, types: readonly string[], sides: readonly string[]): HostWidgetChoice {
  if (!TYPE.test(type) || !types.includes(type) || !ID.test(id) || !sides.includes(at)) return { attach: [...c.attach], prefs: { ...c.prefs } };
  const key = attachmentKey(type, id);
  const rest = c.attach.filter((a) => attachmentKey(a.type, a.id) !== key);
  if (rest.length >= HOST_WIDGETS_MAX) return { attach: [...c.attach], prefs: { ...c.prefs } };
  const order = 2000 + rest.length * 10;
  // a widget added back is shown again, whatever was chosen before it was removed
  const prefs = patchBannerWidget(c.prefs, key, { hidden: null });
  return { attach: [...rest, { type, id, at, order, origin: 'person' }], prefs };
}

/** The choice without a widget the person added (its prefs go too). A widget the host or a module put there is not here to remove: hide it. */
export function removeHostWidget(c: HostWidgetChoice, key: string): HostWidgetChoice {
  const prefs = { ...c.prefs };
  delete prefs[key];
  return { attach: c.attach.filter((a) => attachmentKey(a.type, a.id) !== key), prefs };
}

/** The choice with a widget's prefs patched (the banner's rules: null = back to the default). */
export function patchHostWidget(c: HostWidgetChoice, key: string, patch: Record<string, unknown>): HostWidgetChoice {
  return { attach: [...c.attach], prefs: patchBannerWidget(c.prefs, key, patch) };
}

/** Everything a `<host>.widget` action may do to one widget. */
export const HOST_WIDGET_OPS = ['add', 'remove', 'hide', 'show', 'reset', ...BANNER_WIDGET_SIZES, 'start', 'end'] as const;
export type HostWidgetOp = typeof HOST_WIDGET_OPS[number];
export const isHostWidgetOp = (v: unknown): v is HostWidgetOp => (HOST_WIDGET_OPS as readonly unknown[]).includes(v);

/**
 * Split a `<host>.widget` action's arguments: the last is the op, the first the instance when there are three or more
 * (`app:cpu:add`), else the app instance (`cpu:add`). The rest, joined by `:`, names the widget (a key like `status:cpu`
 * needs the instance spelled out). Null when there's no op or no name.
 */
export function parseHostWidgetArgs(args: readonly string[]): { instance: string; name: string; op: HostWidgetOp } | null {
  if (args.length < 2) return null;
  const op = args[args.length - 1]!;
  if (!isHostWidgetOp(op)) return null;
  const body = args.slice(0, -1);
  const instance = body.length >= 2 ? body[0]! : '';
  const name = (body.length >= 2 ? body.slice(1) : body).join(':');
  if (!name) return null;
  return { instance: instance || 'app', name, op };
}

export interface HostInstanceOnScreen { id: string; label: string }

/**
 * Which host instance a person means ("the main toolbar", "settings toolbar", "ui-review.sections"): `app` for the app's
 * own (main, app, top, the toolbar, nothing), an exact id, else the instance whose id or label is made of the words, or
 * contains them. "toolbar", "tab", "bar", "row", "the", "widgets" are dropped. Null when nothing matches.
 */
export function matchHostInstance(rows: readonly HostInstanceOnScreen[], words: string): string | null {
  const raw = String(words ?? '').trim();
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|a|this|toolbar|tool|bar|tabs?|rows?|group|widgets?|of|on|to)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const want = norm(raw);
  if (!raw || !want || /^(app|main|top|default)$/.test(want)) return 'app';
  const exact = rows.find((r) => r.id === raw);
  if (exact) return exact.id;
  const score = (r: HostInstanceOnScreen) => {
    const id = norm(r.id), label = norm(r.label);
    if (id === want || label === want) return 3;
    if (id.split(' ').includes(want) || label.split(' ').includes(want)) return 2;
    if (id.includes(want) || label.includes(want)) return 1;
    return 0;
  };
  const best = rows.map((r, i) => ({ r, i, s: score(r) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i)[0];
  if (best) return best.r.id;
  return isHostInstanceId(raw) ? raw : null;
}
