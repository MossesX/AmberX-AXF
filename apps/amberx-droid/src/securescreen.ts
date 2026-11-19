/**
 * Screen capture (Oct 31 2026, Brett: Android said it "can't record due to security policy").
 *
 * AmberX's window used to carry FLAG_SECURE on every screen, which blocked Android's screen recorder, screenshots and
 * AmberX's own recorder (Audio Extract). Now it never does on a normal screen. One opt-in setting, **Hide sensitive
 * screens from recordings** (Settings → Account & security, off by default), hides the window only while a password,
 * key or vault field is on screen (`input[type=password]`, or anything marked `data-amberx-sensitive`). The native side
 * (`SecureScreen.java`) sets the flag only when both are true.
 */
import type { AxfRuntime } from './axf/core';
import type { AxfWebLibrary } from './axf/react';
import { isNative, native } from './native';

export const K = { hideSensitive: 'amberx.privacy.hideSensitive' } as const;

/** What on a page counts as a password / key / vault screen. */
export const SENSITIVE_SELECTOR = 'input[type="password"], [data-amberx-sensitive]';

/** Is a password / key / vault field showing in this part of the page? */
export const isSensitive = (root: { querySelector(sel: string): unknown } | null | undefined): boolean =>
  !!root && root.querySelector(SENSITIVE_SELECTOR) != null;

/** Hidden from recordings only when the person opted in and a sensitive screen is up. */
export const secureWanted = (hide: unknown, sensitive: boolean): boolean => hide === true && sensitive;

function watch(rt: AxfRuntime) {
  if (!isNative() || typeof document === 'undefined') return;
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    timer = null;
    const hide = rt.settings.get(K.hideSensitive) === true;
    const sensitive = hide && isSensitive(document.body);
    const next = `${hide}:${sensitive}`;
    if (next === last) return; // same as before = no native call
    last = next;
    void native.secureScreen({ hide, sensitive }).catch(() => undefined);
  };
  const soon = () => { if (!timer) timer = setTimeout(send, 150); };
  rt.subscribe(soon);
  const start = () => new MutationObserver(soon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'data-amberx-sensitive'] });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  send();
}

export const secureScreenLibrary: AxfWebLibrary = {
  id: 'ai.amberx.amberx.securescreen',
  label: 'Screen capture',
  version: '0.1.0',
  settings: [
    {
      id: 'amberx.privacy', label: 'Screen recording', icon: 'eye', tab: 'account', order: 50, settings: [
        {
          key: K.hideSensitive, label: 'Hide sensitive screens from recordings', kind: 'toggle', default: false,
          description: 'Off: screenshots and screen recording (Android\'s and AmberX\'s own) work everywhere. On: only screens showing a password, key or vault field are hidden from them.',
        },
      ],
    },
  ],
  register(rt) { watch(rt); },
};
