/*
 * The saved overrides, live in the console: the server's preview plan (lib/core.mjs preview → ui-manager-rules
 * previewPlan) is CSS on --fx-* tokens scoped to each element's root (a colour is var(--fx-<token>), never a
 * literal), applied in one stylesheet. Re-read after every change the window, an action or the API makes.
 */
import { fetchJson } from './useElements';

const STYLE_ID = 'axp-uim-overrides';

/** The CSS in force now (saved plan or the window's draft), and who mirrors it (the preview window). */
let current = '';
const cssListeners = new Set<(css: string) => void>();
export const currentCss = () => current;
export const onCss = (f: (css: string) => void) => { cssListeners.add(f); return () => { cssListeners.delete(f); }; };

export function applyCss(css: string): void {
  if (css !== current) { current = css; cssListeners.forEach((f) => f(css)); }
  if (typeof document === 'undefined') return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
  if (el.textContent !== css) el.textContent = css;
}

/** Fetch the saved plan and apply it. Returns the CSS (empty when nothing is overridden or the server is off). */
export async function refreshLive(): Promise<string> {
  try {
    const plan = await fetchJson<{ css?: string; error?: string }>('preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const css = plan.error ? '' : plan.css ?? '';
    applyCss(css);
    return css;
  } catch { return ''; }
}
