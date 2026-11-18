/**
 * Console deep links in the page (pure rules: ./deepLink-core.mjs; tests: scripts/deeplink.test.mjs).
 *
 *   #/<view>[/<sub>…]  ?axf-target=<address>  ?axf-open=<address|action>
 *
 * The link is read when this module loads, before the first render, and taken off the address bar. Once the console
 * runtime is up it waits (pending-target queue) until the screen it names has registered: plugin pages load lazily, so a
 * plugin's view can arrive seconds after the shell. Then it navigates and opens the address through the console-control
 * executor (which highlights what it opened) or runs the console action the address stands for (`view:plan-studio-2/
 * plan:<id>` → `plan-studio-2.open:<id>`). A target that never arrives is a notice, never a silent landing on Home.
 * `hashchange` / `popstate` follow a link while the console is open. `window.axfDeepLink(url)` follows one by hand
 * (tests, devtools); `followDeepLink(rt, url)` is the same for the console-control `open` of a URL.
 */
import type { AxfRuntime } from '../axf/core';
import { isConsoleControlKind } from '../axf/core/engines/console-control';
import { controlRegistry } from '../axf/react';
import { createPendingTargets, parseDeepLink, planDeepLink, type DeepLink, type DeepLinkPlan } from './deepLink-core.mjs';
import { controlState, describeAnswer, executeControl, setLinkOpener, type ControlAnswer } from './executor';
import { PALETTE_VIEW, openPalette } from './SearchPalette';
import { inventory } from './inventory';
import { bundledPlugins } from '../plugins';
import { loader } from '../pluginLoader';

const TITLE = 'Link';
/** What the resolver did, newest last (window.axfDeepLinkLog: tests, devtools). */
const log: string[] = [];
const note = (m: string) => { log.push(`${Math.round(typeof performance !== 'undefined' ? performance.now() : 0)}ms ${m}`); if (log.length > 40) log.shift(); };
if (typeof window !== 'undefined') (window as unknown as { axfDeepLinkLog?: string[] }).axfDeepLinkLog = log;

/** Read and take the link off the address bar (once, before the first render). */
function capture(): DeepLink | null {
  if (typeof window === 'undefined') return null;
  const link = parseDeepLink(window.location.href);
  if (link) note(`captured ${link.raw}`);
  if (link) { try { window.history.replaceState(window.history.state, '', link.rest); } catch { /* sandboxed frame */ } }
  return link;
}
let initial: DeepLink | null = capture();

/** The link this page was opened with (read before the first render), or null. */
export const initialDeepLink = (): DeepLink | null => initial;

const viewReady = (rt: AxfRuntime, view: string) => controlRegistry(rt).snapshot().targets.some((t) => t.address === `view:${view}`);
const actionId = (spec: string) => spec.split(':')[0]!;

function planFor(rt: AxfRuntime, link: DeepLink): DeepLinkPlan | null {
  return planDeepLink(link, { hasAction: (id) => !!rt.actions.get(id), isControlKind: (k) => isConsoleControlKind(k) });
}

/** Run a ready plan: navigate, then the address (highlighted by the executor) or the action. */
async function run(rt: AxfRuntime, link: DeepLink): Promise<string> {
  const plan = planFor(rt, link);
  note(`run ${link.raw} → ${JSON.stringify(plan)}`);
  if (!plan) return 'nothing to open';
  if (plan.error) { rt.toast(plan.error, 'warning', TITLE); return plan.error; }
  if (plan.action) {
    const known = rt.actions.get(actionId(plan.action));
    if (!known) { const m = `Nothing called "${plan.action}" to open here.`; rt.toast(m, 'warning', TITLE); return m; }
    if (known.meta.personOnly) { const m = `${known.meta.label} needs your own tap.`; rt.toast(m, 'warning', TITLE); return m; }
    if (plan.view) rt.navigate(plan.view);
    rt.dispatch(plan.action);
    return `ran ${plan.action}`;
  }
  const a = await executeControl(rt, { verb: 'open', address: plan.address!, by: 'deep-link' });
  if (!a.ok) rt.toast(`${link.raw}: ${describeAnswer(a)}`, 'warning', TITLE);
  return describeAnswer(a);
}

/** The words a palette link opens with: `#/command-palette/<words>`, `?q=<words>` beside the target, or `…/panel:q=<words>`. */
function paletteWords(l: DeepLink): string {
  if (l.sub) return l.sub;
  const seg = (l.address ?? '').split('/').find((x) => x.startsWith('panel:q='));
  if (seg) return seg.slice('panel:q='.length);
  try { return new URL(l.rest).searchParams.get('q') ?? ''; } catch { return ''; }
}

/** How long a link waits for its screen (a plugin page on a slow phone, a console still reaching the hub). */
const WAIT_MS = 30_000;

/** A plugin's page the link names: ask the lazy loader for that plugin now instead of waiting for its turn. */
function loadPluginOf(view: string): void {
  const id = (inventory as unknown as { views?: { id: string; plugin?: string }[] }).views?.find((v) => v.id === view)?.plugin;
  const folder = id ? bundledPlugins.find((p) => p.manifest.id === id)?.folder : undefined;
  if (!folder) return;
  note(`load plugin ${folder}`);
  void loader.request(folder, 'used').catch(() => undefined);
}

