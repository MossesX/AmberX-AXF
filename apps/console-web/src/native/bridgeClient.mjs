// window.axfNative, native-bridge@1: the console's side of the Android console app's native bridge
// (apps/console-droid/BRIDGE.md, BridgeContract.java). Pure: everything takes the window it works on, so
// bridgeClient.test.mjs runs it in Node against a fake host.
//
// The shell exposes one Java object, window.axfBridgeHost, with one method, call(json). A call is
// { id, tool, args }; the answer comes back as a CustomEvent 'axf-native' on window whose detail is
// { id, tool, ok, data } or { id, tool, ok: false, error: { code, message, permissions? } }; native events arrive the
// same way as { event, data }. This module turns that into
//
//   await window.axfNative.call('recorder.start', { session_name: 'Build night' })   // a Promise
//   const off = window.axfNative.on('recorder', (data) => …)
//
// Part 1 of the console app (build console-android-app-thin-webview-wrapper) has its own synchronous host,
// window.axfNativeHost, with one method per feature (info(), overlay(verb), …) and puts a window.axfNative of its own
// in place. The two live side by side: whichever object lands on window.axfNative, it ends up with both — the bridge
// tools answer Promises, part 1's method names (LEGACY_METHODS) keep their synchronous answers.

export const BRIDGE_VERSION = 'native-bridge@1';
export const BRIDGE_HOST = 'axfBridgeHost';
export const BRIDGE_EVENT = 'axf-native';
export const READY_EVENT = 'axf-native-ready';
/** A call that has no answer after this long rejects with code 'timeout' (a permission prompt can take a while). */
export const CALL_TIMEOUT_MS = 120000;

/** Mirrors BridgeContract.TOOLS. */
export const TOOLS = [
  'bridge.ping', 'bridge.info', 'bridge.capabilities', 'permissions.status', 'permissions.request', 'mic.status', 'mic.set',
  'recorder.start', 'recorder.stop', 'recorder.status', 'browser.open', 'console.wake', 'notify.show', 'notify.cancel', 'notify.status',
];
/** Mirrors BridgeContract.EVENTS. */
export const EVENTS = ['recorder', 'mic', 'permission', 'wake', 'link'];
/** Mirrors BridgeContract.CODES, plus the two the page side adds. */
export const ERROR_CODES = ['unknown_tool', 'bad_args', 'denied', 'permission', 'unavailable', 'not_implemented', 'timeout', 'no_bridge'];

/** Mirrors BridgeContract's alias table: axHub's MCP names, AmberX's names, the console's snake_case spellings. */
const ALIASES = {
  'browser.open': ['amberx.open_url', 'open_url', 'open-url', 'browser_open', 'console.open_url'],
  'recorder.start': ['amberx.recorder_start', 'recorder_start', 'recorder-start'],
  'recorder.stop': ['amberx.recorder_stop', 'recorder_stop', 'recorder-stop'],
  'recorder.status': ['amberx.recorder_status', 'recorder_status', 'recorder-status'],
  'console.wake': ['amberx.wake', 'amberx.console_wake', 'console_wake', 'console-wake', 'wake'],
  'notify.show': ['amberx.notify', 'notify', 'notify_show', 'notification.show'],
  'notify.cancel': ['notify_cancel', 'notification.cancel'],
  'notify.status': ['notify_status', 'notification.status'],
  'mic.status': ['mic_status', 'amberx.mic_status'],
  'mic.set': ['mic_set', 'amberx.mic_set', 'mic.on', 'mic.off'],
  'permissions.status': ['permissions_status', 'permissions'],
  'permissions.request': ['permissions_request'],
  'bridge.info': ['info', 'bridge_info', 'version'],
  'bridge.ping': ['ping'],
  'bridge.capabilities': ['capabilities', 'bridge_capabilities'],
};
const ALIAS = new Map(Object.entries(ALIASES).flatMap(([tool, names]) => names.map((n) => [n, tool])));

