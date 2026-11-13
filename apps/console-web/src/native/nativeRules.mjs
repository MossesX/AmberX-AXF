/**
 * The console side of the Android console app (apps/console-droid), pure part: no DOM, no runtime, so
 * `node apps/console-web/src/native/nativeRules.test.mjs` checks it.
 *
 * Brett, Nov 13 2026: "make the console an Android app, just a wrapper for the web app, keep it floating on top".
 * The shell exposes `window.axfNativeHost` (Java `NativeBridge`, JSON-string answers); the console wraps it as
 * `window.axfNative` and turns every native feature into a console action (`native.*`), so REST, MCP, the CLI and voice
 * reach the phone the same way as everything else.
 */

/** The deep-link parameter the shell opens (`axf-console://open/<target>` → `?axf-open=<target>`). */
export const OPEN_PARAM = 'axf-open';

/** The overlay settings the shell reads (the console's own settings, Settings → Plugins → Approvals banner). */
export const OVERLAY_SETTING_PREFIX = 'approvals-banner.overlay.';
export const OVERLAY_SETTINGS = ['on', 'edge', 'top', 'size', 'expand', 'idleOpacity'];

/** The counter the overlay's approvals badge follows (toolbar items show it as `badge: approvals.waiting`). */
export const WAITING_BADGE = 'approvals.waiting';

/** The console-control@1 target whose `state` is the phone app's state (shell, permissions, overlay, insets). */
export const PHONE_APP_ADDRESS = 'panel:phone-app';

/** What the approval bar's "Open approvals" link runs. */
export const APPROVALS_TARGET = 'approvals.view';

/** The --fx-* tokens the native toolbar takes its look from (= Java ShellTheme.TOKENS). */
export const THEME_TOKENS = ['--fx-surface', '--fx-text', '--fx-accent', '--fx-accent-text', '--fx-muted', '--fx-radius-md', '--fx-space', '--fx-font-size'];

/** The safe-area tokens the shell sets on <html> (= Java InsetsCss.TOKENS, framework/ui/axf.css). */
export const SAFE_TOKENS = ['--fx-safe-top', '--fx-safe-right', '--fx-safe-bottom', '--fx-safe-left'];

export const OVERLAY_VERBS = ['expand', 'collapse', 'toggle', 'approvals', 'dismiss'];
export const PERMISSIONS = ['mic', 'notifications', 'overlay'];
export const RECORDER_VERBS = ['start', 'stop', 'state'];

/**
 * The deep-link target on a URL and the URL without it: `{ target, kind, rest }` or null.
 * `kind`: 'address' for a console-control@1 address (`view:builds`, `settings:plugins/tab:x`), 'action' for an action
 * id (`approvals.view`, `settings.set:key:value`).
 */
export function openTarget(href) {
  let u;
  try { u = new URL(String(href)); } catch { return null; }
  const raw = u.searchParams.get(OPEN_PARAM);
  if (raw === null) return null;
  u.searchParams.delete(OPEN_PARAM);
  const target = raw.trim().slice(0, 500);
  if (!target) return { target: '', kind: 'none', rest: u.toString() };
  return { target, kind: isAddress(target) ? 'address' : 'action', rest: u.toString() };
}

/** `kind:id` segments joined by `/`, the first kind a word (an action id has no `:` before its first `.`). */
export function isAddress(s) {
  const first = String(s).split('/')[0];
  const at = first.indexOf(':');
  if (at <= 0) return false;
  const kind = first.slice(0, at);
  return /^[a-z][a-z-]*$/.test(kind) && !kind.includes('.');
}