let queue: ReturnType<typeof createPendingTargets> | null = null;
let runtime: AxfRuntime | null = null;
/** The link still waiting for its screen: when the runtime re-installs (start-up, a host swap) the next install takes it. */
let waiting: DeepLink | null = null;
/** The link opened last and when: a runtime that re-installs right after start-up (it starts on its default screen) follows it again. */
let opened: { link: DeepLink; at: number } | null = null;
const REOPEN_MS = 10_000;

/** Follow a link (a parsed one, or a URL): wait for its screen, then open it. */
export function followDeepLink(rt: AxfRuntime, link: DeepLink | string | null): boolean {
  const l = typeof link === 'string' ? parseDeepLink(new URL(link, typeof window !== 'undefined' ? window.location.href : 'http://console.invalid/').toString()) : link;
  if (!l) return false;
  if (l.error) { rt.toast(l.error, 'warning', TITLE); return true; }
  if (l.view === PALETTE_VIEW) { openPalette(rt, paletteWords(l)); return true; }
  if (!queue || runtime !== rt) {
    queue?.stop();
    runtime = rt;
    queue = createPendingTargets({
      // the screen it names has registered (a plugin's page arrives when its chunk or stand-in installs)
      isReady: (view, p) => { const dl = p as unknown as { link: DeepLink }; return view ? viewReady(rt, view) : !!rt.actions.get(actionId(dl.link.action ?? '')); },
      open: (p) => { const link = (p as unknown as { link: DeepLink }).link; waiting = null; opened = { link, at: Date.now() }; void run(rt, link); },
      notice: (m) => { waiting = null; note(`gave up: ${m}`); rt.toast(m, 'warning', TITLE); },
      timeoutMs: WAIT_MS,
    });
  }
  waiting = l;
  note(`wait ${l.raw}`);
  if (l.view && !viewReady(rt, l.view)) loadPluginOf(l.view);
  queue.push({ ...(l.view ? { view: l.view } : {}), link: l } as unknown as DeepLinkPlan, l.raw);
  return true;
}

/**
 * `open` / `focus` of something only a link can name (console_open, REST, `axf console open <url>`, voice): a URL, a
 * `#/…` hash, `?axf-target=` / `?axf-open=`, or an address with a kind the control contract has not got (`plan:`).
 * null = a plain console-control address, which the executor runs itself.
 */
export async function openLinkTarget(rt: AxfRuntime, target: string): Promise<ControlAnswer | null> {
  const t = target.trim();
  let link: DeepLink | null = null;
  if (/^(https?:)?\/\/|^[#?]/.test(t)) link = parseDeepLink(new URL(t, typeof window !== 'undefined' ? window.location.href : 'http://console.invalid/').toString());
  else if (t.includes(':') && t.split('/').some((seg) => { const k = seg.slice(0, seg.indexOf(':')); return /^[a-z][a-z-]*$/.test(k) && !isConsoleControlKind(k); })) link = parseDeepLink(`http://console.invalid/?axf-target=${encodeURIComponent(t)}`);
  else return null;
  if (link?.view === PALETTE_VIEW) { openPalette(rt, paletteWords(link)); return { $axf: 'console-control@1', ok: true, verb: 'open', address: `view:${PALETTE_VIEW}`, opened: `view:${PALETTE_VIEW}`, state: controlState(rt) } as unknown as ControlAnswer; }
  if (!link) return { $axf: 'console-control@1', ok: false, verb: 'open', code: 'not_found', message: `"${t}" is not a console link`, state: controlState(rt) } as unknown as ControlAnswer;
  if (link.address && !link.address.split('/').some((seg) => !isConsoleControlKind(seg.slice(0, seg.indexOf(':')))) && link.sub === undefined) {
    return executeControl(rt, { verb: 'open', address: link.address, by: 'deep-link' });
  }
  if (link.view && !viewReady(rt, link.view)) followDeepLink(rt, link); // a plugin page still loading: the queue opens it
  else await run(rt, link);
  return { $axf: 'console-control@1', ok: true, verb: 'open', address: link.address ?? link.action ?? t, opened: link.address ?? link.action ?? t, state: controlState(rt) } as unknown as ControlAnswer;
}

/** Install once per runtime: the page's own link, hashchange / popstate, window.axfDeepLink. Returns a remover. */
export function installDeepLinks(rt: AxfRuntime): () => void {
  if (typeof window === 'undefined') return () => {};
  // the page's own link, or one an earlier install of this page was still waiting on
  const again = opened && Date.now() - opened.at < REOPEN_MS && rt.getState().view !== opened.link.view ? opened.link : null;
  const first = initial ?? waiting ?? again;
  initial = null; waiting = null; opened = null;
  note(`install${first ? ` with ${first.raw}` : ''}`);
  if (first) followDeepLink(rt, first);
  const onNav = () => {
    const l = parseDeepLink(window.location.href);
    if (!l) return;
    try { window.history.replaceState(window.history.state, '', l.rest); } catch { /* fine */ }
    followDeepLink(rt, l);
  };
  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  const off = rt.subscribe(() => queue?.poke());
  const w = window as unknown as { axfDeepLink?: (url: string) => boolean };
  w.axfDeepLink = (url) => followDeepLink(rt, url);
  setLinkOpener(openLinkTarget);
  return () => { setLinkOpener(null); window.removeEventListener('hashchange', onNav); window.removeEventListener('popstate', onNav); off(); delete w.axfDeepLink; const left = waiting; queue?.stop(); queue = null; runtime = null; waiting = left; };
}