/** Part 1's synchronous host methods (apps/console-web/src/native/axfNative.ts there); these keep going to it. */
export const LEGACY_METHODS = [
  'info', 'permissions', 'requestPermission', 'notify', 'cancelNotification', 'openUrl', 'wake', 'overlay', 'overlayState',
  'overlayConfigure', 'overlayApprovals', 'theme', 'insets', 'insetsHandled', 'recorder', 'update',
];

/** The bridge tool a name means (any alias, any case), or null: the same answer as BridgeContract.tool(). */
export function toolOf(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (TOOLS.includes(s)) return s;
  if (ALIAS.has(s)) return ALIAS.get(s);
  if (s.startsWith('amberx.')) return toolOf(s.slice('amberx.'.length));
  const dotted = s.replace(/_/g, '.');
  return TOOLS.includes(dotted) ? dotted : null;
}

/** mic.on / mic.off carry their argument in the name (BridgeContract.argsFor). */
export function argsFor(raw, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'mic.on') a.on = true;
  if (s === 'mic.off') a.on = false;
  return a;
}

/** An Error carrying the bridge's code (and the permissions to ask for when the code is 'permission'). */
export function bridgeError(code, message, permissions) {
  const e = new Error(message || code);
  e.code = code;
  if (permissions) e.permissions = permissions;
  return e;
}

/** True when this page runs inside the console app with the native-bridge@1 host. */
export function bridgeAvailable(win) {
  return !!(win && win[BRIDGE_HOST] && typeof win[BRIDGE_HOST].call === 'function');
}

/**
 * Builds the bridge client over win.axfBridgeHost: { version, call(tool, args), on(event, fn), tools, available }.
 * Exported for tests; installBridge puts it on window.axfNative.
 */
