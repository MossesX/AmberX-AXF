/**
 * deep-link@1 in the browser: when the app loads with `?axf-view=… &axf-dialog=… &axf-settings=… &axf-do=…`
 * (framework/core/engines/deep-link.mjs), open that view, dialog and settings tab, then run the actions in order, and
 * take the params out of the address bar. Installed for every app by <AxfProvider>.
 *
 * A plugin that loads lazily may not have registered its actions yet when the page starts: each action waits for its
 * handler (polling, up to `waitMs`) before it runs. Only actions whose effect is navigate or read run from a link;
 * anything else is refused with a toast that says why (deepLinkRefusal).
 */
import type { AxfRuntime } from '../core';
import { deepLinkRefusal, parseDeepLink, stripDeepLink } from '../core/engines/deep-link.mjs';

export interface DeepLinkResult { view: string; dialog: string; settings: string; ran: string[]; refused: { spec: string; why: string }[]; errors: string[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Apply one deep link (a location.search string) to a runtime. Resolves with what happened. */
export async function applyDeepLink(rt: AxfRuntime, search: string, { waitMs = 8000, stepMs = 200 } = {}): Promise<DeepLinkResult> {
  const p = parseDeepLink(search);
  const res: DeepLinkResult = { view: p.view, dialog: p.dialog, settings: p.settings, ran: [], refused: [], errors: [...p.errors] };
  if (p.view) rt.navigate(p.view);
  if (p.settings) rt.dispatch(`settings.open:${p.settings}`);
  if (p.dialog) rt.openDialog(p.dialog);
  for (const spec of p.do) {
    const id = spec.split(':')[0]!;
    let meta = rt.actions.list().find((a) => a.id === id)?.meta;
    for (let t = 0; !meta && t < waitMs; t += stepMs) { await sleep(stepMs); meta = rt.actions.list().find((a) => a.id === id)?.meta; }
    const why = deepLinkRefusal(meta);
    if (why) { res.refused.push({ spec, why }); continue; }
    if (rt.dispatch(spec)) res.ran.push(spec); else res.refused.push({ spec, why: 'did not run here (no handler, or this role cannot)' });
  }
  for (const r of res.refused) rt.toast(`${r.spec}: ${r.why}`, 'warning', 'Link');
  for (const e of res.errors) rt.toast(e, 'warning', 'Link');
  return res;
}

/** Read the page's own address once; the params are taken out so a reload doesn't run the link again. */
// the link this page was opened with, kept until it has run (React's strict mode mounts twice: the first mount takes it
// out of the address bar, the second must still run it)
let pending: string | null = null;
let taken = false;

export function installDeepLinks(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined' || !window.location) return () => undefined;
  if (!taken) {
    taken = true;
    const { search, pathname, hash } = window.location;
    const p = parseDeepLink(search);
    if (!p.view && !p.dialog && !p.settings && !p.do.length && !p.errors.length) return () => undefined;
    pending = search;
    try { window.history.replaceState(window.history.state, '', `${pathname}${stripDeepLink(search)}${hash}`); } catch { /* sandboxed frame */ }
  }
  if (pending == null) return () => undefined;
  // after the first render, so the views and the lazy plugins' stand-ins are installed
  const t = setTimeout(() => { const s = pending; pending = null; if (s) void applyDeepLink(rt, s); }, 0);
  return () => clearTimeout(t);
}
