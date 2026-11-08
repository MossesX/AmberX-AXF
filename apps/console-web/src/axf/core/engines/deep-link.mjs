/**
 * deep-link@1 — a URL that opens any view of an app built on AXF, so an agent can open any UI on Brett's phone
 * (build ui-api-parity-rule, Nov 8 2026, Brett: "Deep link per plugin view (URL that opens it) so agents can open any
 * UI on the phone").
 *
 *   <base>?axf-view=<view id>                     open a view (a page: a plugin view, a console screen)
 *         &axf-dialog=<dialog id>                 open a dialog (on top of the view)
 *         &axf-settings=<settings tab id>         open a settings tab (plugins/<id> for a plugin's sub-tab)
 *         &axf-do=<action spec>                   then run a console action (repeatable, in order): demo.edit:demonstration:x
 *
 * Read once when the app loads (framework/react/deepLinks.ts, installed by <AxfProvider>), then taken out of the address
 * bar so a reload doesn't run it again. A link can only *open* things: an `axf-do` action runs only when the action says
 * its effect is `navigate` or `read` (ActionMeta.effect); anything else (a write, a delete, a person-only decision) is
 * refused and named, so a crafted link can never change data. `?axf-view=` was already used by the glossary's generated
 * docs and Watch live; it keeps working.
 *
 * Pure: no DOM, no Node. Web port only today; the Android twin (an intent URI with the same params) is a deferred gap in
 * framework/spec/PORTING.md.
 */

export const DEEP_LINK_FRAME = 'deep-link@1';
export const DEEP_LINK_PARAMS = Object.freeze({ view: 'axf-view', dialog: 'axf-dialog', settings: 'axf-settings', do: 'axf-do' });
/** Action effects a link may run (ActionMeta.effect). */
export const DEEP_LINK_EFFECTS = Object.freeze(['navigate', 'read']);
export const DEEP_LINK_MAX_DO = 8;

const VIEW = /^[a-z][a-z0-9-]{0,63}$/;
const DIALOG = /^[a-z][a-z0-9._-]{0,95}$/;
const SETTINGS = /^[a-z][a-z0-9._/-]{0,95}$/;
const ACTION = /^[a-z][a-z0-9._-]{0,63}(?::[^\s]{0,400})?$/;

export const isDeepLinkView = (v) => typeof v === 'string' && VIEW.test(v);
export const isDeepLinkDialog = (v) => typeof v === 'string' && DIALOG.test(v);
export const isDeepLinkSettings = (v) => typeof v === 'string' && SETTINGS.test(v);
export const isDeepLinkAction = (v) => typeof v === 'string' && ACTION.test(v);

/**
 * The URL for a view / dialog / settings tab / actions. `base` is the app's address (https://console.amberxai.com);
 * '' gives the query alone (`?axf-view=…`). Throws on an id that isn't one.
 */
export function deepLink({ base = '', view = '', dialog = '', settings = '', do: actions = [] } = {}) {
  const list = (Array.isArray(actions) ? actions : [actions]).filter(Boolean);
  if (view && !isDeepLinkView(view)) throw new Error(`"${view}" is not a view id`);
  if (dialog && !isDeepLinkDialog(dialog)) throw new Error(`"${dialog}" is not a dialog id`);
  if (settings && !isDeepLinkSettings(settings)) throw new Error(`"${settings}" is not a settings tab id`);
  if (list.length > DEEP_LINK_MAX_DO) throw new Error(`at most ${DEEP_LINK_MAX_DO} actions in one link`);
  for (const a of list) if (!isDeepLinkAction(a)) throw new Error(`"${a}" is not an action spec`);
  if (!view && !dialog && !settings && !list.length) throw new Error('a deep link needs a view, a dialog, a settings tab or an action');
  const q = new URLSearchParams();
  if (view) q.set(DEEP_LINK_PARAMS.view, view);
  if (dialog) q.set(DEEP_LINK_PARAMS.dialog, dialog);
  if (settings) q.set(DEEP_LINK_PARAMS.settings, settings);
  for (const a of list) q.append(DEEP_LINK_PARAMS.do, a);
  const b = String(base ?? '').replace(/[?#].*$/, '');
  return `${b}${b && !b.endsWith('/') ? '/' : ''}?${q.toString()}`;
}

/** What a URL's query asks for: { view, dialog, settings, do: [], errors: [] } (empty strings when not asked). */
export function parseDeepLink(search) {
  const s = String(search ?? '');
  const q = new URLSearchParams(s.includes('?') ? s.slice(s.indexOf('?') + 1).split('#')[0] : s.replace(/^#/, ''));
  const out = { view: '', dialog: '', settings: '', do: [], errors: [] };
  const one = (key, test, field, what) => {
    const v = q.get(DEEP_LINK_PARAMS[key]);
    if (v == null || v === '') return;
    if (test(v)) out[field] = v; else out.errors.push(`${DEEP_LINK_PARAMS[key]}: "${v.slice(0, 80)}" is not a ${what}`);
  };
  one('view', isDeepLinkView, 'view', 'view id');
  one('dialog', isDeepLinkDialog, 'dialog', 'dialog id');
  one('settings', isDeepLinkSettings, 'settings', 'settings tab id');
  for (const a of q.getAll(DEEP_LINK_PARAMS.do)) {
    if (out.do.length >= DEEP_LINK_MAX_DO) { out.errors.push(`${DEEP_LINK_PARAMS.do}: more than ${DEEP_LINK_MAX_DO} actions, the rest left out`); break; }
    if (isDeepLinkAction(a)) out.do.push(a); else out.errors.push(`${DEEP_LINK_PARAMS.do}: "${a.slice(0, 80)}" is not an action spec`);
  }
  return out;
}

/** Does the query carry a deep link at all? */
export const hasDeepLink = (search) => { const p = parseDeepLink(search); return !!(p.view || p.dialog || p.settings || p.do.length || p.errors.length); };

/** The query without the deep-link params ('' or '?…'), for taking the link out of the address bar after it ran. */
export function stripDeepLink(search) {
  const q = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  for (const k of Object.values(DEEP_LINK_PARAMS)) q.delete(k);
  const rest = q.toString();
  return rest ? `?${rest}` : '';
}

/** May a link run this action? Only when its meta says navigate or read, and it is not person-only. → '' or why not. */
export function deepLinkRefusal(meta) {
  if (!meta) return 'no such action';
  if (meta.personOnly === true) return "needs Brett's own tap";
  if (!DEEP_LINK_EFFECTS.includes(meta.effect)) return `a link only opens things (this action's effect is ${meta.effect ?? 'not declared'}; run it from the console or the API)`;
  return '';
}
