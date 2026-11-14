/**
 * Themed scrollbars (themed-controls@1 family `scrollbar`): the root class `fx-tc-scroll` turns on the framework's
 * scrollbar rules (framework/ui/axf.css: ::-webkit-scrollbar in Chromium / Safari, scrollbar-color / -width elsewhere,
 * every colour and size a --fx-tc-scrollbar-* token). Desktop only: on touch (coarse pointer, no hover) the overlay
 * scrollbars are native and nothing is added; a device that changes (a tablet with a mouse) follows at once.
 * The boolean tokens thin / autoHide become the classes fx-tc-scroll--thin / --autohide.
 */
import type { AxfRuntime } from '@console/axf/core';
import { scrollbarsThemed } from '@console/axf/core/engines/themed-controls';
import type { GlobalFamily, LiveHost } from '../host';

const ROOT = 'fx-tc-scroll';
const on = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() === '1';
let applied = false;

export const scrollbarFamily: GlobalFamily = {
  family: 'scrollbar',
  start(rt: AxfRuntime, host: LiveHost) {
    const root = document.documentElement;
    const mqs = ['(pointer: coarse)', '(hover: hover)'].map((q) => globalThis.matchMedia?.(q)).filter((m): m is MediaQueryList => !!m);
    const apply = () => {
      applied = scrollbarsThemed(host.config(), host.viewport());
      root.classList.toggle(ROOT, applied);
      root.classList.toggle(`${ROOT}--thin`, applied && on('--fx-tc-scrollbar-thin'));
      root.classList.toggle(`${ROOT}--autohide`, applied && on('--fx-tc-scrollbar-auto-hide'));
    };
    apply();
    for (const m of mqs) m.addEventListener('change', apply);
    // the tokens can change with a theme swap: re-read the boolean ones when the root's style changes
    const obs = new MutationObserver(apply);
    obs.observe(root, { attributes: true, attributeFilter: ['style', 'data-fx-scheme'] });
    void rt;
    return () => {
      for (const m of mqs) m.removeEventListener('change', apply);
      obs.disconnect();
      root.classList.remove(ROOT, `${ROOT}--thin`, `${ROOT}--autohide`);
      applied = false;
    };
  },
  report: () => ({ themed: applied, reason: applied ? 'desktop' : 'touch device: native overlay scrollbars' }),
};