/** The overlay settings for the shell from a settings getter: `{ on, edge, … }`, only the ones that are set. */
export function overlayConfig(get) {
  const out = {};
  for (const k of OVERLAY_SETTINGS) {
    const v = get(OVERLAY_SETTING_PREFIX + k);
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** The theme tokens from a computed-style getter, only non-empty values. */
export function themeTokens(read) {
  const out = {};
  for (const t of THEME_TOKENS) { const v = String(read(t) ?? '').trim(); if (v) out[t] = v; }
  return out;
}

/** True when the page's CSS declares the safe-area tokens (so it pads itself and the shell may stop padding it). */
export function pageHandlesInsets(read) {
  return SAFE_TOKENS.every((t) => String(read(t) ?? '').trim() !== '');
}

/** A JSON answer from the host (`{"ok":true,…}`), never throws. */
export function parseAnswer(s) {
  if (typeof s !== 'string') return { ok: false, error: 'no answer' };
  try { const j = JSON.parse(s); return j && typeof j === 'object' ? j : { ok: false, error: 'bad answer' }; } catch { return { ok: false, error: 'bad answer' }; }
}

/**
 * One `native.*` action → what to ask the host: `{ call, args }` or `{ error }`.
 *   native.overlay:<expand|collapse|toggle|approvals|dismiss>
 *   native.permission:<mic|notifications|overlay>
 *   native.notify:<title>[:<text>]
 *   native.open:<url>[|app|overlay|browser]   (the url carries its own colons: "where" is after a final "|")
 *   native.wake
 *   native.recorder:<start|stop|state>
 *   native.state
 */
export function nativeCall(id, args) {
  const a = (args ?? []).map(String);
  const joined = a.join(':');
  switch (id) {
    case 'native.overlay': return OVERLAY_VERBS.includes(a[0]) ? { call: 'overlay', args: [a[0]] } : { error: `native.overlay takes ${OVERLAY_VERBS.join(', ')}` };
    case 'native.permission': return PERMISSIONS.includes(a[0]) ? { call: 'requestPermission', args: [a[0]] } : { error: `native.permission takes ${PERMISSIONS.join(', ')}` };
    case 'native.notify': {
      const [title = '', ...text] = a;
      if (!title.trim()) return { error: 'native.notify:<title>[:<text>]' };
      return { call: 'notify', args: [JSON.stringify({ id: `console-${title.trim().slice(0, 40)}`, title: title.trim(), text: text.join(':').trim() })] };
    }
    case 'native.open': {
      const bar = joined.lastIndexOf('|');
      const url = (bar >= 0 ? joined.slice(0, bar) : joined).trim();
      const where = bar >= 0 ? joined.slice(bar + 1).trim() : 'app';
      if (!url) return { error: 'native.open:<url>[|app|overlay|browser]' };
      if (!['app', 'overlay', 'browser'].includes(where)) return { error: 'where is app, overlay or browser' };
      return { call: 'openUrl', args: [url, where] };
    }
    case 'native.wake': return { call: 'wake', args: [] };
    case 'native.recorder': return RECORDER_VERBS.includes(a[0]) ? { call: 'recorder', args: [a[0]] } : { error: `native.recorder takes ${RECORDER_VERBS.join(', ')}` };
    case 'native.state': return { call: 'state', args: [] };
    default: return { error: `unknown native action ${id}` };
  }
}

/** Every native action, for registration and the docs (id, label, takes params). */
export const NATIVE_ACTIONS = [
  { id: 'native.overlay', label: 'Phone overlay: expand, collapse, toggle, approvals, dismiss (native.overlay:<verb>)', params: true },
  { id: 'native.permission', label: 'Ask the phone for a permission: mic, notifications, overlay (native.permission:<name>)', params: true },
  { id: 'native.notify', label: 'Phone notification (native.notify:<title>:<text>)', params: true },
  { id: 'native.open', label: 'Open a page on the phone (native.open:<url>|app|overlay|browser)', params: true },
  { id: 'native.wake', label: 'Bring the console to the front on the phone and turn the screen on', params: false },
  { id: 'native.recorder', label: 'Phone recorder: start, stop, state (native.recorder:<verb>)', params: true },
  { id: 'native.state', label: 'Phone app state: shell version, permissions, overlay, insets', params: false },
];
