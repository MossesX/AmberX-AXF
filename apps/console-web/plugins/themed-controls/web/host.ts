/**
 * Runtime host (themed-controls@1 → Native fallback; spec/THEMED-CONTROLS.md). The DOM half of the plugin: a
 * MutationObserver finds native elements of the active families, asks the engine (familyOf / shouldTheme /
 * controlProps) and swaps in the family's themed control. The original element stays in the page, visually hidden
 * (`data-axf-themed="<family>"`, still focusable by the form) and keeps its name, value, checked state, validity and
 * form: the themed control writes to it through the native setter + input / change events (React-safe), and script
 * writes to it (`el.value = …`, `el.checked = …`, attribute changes, form reset) come back to the themed control.
 * Families switched off, the master switch off or the plugin removed: every swap is undone and the original is shown
 * again with its current value. Global families (dialogs, tooltips, scrollbars) start and stop the same way.
 */
import type { AxfRuntime } from '@console/axf/core';
import {
  THEMED_FAMILIES, activeFamilies, controlProps, familyOf, shouldTheme, surfaceFor, themedControlsConfig,
  type NativeAttrs, type TcProps, type TcSurface, type TcViewport, type ThemedControlsConfig, type ThemedFamily,
} from '@console/axf/core/engines/themed-controls';

export interface LiveHost {
  counts(): Record<string, number>;
  report(): Record<string, unknown>;
  swaps(): SwapRecord[];
  find(ref: string): SwapRecord | null;
  global<T = unknown>(family: ThemedFamily): T | null;
  viewport(): TcViewport;
  surface(family: ThemedFamily): TcSurface;
  config(): ThemedControlsConfig;
}
let live: LiveHost | null = null;
export function liveHost(): LiveHost | null { return live; }

/* ---------------- what a family provides ---------------- */

export interface SwapCtx {
  rt: AxfRuntime;
  family: ThemedFamily;
  input: HTMLInputElement;
  /** fresh props from the element (the engine's controlProps) */
  props(): TcProps;
  /** the surface the family opens on right now (popover / sheet / modal / inline) */
  surface(): TcSurface;
  /** user → input: set checked (a click, so labels, React and change listeners all see it) */
  setChecked(v: boolean): void;
  /** user → input: set the value through the native setter and fire input (+ change when `done`) */
  setValue(v: string, done?: boolean): void;
  /** the original element's form label (for screen readers when there is no aria-label) */
  labelText(): string;
}

export interface Swap {
  /** the themed control, inserted right after the original */
  el: HTMLElement;
  /** where focus goes when the original is focused (default el) */
  focusEl?: () => HTMLElement | null;
  /** input → themed: redraw from fresh props */
  sync(props: TcProps): void;
  destroy?(): void;
  /** extra live state (open picker, files…) */
  state?(): Record<string, unknown>;
  /** set from the API (string form of the value) */
  set?(value: unknown): void | Promise<void>;
  open?(): void;
  close?(): void;
}

export interface ElementFamily {
  family: ThemedFamily;
  /** native elements of this family (inputs by type) */
  selector: string;
  /** extra opt-outs beyond the engine's (framework-internal inputs) */
  skip?(input: HTMLInputElement): boolean;
  mount(ctx: SwapCtx): Swap;
}

export interface GlobalFamily {
  family: ThemedFamily;
  /** start; returns the stopper (everything restored) */
  start(rt: AxfRuntime, host: LiveHost): () => void;
  /** live state for the report and the API */
  report?(): Record<string, unknown>;
  /** the family's own API object (dialogs list, tooltip state…) */
  api?(): unknown;
}

export interface SwapRecord {
  family: ThemedFamily;
  input: HTMLInputElement;
  swap: Swap;
  /** stable id for the API: the element id, else its name (+ value for a radio), else tc-<n> */
  ref: string;
}

/* ---------------- DOM helpers ---------------- */

