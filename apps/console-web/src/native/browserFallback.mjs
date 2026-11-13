// The console outside the Android console app (console app part 4, Brett Nov 13 2026). Pure: everything takes the
// window or the answers it needs, so browserFallback.test.mjs runs it in Node.
//
// - wrapperEnv(win): is this page inside the console app, and which native hosts are there. Part 1's synchronous
//   host is window.axfNativeHost, part 3's asynchronous native-bridge@1 host is window.axfBridgeHost; either one
//   means "in the app". The console marks <html data-axf-wrapper="app|browser"> from it.
// - browserPlan(id, args): what a native.* console action does in a plain browser. Notifications, links,
//   permissions, focus and updates have a web equivalent; the floating overlay and the recorder only exist in the
//   app and say so. The same parser as the app (nativeCall) checks the arguments, so a bad call fails the same way.
import { nativeCall } from './nativeRules.mjs';

export const WRAPPER_HOSTS = ['axfNativeHost', 'axfBridgeHost'];
export const WRAPPER_ATTR = 'data-axf-wrapper';
export const APP_ONLY = 'needs the Android console app';

/** Which native hosts the page has. */
export function wrapperEnv(win) {
  const hosts = WRAPPER_HOSTS.filter((h) => !!(win && win[h]));
  return { wrapper: hosts.length > 0, hosts, mode: hosts.length > 0 ? 'app' : 'browser' };
}

/** Is a URL on this console's own origin (opens in place) or somewhere else (new tab)? */
export function sameOrigin(url, origin) {
  try { return new URL(url, origin).origin === origin; } catch { return false; }
}

/**
 * The browser's way to run one native.* action: a plan the page carries out, or an error to show.
 * Plans: notify {title, text}, open {url, target}, permission {name}, focus, update {verb}, state.
 */
export function browserPlan(id, args, origin = '') {
  const c = nativeCall(id, args);
  if ('error' in c) return { error: c.error };
  switch (c.call) {
    case 'notify': {
      const n = JSON.parse(String(c.args[0]));
      return { do: 'notify', title: n.title, text: n.text };
    }
    case 'openUrl': {
      const [url, where] = c.args;
      const inPlace = where === 'app' && sameOrigin(url, origin);
      return { do: 'open', url, target: inPlace ? '_self' : '_blank' };
    }
    case 'requestPermission':
      return c.args[0] === 'overlay' ? { error: `drawing over other apps ${APP_ONLY}` } : { do: 'permission', name: c.args[0] };
    case 'wake': return { do: 'focus' };
    case 'update': return { do: 'update', verb: c.args[0] };
    case 'state': return { do: 'state' };
    case 'overlay': return { error: `the floating toolbar ${APP_ONLY}` };
    case 'recorder': return { error: `the phone recorder ${APP_ONLY}` };
    default: return { error: `${id} ${APP_ONLY}` };
  }
}

/** What the browser itself can do, for native.state and panel:phone-app outside the app. */
export function browserCapabilities(win) {
  const N = win?.Notification;
  return {
    notifications: N ? String(N.permission ?? 'default') : 'unsupported',
    mic: !!win?.navigator?.mediaDevices?.getUserMedia,
    standalone: !!win?.matchMedia?.('(display-mode: standalone)')?.matches,
  };
}
