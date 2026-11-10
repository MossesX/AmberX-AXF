/**
 * `?axf-action=<action id>[:args]`: a link that opens something in the console once it has started (an AmberX
 * notification's tap, a shared link). Any plugin's navigate action works, loaded or not: a lazy plugin's stand-in action
 * loads it and runs the real one (pluginLoader.tsx). Only actions marked `effect: 'navigate'` run from a link, so a link
 * can open a screen but never change anything. The parameter is taken off the address once read.
 */
import type { AxfRuntime } from './axf/core';

export const URL_ACTION_PARAM = 'axf-action';
const SPEC = /^[A-Za-z0-9][\w.-]{0,79}(:[^\s]{1,300})?$/;

/** The action this page was opened for, or '' (and removes it from the address). */
export function takeUrlAction(win: { location: { href: string }; history: History } | undefined = globalThis.window): string {
  if (!win) return '';
  try {
    const u = new URL(win.location.href);
    const spec = (u.searchParams.get(URL_ACTION_PARAM) ?? '').trim();
    if (!spec) return '';
    u.searchParams.delete(URL_ACTION_PARAM);
    win.history.replaceState(win.history.state, '', u.toString());
    return SPEC.test(spec) ? spec : '';
  } catch { return ''; }
}

/** Run it when its action is registered (plugins register while the console starts); navigate actions only. */
export function runUrlAction(rt: AxfRuntime, spec: string, { tries = 60, everyMs = 500 } = {}): void {
  const id = spec.split(':')[0] ?? '';
  const go = (left: number) => {
    const h = rt.actions.get(id);
    if (h) {
      if (h.meta.effect === 'navigate') rt.dispatch(spec);
      else rt.toast(`${h.meta.label} can't be run from a link.`, 'warning', 'Link not opened');
      return;
    }
    if (left > 0) setTimeout(() => go(left - 1), everyMs);
    else rt.toast(`Nothing in this console opens ${id}.`, 'warning', 'Link not opened');
  };
  go(tries);
}