const PROTO_PROPS = ['value', 'checked', 'indeterminate', 'disabled', 'required', 'readOnly'] as const;
const WATCHED_ATTRS = ['type', 'disabled', 'checked', 'value', 'min', 'max', 'step', 'required', 'readonly', 'aria-invalid', 'data-axf-invalid', 'data-axf-native', 'aria-label', 'list', 'accept', 'multiple'];

function attrsOf(el: HTMLInputElement): NativeAttrs {
  const a: NativeAttrs = { tag: el.tagName.toLowerCase() };
  for (const at of Array.from(el.attributes)) a[at.name] = at.value;
  a.type = el.type;
  a.value = el.value;
  a.checked = el.checked;
  a.indeterminate = el.indeterminate;
  if (el.disabled) a.disabled = ''; else a.disabled = null;
  return a;
}

const nativeSetter = (prop: string) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, prop)?.set;

function labelTextOf(el: HTMLInputElement): string {
  const l = el.labels?.[0];
  if (!l) return '';
  const clone = l.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('input, .fx-tc').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isCoarse(): boolean {
  const mm = globalThis.matchMedia;
  return !!mm && mm('(pointer: coarse)').matches && !mm('(hover: hover)').matches;
}

/* ---------------- the host ---------------- */

let seq = 0;

export function startHost(rt: AxfRuntime, families: { elements: ElementFamily[]; globals: GlobalFamily[] }, onGone?: () => void): () => void {
  const byFamily = new Map<ThemedFamily, ElementFamily>(families.elements.map((f) => [f.family, f]));
  const globals = new Map<ThemedFamily, GlobalFamily>(families.globals.map((g) => [g.family, g]));
  const swaps = new Map<HTMLInputElement, SwapRecord & { undo: () => void }>();
  const running = new Map<ThemedFamily, () => void>();
  let cfg = themedControlsConfig((k) => rt.settings.get(k));
  let active = new Set<ThemedFamily>(activeFamilies(cfg));
  let stopped = false;

  const viewport = (): TcViewport => {
    const narrow = globalThis.document?.documentElement.hasAttribute('data-fx-narrow') ?? false;
    // the layout asset's cut-off is the root's data-fx-narrow: a phone is width 0 under a cut-off of 1, wide is above it
    return { width: narrow ? 0 : Math.max(2, globalThis.innerWidth || 2), phoneMaxWidth: 1, coarse: isCoarse() };
  };

  const host: LiveHost = {
    counts() {
      const out: Record<string, number> = {};
      for (const r of swaps.values()) out[r.family] = (out[r.family] ?? 0) + 1;
      return out;
    },
    report() {
      const open: Record<string, unknown>[] = [];
      for (const r of swaps.values()) {
        const st = r.swap.state?.();
        if (st && st.open) open.push({ family: r.family, ref: r.ref, ...st });
      }
      const g: Record<string, unknown> = {};
      for (const [f, fam] of globals) if (running.has(f) && fam.report) g[f] = fam.report();
      return { active: [...active], counts: host.counts(), open, globals: g, surface: isPhone() ? 'phone' : 'wide' };
    },
    swaps: () => [...swaps.values()],
    find(ref: string) {
      const r = ref.replace(/^(field|setting):/, '').replace(/^tc\.field\./, '');
      for (const s of swaps.values()) if (s.ref === r || s.input.id === r || s.input.name === r) return s;
      return null;
    },
    global<T>(family: ThemedFamily) { return running.has(family) ? ((globals.get(family)?.api?.() as T) ?? null) : null; },
    viewport,
    surface: (family) => surfaceFor(family, viewport(), cfg),
    config: () => cfg,
  };
  const isPhone = () => surfaceFor('datetime', viewport(), { sheet: true }) === 'sheet';

  const refOf = (input: HTMLInputElement, family: ThemedFamily): string => {
    if (input.id) return input.id;
    if (input.name) return family === 'radio' ? `${input.name}=${input.value}` : input.name;
    const r = `tc-${++seq}`;
    input.dataset.axfTcRef = r;
    return r;
  };

  function unswap(input: HTMLInputElement): void {
    const r = swaps.get(input);
    if (!r) return;
    swaps.delete(input);
    r.undo();
  }

  function swapOne(input: HTMLInputElement): void {
    if (swaps.has(input) || !input.isConnected) return;
    const attrs = attrsOf(input);
    const family = familyOf(attrs);
    if (!family || family === 'tooltip') return;
    const fam = byFamily.get(family);
    if (!fam) return;
    const ctxN = {
      nativeAncestor: !!input.closest('[data-axf-native]'),
      editable: !!input.closest('[contenteditable=""], [contenteditable="true"]'),
      insideThemed: !!input.parentElement?.closest('.fx-tc'),
    };
    if (!shouldTheme(family, attrs, cfg, ctxN)) return;
    if (input.type === 'hidden' || input.hidden || input.style.display === 'none' || fam.skip?.(input)) return;

    const ctx: SwapCtx = {
      rt, family, input,
      props: () => controlProps(family, attrsOf(input), labelTextOf(input)),
      surface: () => surfaceFor(family, viewport(), cfg),
      labelText: () => labelTextOf(input),
      setChecked(v) { if (input.checked !== v && !input.disabled) input.click(); },
      setValue(v, done = true) {
        nativeSetter('value')?.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        if (done) input.dispatchEvent(new Event('change', { bubbles: true }));
        swap.sync(ctx.props());
      },
    };
    let swap: Swap;
    try { swap = fam.mount(ctx); } catch (e) { rt.terminal?.warn?.('themed-controls', `could not theme ${family}: ${(e as Error).message}`); return; }

    // the original: hidden, out of the tab order, in sync
    const prev = { tabindex: input.getAttribute('tabindex'), ariaHidden: input.getAttribute('aria-hidden') };
    input.setAttribute('data-axf-themed', family);
    input.setAttribute('tabindex', '-1');
    input.setAttribute('aria-hidden', 'true');
    swap.el.classList.add('fx-tc');
    swap.el.setAttribute('data-fx-tc-family', family);
    input.after(swap.el);

    let queued = false;
    const resync = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; if (swaps.has(input)) swap.sync(ctx.props()); });
    };
    // script writes (el.value = …, el.checked = …): wrap the instance's accessors (React's own tracker included)
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const p of PROTO_PROPS) {
      const own = Object.getOwnPropertyDescriptor(input, p);
      const base = own ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, p);
      if (!base?.set || !base.get || (own && !own.configurable)) continue;
      saved.set(p, own);
      Object.defineProperty(input, p, {
        configurable: true, enumerable: base.enumerable,
        get() { return base.get!.call(this); },
        set(v) { base.set!.call(this, v); resync(); },
      });
    }
    const onEvent = () => resync();
    const onFocus = () => { const f = swap.focusEl?.() ?? swap.el; if (f && f !== globalThis.document.activeElement) f.focus(); };
    const form = input.form;
    const onReset = () => globalThis.setTimeout(resync, 0);
    input.addEventListener('input', onEvent);
    input.addEventListener('change', onEvent);
    input.addEventListener('focus', onFocus);
    input.addEventListener('invalid', onEvent);
    form?.addEventListener('reset', onReset);

    const rec = {
      family, input, swap, ref: refOf(input, family),
      undo() {
        input.removeEventListener('input', onEvent);
        input.removeEventListener('change', onEvent);
        input.removeEventListener('focus', onFocus);
        input.removeEventListener('invalid', onEvent);
        form?.removeEventListener('reset', onReset);
        for (const [p, own] of saved) { delete (input as unknown as Record<string, unknown>)[p]; if (own) Object.defineProperty(input, p, own); }
        try { swap.close?.(); swap.destroy?.(); } catch { /* the control is going anyway */ }
        swap.el.remove();
        input.removeAttribute('data-axf-themed');
        if (prev.tabindex === null) input.removeAttribute('tabindex'); else input.setAttribute('tabindex', prev.tabindex);
        if (prev.ariaHidden === null) input.removeAttribute('aria-hidden'); else input.setAttribute('aria-hidden', prev.ariaHidden);
        delete input.dataset.axfTcRef;
      },
    };
    swaps.set(input, rec);
    swap.sync(ctx.props());
  }

  function selectorFor(): string {
    return [...active].map((f) => byFamily.get(f)?.selector).filter(Boolean).join(', ');
  }

  function scan(root: ParentNode): void {
    const sel = selectorFor();
    if (!sel) return;
    if (root instanceof HTMLInputElement) { if (root.matches(sel)) swapOne(root); return; }
    root.querySelectorAll?.<HTMLInputElement>(sel).forEach(swapOne);
  }

  const observer = new MutationObserver((records) => {
    if (stopped) return;
    for (const m of records) {
      if (m.type === 'attributes') {
        const t = m.target as HTMLInputElement;
        if (!(t instanceof HTMLInputElement)) continue;
        if (swaps.has(t)) {
          if (m.attributeName === 'type' || (m.attributeName === 'data-axf-native' && t.hasAttribute('data-axf-native'))) { unswap(t); swapOne(t); }
          else swaps.get(t)!.swap.sync(controlProps(swaps.get(t)!.family, attrsOf(t), labelTextOf(t)));
        } else if (m.attributeName === 'type' || m.attributeName === 'data-axf-native') swapOne(t);
        continue;
      }
      m.removedNodes.forEach((n) => {
        if (n instanceof HTMLInputElement) { if (swaps.has(n) && !n.isConnected) unswap(n); }
        else if (n instanceof Element) for (const inp of [...swaps.keys()]) if (!inp.isConnected && n.contains(inp)) unswap(inp);
      });
      m.addedNodes.forEach((n) => { if (n instanceof Element && !n.classList.contains('fx-tc')) scan(n); });
    }
  });

  function apply(): void {
    const next = themedControlsConfig((k) => rt.settings.get(k));
    const nextActive = new Set<ThemedFamily>(activeFamilies(next));
    const prevActive = active;
    cfg = next;
    active = nextActive;
    // element families switched off: undo their swaps
    for (const r of [...swaps.values()]) if (!active.has(r.family)) unswap(r.input);
    // global families
    for (const f of THEMED_FAMILIES) {
      const g = globals.get(f);
      if (!g) continue;
      if (active.has(f) && !running.has(f)) running.set(f, g.start(rt, host));
      if (!active.has(f) && running.has(f)) { running.get(f)!(); running.delete(f); }
    }
    if ([...active].some((f) => !prevActive.has(f)) || swaps.size === 0) scan(globalThis.document.body);
  }

  live = host;
  observer.observe(globalThis.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: WATCHED_ATTRS });
  for (const f of active) { const g = globals.get(f); if (g) running.set(f, g.start(rt, host)); }
  scan(globalThis.document.body);
  const offSettings = rt.settings.onAnyChange((key) => { if (key.startsWith('axf.themedControls.')) apply(); });
  // the console takes a switched-off plugin's settings tab away: that is the plugin going, so undo everything
  let tabSeen = !!rt.settings.getTab('themed-controls');
  const offTab = rt.settings.subscribe(() => {
    if (rt.settings.getTab('themed-controls')) tabSeen = true;
    else if (tabSeen) { stop(); onGone?.(); }
  });

  function stop(): void {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    offSettings();
    offTab();
    for (const inp of [...swaps.keys()]) unswap(inp);
    for (const off of running.values()) off();
    running.clear();
    if (live === host) live = null;
  }
  return stop;
}
