/**
 * Console deep links, the pure part (deep-link resolver; tests: apps/console-web/scripts/deeplink.test.mjs). A link
 * names what to open in one of three ways, all ending at the same console-control@1 address or console action:
 *
 *   #/<view>[/<sub>…]             #/plan-studio-2, #/plan-studio-2/plan:<id>, #/plan-studio-2/<plan id>,
 *                                 #/settings/plugins (= view:settings/tab:settings.tabs=plugins), #/settings/plugins/<plugin>
 *   ?axf-target=<address>         view:plan-studio-2/plan:<id>, view:settings/tab:settings.tabs=plugins, setting:…
 *   ?axf-open=<address|action>    the older native form (an address, or an action like plan-studio-2.focus:deploy)
 *
 * parseDeepLink reads a URL (null = nothing to follow) and gives the URL without the link (`rest`, for replaceState).
 * planDeepLink turns it into what to do: navigate to a view and either run a console-control address or a console
 * action (a segment of a kind the control contract does not have, like `plan:`, is the view's own `<view>.open:<id>`).
 * createPendingTargets holds the newest link until its view (a lazily loaded plugin's) has registered, then opens it
 * once; a link whose view never comes ends in a notice instead of leaving the console on Home.
 */

export const DEEP_LINK_PARAMS = ['axf-target', 'axf-open'];
const SEGMENT = /^[a-z][a-z-]*:[^/]*$/;
const SETTINGS_TAB = 'settings.tabs';
const SETTINGS_SUBTAB = 'settings.subtabs';

const clip = (s) => String(s ?? '').trim().slice(0, 500);
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** `kind:id` segments joined by `/`, the first kind a word (an action id has a `.` before its first `:`). */
export function isAddressLike(s) {
  const first = String(s).split('/')[0];
  const at = first.indexOf(':');
  if (at <= 0) return false;
  return /^[a-z][a-z-]*$/.test(first.slice(0, at));
}

/** An action spec: `<module>.<name>[:args]`. */
const isActionLike = (s) => /^[a-z0-9][\w-]*(\.[\w-]+)+(:.*)?$/i.test(s);

function viewOf(address) {
  const first = address.split('/')[0];
  return first.startsWith('view:') ? first.slice(5) : undefined;
}

/** `#/<view>[/<sub>…]` → an address (bare settings subs are its tab rows; another view's bare sub is kept as `sub`). */
function fromHash(hash) {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (!path) return null;
  const parts = path.split('/').map(decode).filter(Boolean);
  const view = parts.shift();
  if (!/^[a-z0-9][\w.-]*$/i.test(view)) return { error: `"#/${path}" does not name a screen` };
  const segs = [`view:${view}`];
  let sub;
  parts.forEach((p, i) => {
    if (SEGMENT.test(p)) segs.push(p);
    else if (view === 'settings') segs.push(i === 0 ? `tab:${SETTINGS_TAB}=${p}` : `subtab:${SETTINGS_SUBTAB}=${p}`);
    else if (sub === undefined) sub = p;
  });
  return { address: segs.join('/'), view, ...(sub !== undefined ? { sub } : {}) };
}

/**
 * The link in a URL, or null. `{ address?, action?, view?, sub?, source: 'hash'|'target'|'open', raw, rest, error? }`.
 * An in-page `#anchor` (no `/` after the `#`) is not a link.
 */
export function parseDeepLink(href) {
  let u;
  try { u = new URL(String(href)); } catch { return null; }
  for (const param of DEEP_LINK_PARAMS) {
    const raw = u.searchParams.get(param);
    if (raw === null) continue;
    u.searchParams.delete(param);
    const rest = u.toString();
    const target = clip(decode(raw));
    const source = param === 'axf-target' ? 'target' : 'open';
    if (!target) return null;
    if (isAddressLike(target)) return { address: target, view: viewOf(target), source, raw: target, rest };
    if (source === 'open' && isActionLike(target)) return { action: target, source, raw: target, rest };
    return { error: `"${target}" is not a console address (like view:plan-studio-2 or view:settings/tab:settings.tabs=plugins)`, source, raw: target, rest };
  }
  if (!u.hash.startsWith('#/')) return null;
  const raw = u.hash;
  const parsed = fromHash(raw);
  if (!parsed) return null;
  u.hash = '';
  return { ...parsed, source: 'hash', raw, rest: u.toString() };
}

/**
 * What a link does: `{ view?, address? | action? }` or `{ error }`. `hasAction(id)` says whether the console has the
 * action; `isControlKind(kind)` whether console-control@1 has the kind.
 */
export function planDeepLink(link, { hasAction, isControlKind }) {
  if (!link) return null;
  if (link.error) return { error: link.error };
  if (link.action) return { action: link.action };
  const segs = link.address.split('/');
  const view = link.view;
  const own = view ? `${view}.open` : '';
  // a segment the control contract has no kind for (`plan:<id>`): the view's own open action takes its id
  const foreign = segs.slice(1).find((s) => !isControlKind(s.slice(0, s.indexOf(':'))));
  if (foreign) {
    const id = foreign.slice(foreign.indexOf(':') + 1);
    if (view && hasAction(own)) return { view, action: `${own}:${id}` };
    return { view, error: `${view ? `"${view}"` : 'This screen'} cannot open "${foreign}"` };
  }
  if (link.sub !== undefined) {
    if (view && hasAction(own)) return { view, action: `${own}:${link.sub}` };
    return { view, address: link.address };
  }
  return { ...(view ? { view } : {}), address: link.address };
}

/**
 * The newest link waiting for its screen. `isReady(view, plan)` → true once it can open (its view registered);
 * `open(plan)` runs it; `notice(message)` when it gave up. Returns `{ push(plan, label), poke(), size(), stop() }`.
 */
export function createPendingTargets({ isReady, open, notice, timeoutMs = 8000, pollMs = 100, now = () => Date.now() }) {
  let waiting = null; // { plan, label, until }
  let timer = null;
  const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
  const check = () => {
    if (!waiting) { stopTimer(); return; }
    const w = waiting;
    let ready = false;
    try { ready = !!isReady(w.plan.view ?? null, w.plan); } catch { ready = false; }
    if (ready) { waiting = null; stopTimer(); open(w.plan); return; }
    if (now() >= w.until) { waiting = null; stopTimer(); notice(`Could not open ${w.label}: ${w.plan.view ? `the "${w.plan.view}" screen is not here (its plugin may be off or not installed)` : 'nothing here answers it'}.`); }
  };
  return {
    push(plan, label) {
      waiting = { plan, label: label || plan.address || plan.action || plan.view || 'the link', until: now() + timeoutMs };
      if (!timer) timer = setInterval(check, pollMs);
      check();
    },
    poke: check,
    size: () => (waiting ? 1 : 0),
    stop() { waiting = null; stopTimer(); },
  };
}