export function createBridge(win, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const host = win[BRIDGE_HOST];
  const pending = new Map();
  const listeners = new Map();
  let n = 0;

  const onMessage = (ev) => {
    const m = (ev && ev.detail) || {};
    if (typeof m.id === 'string' && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.data ?? {});
      else p.reject(bridgeError(m.error?.code || 'unavailable', m.error?.message || 'failed', m.error?.permissions));
      return;
    }
    if (typeof m.event === 'string') {
      for (const fn of [...(listeners.get(m.event) || []), ...(listeners.get('*') || [])]) {
        try { fn(m.data ?? {}, m.event); } catch { /* one listener never breaks the rest */ }
      }
    }
  };
  win.addEventListener(BRIDGE_EVENT, onMessage);

  function call(name, args) {
    const tool = toolOf(name);
    if (!tool) return Promise.reject(bridgeError('unknown_tool', `The console app doesn't know "${String(name)}".`));
    return new Promise((resolve, reject) => {
      const id = `c${++n}-${Date.now().toString(36)}`;
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(bridgeError('timeout', `The console app didn't answer ${tool}.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { host.call(JSON.stringify({ id, tool, args: argsFor(name, args) })); }
      catch (e) { pending.delete(id); clearTimeout(timer); reject(bridgeError('unavailable', String(e?.message ?? e))); }
    });
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => { listeners.get(event)?.delete(fn); };
  }

  function dispose() {
    win.removeEventListener(BRIDGE_EVENT, onMessage);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(bridgeError('unavailable', 'The page closed the bridge.')); }
    pending.clear();
  }

  return { version: BRIDGE_VERSION, available: true, tools: [...TOOLS], events: [...EVENTS], call, on, dispose, pendingCount: () => pending.size };
}

/**
 * Merges the bridge into whatever object part 1 put on window.axfNative: its `call(method, …)` stays for
 * LEGACY_METHODS (synchronous, as part 1 wrote it), every bridge tool answers a Promise; `on` listens to both.
 */
export function mergeBridge(bridge, prev) {
  if (!prev || prev === bridge || prev.version === BRIDGE_VERSION) return bridge;
  const legacyCall = typeof prev.call === 'function' ? prev.call.bind(prev) : null;
  const legacyOn = typeof prev.on === 'function' ? prev.on.bind(prev) : null;
  return {
    ...prev,
    ...bridge,
    call(name, ...rest) {
      if (legacyCall && LEGACY_METHODS.includes(name) && (rest.length !== 1 || typeof rest[0] !== 'object' || rest[0] === null)) return legacyCall(name, ...rest);
      return bridge.call(name, rest[0]);
    },
    on(event, fn) {
      const a = bridge.on(event, fn);
      const b = legacyOn ? legacyOn(event, fn) : null;
      return () => { a(); if (typeof b === 'function') b(); };
    },
    legacy: prev,
  };
}

/**
 * Puts window.axfNative on the page when the shell's native-bridge@1 host is there, keeps it merged when another
 * script assigns window.axfNative later, and fires 'axf-native-ready' once. Outside the app it does nothing (a
 * desktop browser has no window.axfNative). Returns a remover.
 */
export function installBridge(win, opts) {
  if (!win || !bridgeAvailable(win)) return () => {};
  const existing = win.axfNative;
  if (existing && existing.version === BRIDGE_VERSION && existing.__installed) return () => {};
  const bridge = createBridge(win, opts);
  let current = mergeBridge(bridge, existing && existing.version !== BRIDGE_VERSION ? existing : null);
  Object.defineProperty(current, '__installed', { value: true, enumerable: false });
  Object.defineProperty(win, 'axfNative', {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (v) => {
      // part 1 (or anyone else) assigns its own object: keep both
      current = v ? mergeBridge(bridge, v) : bridge;
      if (!Object.prototype.hasOwnProperty.call(current, '__installed')) Object.defineProperty(current, '__installed', { value: true, enumerable: false });
    },
  });
  try { win.dispatchEvent(new win.CustomEvent(READY_EVENT, { detail: { version: BRIDGE_VERSION } })); } catch { /* no CustomEvent: nobody to tell */ }
  return () => {
    bridge.dispose();
    delete win.axfNative;
  };
}

/**
 * One bridge call from console code, without caring where it runs: inside the app it goes to the phone, outside it
 * rejects with code 'no_bridge' so the caller can say the phone app isn't here.
 */
export function nativeTool(win, name, args) {
  const b = win && win.axfNative;
  if (!b || b.version !== BRIDGE_VERSION) return Promise.reject(bridgeError('no_bridge', 'The Android console app is not running this page.'));
  return b.call(name, args);
}

/** How long requestPermission waits for Android's prompt to be answered before giving up. */
export const PERMISSION_WAIT_MS = 60000;

/**
 * Asks the phone for one permission ('mic' | 'notifications' | 'overlay') and resolves with whether it is granted:
 * at once when it already was, else when the 'permission' event for it comes back from Android's prompt (or the
 * overlay settings screen), else false after `waitMs`.
 */
export async function requestPermission(win, permission, { waitMs = PERMISSION_WAIT_MS } = {}) {
  const b = win && win.axfNative;
  if (!b || b.version !== BRIDGE_VERSION) throw bridgeError('no_bridge', 'The Android console app is not running this page.');
  let off = () => {};
  let cancel = () => {};
  const answered = new Promise((resolve) => {
    const timer = setTimeout(() => { off(); resolve(false); }, waitMs);
    off = b.on('permission', (d) => {
      if (d && d.permission === permission) { clearTimeout(timer); off(); resolve(!!d.granted); }
    });
    cancel = () => { clearTimeout(timer); off(); resolve(false); };
  });
  let first;
  try { first = await b.call('permissions.request', { permission }); }
  catch (e) { cancel(); throw e; }
  if (first && first.granted) { cancel(); return true; }
  return answered;
}

/**
 * Runs a tool; when it answers 'permission', asks for each missing permission and tries once more. The second
 * failure (a "no" on the prompt) is the caller's error, with its code and permissions.
 */
export async function callWithPermissions(win, name, args, opts) {
  try { return await nativeTool(win, name, args); }
  catch (e) {
    if (e?.code !== 'permission' || !Array.isArray(e.permissions) || !e.permissions.length) throw e;
    for (const p of e.permissions) {
      if (!(await requestPermission(win, p, opts))) throw bridgeError('permission', `Permission "${p}" was not given.`, [p]);
    }
    return nativeTool(win, name, args);
  }
}
