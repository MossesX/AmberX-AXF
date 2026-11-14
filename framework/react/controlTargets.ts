/**
 * Control target registry (console-control@1, spec/CONSOLE-CONTROL.md; build full-api-and-voice-control, Nov 13 2026).
 *
 * The web half of the contract: everything on the page that has an address registers here (views, tab rows and tabs,
 * buttons, settings, grids and their rows, build steps, plugins), and the registry runs the ten verbs against what is
 * registered right now. The pure half (parse, resolve, scroll maths, envelopes) is core/engines/console-control.ts.
 *
 *   const ref = useControlTarget({ address: 'button:save', kind: 'button', label: 'Save', invoke: () => save() });
 *   <button ref={ref} …>                       // the element is what focus scrolls to and highlights
 *
 * Addresses are composed: a relative address (`button:save`) gets the nearest <ControlScope address="view:builds"> prefix,
 * so a plugin's controls are addressable without naming their screen. The same works from the DOM alone: an element with
 * `data-axf-target="button:save"` inside an ancestor carrying `data-axf-scope` is picked up by the scanner (press = click,
 * state = its text / aria state / value, focus = scroll + highlight), for bespoke controls that are not framework ones.
 *
 * AxfProvider installs one registry per runtime (`installControlRegistry`): it feeds the search index (kind `target`), and
 * registers the actions `console-control:<json>` (the whole command: what console.actions / console_action / the CLI send),
 * `control.focus:<address>`, `control.open:<address>`, `control.press:<address>`, `control.set:<address>:<value>`,
 * `control.scroll:<dir>[:<amount>]` and `control.search:<words>`, so every verb is reachable through the transports that already
 * exist (CONTROL.md → Console). Settings that are not rendered are still addressable: the registry derives a target for every
 * settings tab, group and single setting from the settings registry (open = settings.open:<tab> + anchor; set = the value parser).
 */
import { createContext, createElement, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AxfRuntime, SettingSpec } from '../core';
import {
  CONSOLE_CONTROL_FRAME, CONSOLE_CONTROL_TARGETS_FRAME, CONSOLE_CONTROL_VERBS, CONSOLE_CONTROL_WIRE, ConsoleControlError, childAddress, consoleControlResult, failureOf, focusOptions, formatAddress, listTargets,
  normalizeConsoleControl, parseAddress, resolveForVerb, searchTargets, targetCan,
  type Address, type ConsoleControlCommand, type ConsoleControlKind, type ConsoleControlResult, type ConsoleControlVerb, type ControlTarget, type ScrollSpec, type ScrollState, type SearchHitOut, type SearchQuery, type TargetSnapshot,
} from '../core/engines/console-control';
import { consoleFieldValue } from '../core/engines/console-commands.mjs';
import { useOptionalRuntime, useRuntime } from './AxfProvider';

/* ================================================================== definitions */

export interface ControlTargetDef {
  /** full (`view:builds/button:save`) or relative (`button:save`, prefixed by the enclosing ControlScope) */
  address: string;
  kind: ConsoleControlKind;
  label: string;
  detail?: string;
  icon?: string;
  keywords?: string[];
  /** UAC permission the target itself needs (the runtime gate applies before any verb runs) */
  requires?: string;
  /** the verbs it answers; default per kind (CONSOLE_CONTROL_DEFAULT_CAN) */
  can?: ConsoleControlVerb[];
  /** pressing it deletes something: a press without `confirm` answers confirmation_required */
  destructive?: boolean;
  /** the element focus scrolls to and highlights (the hook's ref sets it) */
  element?: () => Element | null;
  /** state value (a setting's value, a tab row's tab, a grid's selection, a plugin's enabled) */
  get?: () => unknown;
  /** set: setting value, tab value, selection, plugin enabled */
  set?: (value: unknown) => unknown | Promise<unknown>;
  /** press: the button's click, the function's run (value = its argument) */
  invoke?: (value?: unknown) => unknown | Promise<unknown>;
  /** bring it onto the screen (navigate, switch the tab, expand the row); ancestors open first */
  open?: () => unknown | Promise<unknown>;
  /** a virtualised row: render it before focus scrolls to it */
  materialize?: () => unknown | Promise<unknown>;
  /** focus with select: mark it selected (a grid row) */
  select?: () => unknown;
  /** focus with expand: open its detail */
  expand?: () => unknown;
  isDisabled?: () => boolean;
  /** extra state fields for `state` */
  state?: () => Record<string, unknown>;
  /** a virtual (not yet rendered) target */
  virtual?: boolean;
}

interface Entry { def: ControlTargetDef; address: string; parsed: Address; derived?: boolean; /** discovered on the screen (fieldControl.ts), not registered by a control */ auto?: boolean }

/** Runs scroll commands and reports scroll state (installed by scrollControl.ts). */
export interface ControlScroller {
  scroll(spec: ScrollSpec, container: Element | null, to: Element | null): ScrollState;
  state(container: Element | null): ScrollState;
  containerOf(el: Element | null): Element | null;
}

/** Ranks search hits for the `search` verb (an app's own, wider search: ControlRegistry.setSearcher). */
export type ControlSearcher = (query: SearchQuery) => (SearchHitOut & Record<string, unknown>)[];

export const CONTROL_ACTION = 'console-control';
export const CONTROL_ACTIONS = { focus: 'control.focus', open: 'control.open', press: 'control.press', set: 'control.set', scroll: 'control.scroll', search: 'control.search', state: 'control.state' } as const;
export const CONTROL_HIGHLIGHT_CLASS = 'fx-control-focus';
export const CONTROL_TARGET_ATTR = 'data-axf-target';
export const CONTROL_SCOPE_ATTR = 'data-axf-scope';
/** The settings view and its tab rows, as the settings library names them (libs/settings: view `settings`, TabGroup ids `settings.tabs` / `settings.subtabs`). */
export const SETTINGS_VIEW_ADDRESS = 'view:settings';
export const SETTINGS_TAB_ROW = 'settings.tabs';
export const SETTINGS_SUBTAB_ROW = 'settings.subtabs';
/** The scroll container of the main pane. */
export const MAIN_SCROLL_ADDRESS = 'scroll:main';

const isPromise = (v: unknown): v is Promise<unknown> => !!v && typeof (v as Promise<unknown>).then === 'function';

/* ================================================================== registry */

export class ControlRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private scroller: ControlScroller | null = null;
  private highlighted: { el: Element; timer: ReturnType<typeof setTimeout> } | null = null;
  private rev = 0;

  constructor(readonly rt: AxfRuntime) {}

  /** Register (or replace) a target. Returns a remover. A rendered registration replaces a derived one of the same address. */
  register(def: ControlTargetDef, scope?: string | null, opts?: { auto?: boolean }): () => void {
    const address = composeAddress(scope, def.address);
    let parsed: Address;
    try { parsed = parseAddress(address); } catch (e) { this.rt.terminal.warn('control', `target ${address} refused: ${e instanceof Error ? e.message : String(e)}`); return () => {}; }
    const entry: Entry = { def, address: formatAddress(parsed), parsed, ...(opts?.auto ? { auto: true } : {}) };
    const had = this.entries.get(entry.address);
    if (opts?.auto && had && !had.auto) return () => {}; // a control's own registration always wins over a discovered one
    this.entries.set(entry.address, entry);
    this.changed();
    return () => { if (this.entries.get(entry.address) === entry) { this.entries.delete(entry.address); this.changed(); } };
  }

  /** Re-render subscribers (the Inspector, a list of targets) when the registry changes. */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  get revision(): number { return this.rev; }
  private changed() { this.rev++; for (const fn of this.listeners) fn(); }

  setScroller(s: ControlScroller | null): void { this.scroller = s; }

  /** Refreshers run before every command (fieldControl.ts re-discovers the surface in front). `addRefresher(null, fn)` removes one. */
  private readonly refreshers = new Set<() => void>();
  addRefresher(fn: (() => void) | null, remove?: () => void): void { if (fn) this.refreshers.add(fn); if (remove) this.refreshers.delete(remove); }
  /** Re-discover the surface in front now (a caller that searches before it runs a command: in-console voice). */
  refreshNow(): void { this.refresh(); }
  private refresh(): void { for (const fn of this.refreshers) { try { fn(); } catch (e) { this.rt.terminal.warn('control', `refresh failed: ${e instanceof Error ? e.message : String(e)}`); } } }

  /** What is on screen (fieldControl.ts `screenReport`): `state` with no address answers it as `report`. */
  private screenReporter: (() => unknown) | null = null;
  setScreenReporter(fn: (() => unknown) | null): void { this.screenReporter = fn; }

  /** The elements registered (not discovered) leaf controls point at right now: discovery never doubles them. Containers
   *  (views, panels, grids, rows, scroll panes) don't count: what is inside them is still discovered. */
  ownedElements(): Set<Element> {
    const out = new Set<Element>();
    // a setting owns its row (the row's switch / input is that setting); a button, function or tab owns only a control
    // element (a plugin's or a placed dialog's target points at a whole section: what is inside is still discovered)
    const CONTROL = 'button, [role=button], [role=tab], [role^=menuitem], [role=switch], [role=checkbox], [role=radio], a[href], input, select, textarea';
    for (const e of this.entries.values()) {
      if (e.auto || e.def.virtual) continue;
      const k = e.def.kind;
      if (k !== 'setting' && k !== 'button' && k !== 'function' && k !== 'tab' && k !== 'subtab') continue;
      try { const el = e.def.element?.(); if (el && (k === 'setting' || el.matches(CONTROL))) out.add(el); } catch { /* a getter may run before render */ }
    }
    for (const e of this.derivedSettings()) { try { const el = e.def.element?.(); if (el) out.add(el); } catch { /* same */ } }
    return out;
  }

  /** An app-wide search (static inventory, help, loaded data) that replaces the built-in ranking of the `search` verb. */
  private searcher: ControlSearcher | null = null;
  setSearcher(s: ControlSearcher | null): void { this.searcher = s; }
  get hasScroller(): boolean { return !!this.scroller; }

  /** One registered entry by full address, else null. */
  entry(address: string): Entry | null { return this.entries.get(address) ?? null; }

  /** Everything addressable right now: registered targets + settings derived from the settings registry (unless a rendered one has the address). */
  snapshot(): TargetSnapshot & { targets: ControlTarget[] } {
    const targets: ControlTarget[] = [];
    const seen = new Set<string>();
    for (const e of this.entries.values()) { targets.push(toTarget(e)); seen.add(e.address); }
    for (const e of this.derivedSettings()) if (!seen.has(e.address)) { targets.push(toTarget(e)); seen.add(e.address); }
    let scroll: ScrollState | undefined;
    if (this.scroller) { try { scroll = this.scroller.state(null); } catch { /* no container yet */ } }
    return { $axf: CONSOLE_CONTROL_TARGETS_FRAME, view: this.rt.getState().view, at: new Date().toISOString(), ...(scroll ? { scroll } : {}), targets };
  }

  /** The entry for a resolved target (registered, else derived on the fly). */
  private entryFor(address: string): Entry | null {
    return this.entries.get(address) ?? this.derivedSettings().find((e) => e.address === address) ?? null;
  }

  /* ---------------- derived settings ---------------- */

  private derivedSettings(): Entry[] {
    const rt = this.rt;
    const s = rt.settings;
    const out: Entry[] = [];
    const push = (def: ControlTargetDef) => { try { const parsed = parseAddress(def.address); out.push({ def, address: formatAddress(parsed), parsed, derived: true }); } catch { /* skip */ } };
    const tabRow = childAddress(SETTINGS_VIEW_ADDRESS, 'tab', SETTINGS_TAB_ROW);
    push({ address: SETTINGS_VIEW_ADDRESS, kind: 'view', label: 'Settings', keywords: ['preferences', 'options'], open: () => rt.dispatch('app.settings') });
    const tabs = s.listTabs();
    const top = tabs.filter((t) => !t.parent || !tabs.some((x) => x.id === t.parent));
    push({ address: tabRow, kind: 'tab', label: 'Settings tabs', get: () => s.get('axf.settings.lastTab'), set: (v) => rt.dispatch(`settings.open:${String(v)}`), state: () => ({ tabs: top.map((t) => ({ value: t.id, label: t.label })) }) });
    for (const tab of tabs) {
      // a sub tab (tab.parent) lives under its parent's tab: view:settings/tab:settings.tabs=<parent>/subtab:settings.subtabs=<id>
      const parent = tab.parent && tabs.some((x) => x.id === tab.parent) ? tab.parent : null;
      const tabAddr = parent ? `${tabRow}=${parent}/${formatAddress([{ kind: 'subtab', id: `${SETTINGS_SUBTAB_ROW}=${tab.id}` }])}` : `${tabRow}=${tab.id}`;
      const open = () => rt.dispatch(`settings.open:${tab.id}`);
      const where = parent ? `Settings › ${tabs.find((x) => x.id === parent)?.label ?? parent} › ${tab.label}` : `Settings › ${tab.label}`;
      push({ address: tabAddr, kind: parent ? 'subtab' : 'tab', label: tab.label, detail: 'Settings', icon: tab.icon, keywords: [tab.description ?? ''], open, element: () => document.querySelector(`[data-axf-settings-tab="${cssEscape(tab.id)}"]`) ?? document.querySelector(`[data-axf-settings-nav="${cssEscape(tab.id)}"]`) });
      for (const p of s.panelsIn(tab.id)) push({ address: childAddress(tabAddr, 'panel', `settings-panel:${p.id}`), kind: 'panel', label: p.title, detail: where, open, element: () => byAnchor(`settings-panel:${p.id}`) });
      for (const g of s.groupsIn(tab.id)) {
        push({ address: childAddress(tabAddr, 'panel', `settings-group:${g.id}`), kind: 'panel', label: g.label, detail: where, open, element: () => byAnchor(`settings-group:${g.id}`) });
        for (const spec of g.settings) {
          if (spec.kind === 'section') continue;
          push(settingTargetDef(rt, spec, childAddress(tabAddr, 'setting', spec.key), `${where} › ${g.label}`, open));
        }
      }
    }
    return out;
  }

  /* ---------------- running commands ---------------- */

  /** Run one command (any shape; validated first). Never throws: every failure is an envelope. */
  async run(raw: unknown): Promise<ConsoleControlResult> {
    let cmd: ConsoleControlCommand & { address?: string };
    try { cmd = normalizeConsoleControl(raw); } catch (e) { return failureOf(e); }
    this.refresh();
    try {
      switch (cmd.verb) {
        case 'open': return await this.open(cmd);
        case 'state': return this.state(cmd);
        case 'press': return await this.press(cmd);
        case 'set': return await this.set(cmd);
        case 'scroll': return this.scroll(cmd);
        case 'focus': return await this.focus(cmd);
        case 'search': return this.search(cmd);
        case 'list': return this.list(cmd);
        case 'plugin.enable': case 'plugin.disable': return await this.plugin(cmd);
        default: return failureOf(new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `verb ${String((cmd as { verb: string }).verb)} is unknown`));
      }
    } catch (e) {
      if (!(e instanceof ConsoleControlError)) this.rt.terminal.warn('control', `${cmd.verb} ${cmd.address ?? ''} failed: ${e instanceof Error ? e.message : String(e)}`);
      return failureOf(e);
    }
  }

  /** Run a command given as text: JSON, or `<verb> <address> [value]`. */
  run_text(text: string): Promise<ConsoleControlResult> {
    const t = text.trim();
    if (t.startsWith('{')) { try { return this.run(JSON.parse(t)); } catch { return Promise.resolve(failureOf(new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, 'command is not JSON'))); } }
    const [verb, address, ...rest] = t.split(/\s+/);
    const cmd: Record<string, unknown> = { verb };
    if (verb === 'search') cmd.query = { q: [address, ...rest].filter(Boolean).join(' ') };
    else if (verb === 'scroll') cmd.scroll = { dir: address, ...(rest[0] ? { amount: Number(rest[0]) } : {}) };
    else { if (address) cmd.address = address; if (rest.length) cmd.value = rest.join(' '); }
    return this.run(cmd);
  }

  private resolveEntry(address: string, verb: ConsoleControlVerb): { entry: Entry; target: ControlTarget; address: string } {
    const snap = this.snapshot();
    const r = resolveForVerb(snap, address, verb);
    const entry = this.entryFor(r.target.address);
    if (!entry) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_FOUND, `${r.target.address} is no longer on the screen`, { nearest: [] });
    const gate = this.rt.gate(entry.def.requires);
    if (gate !== 'allow' && verb !== 'state' && verb !== 'list') throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.DENIED, `${r.target.address} needs ${entry.def.requires}`, { requires: entry.def.requires });
    return { entry, target: r.target, address: r.target.address };
  }

  /** Open every registered ancestor (view, tab, panel, grid, row) outermost first, then the target's own open. */
  private async openChain(entry: Entry): Promise<void> {
    for (let n = 1; n < entry.parsed.length; n++) {
      const anc = this.entryFor(formatAddress(entry.parsed.slice(0, n)));
      if (anc?.def.open) await maybe(anc.def.open());
      else if (anc?.def.kind === 'view') this.rt.navigate(anc.parsed[0]!.id);
    }
    if (entry.def.open) await maybe(entry.def.open());
    else if (entry.def.kind === 'view') this.rt.navigate(entry.parsed[0]!.id);
    else if (entry.def.kind === 'tab' && entry.def.set) {
      const leaf = entry.parsed[entry.parsed.length - 1]!;
      const eq = leaf.id.indexOf('=');
      if (eq > 0) await maybe(entry.def.set(leaf.id.slice(eq + 1)));
    }
  }

  private async open(cmd: ConsoleControlCommand & { address?: string }) {
    const { entry, address } = this.resolveEntry(cmd.address!, 'open');
    await this.openChain(entry);
    await nextFrame();
    const el = await this.elementOf(entry);
    if (el && (cmd.options?.highlight ?? true)) { scrollTo(el); this.highlight(el, focusOptions(cmd.options).highlightMs); }
    return consoleControlResult(cmd, { opened: address, view: this.rt.getState().view });
  }

  private state(cmd: ConsoleControlCommand & { address?: string }) {
    if (!cmd.address) {
      const snap = this.snapshot();
      let screen: unknown;
      if (this.screenReporter) { try { screen = this.screenReporter(); } catch (e) { this.rt.terminal.warn('control', `screen report failed: ${e instanceof Error ? e.message : String(e)}`); } }
      return consoleControlResult(cmd, { state: { view: snap.view, targets: snap.targets.length, ...(snap.scroll ? { scroll: snap.scroll } : {}), ...(screen ? { report: screen } : {}) } });
    }
    const { entry, target, address } = this.resolveEntry(cmd.address, 'state');
    const d = entry.def;
    const el = d.element?.() ?? null;
    const state: Record<string, unknown> = { address, kind: d.kind, label: d.label };
    if (d.get) state.value = d.get();
    if (d.isDisabled) state.disabled = d.isDisabled();
    else if (el instanceof HTMLElement && 'disabled' in el) state.disabled = (el as HTMLButtonElement).disabled;
    if (d.destructive) state.destructive = true;
    if (d.virtual) state.virtual = true;
    state.can = target.can ?? targetCan(target);
    state.onScreen = !!el;
    if (d.kind === 'scroll' || d.kind === 'view' || d.kind === 'grid' || d.kind === 'panel') { if (this.scroller) { try { state.scroll = this.scroller.state(this.scroller.containerOf(el)); } catch { /* none */ } } }
    if (d.state) Object.assign(state, d.state());
    return consoleControlResult(cmd, { state });
  }

  private async press(cmd: ConsoleControlCommand & { address?: string }) {
    const { entry, address } = this.resolveEntry(cmd.address!, 'press');
    const d = entry.def;
    if (d.isDisabled?.()) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${address} is disabled right now`, { because: 'disabled' });
    if (d.destructive && !cmd.confirm) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.CONFIRMATION_REQUIRED, `${address} deletes something: send the command again with confirm`, { confirm: 'required' });
    let result: unknown;
    if (d.invoke) result = await maybe(d.invoke(cmd.value));
    else {
      const el = await this.elementOf(entry);
      if (!(el instanceof HTMLElement)) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_IMPLEMENTED, `${address} has nothing to press`, { can: targetCan(toTarget(entry)) });
      el.click();
      result = true;
    }
    return consoleControlResult(cmd, { pressed: address, ...(result !== undefined && result !== true ? { result } : {}) });
  }

  private async set(cmd: ConsoleControlCommand & { address?: string }) {
    const { entry, address } = this.resolveEntry(cmd.address!, 'set');
    const d = entry.def;
    if (!d.set) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_IMPLEMENTED, `${address} cannot be set`, { can: targetCan(toTarget(entry)) });
    if (d.isDisabled?.()) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${address} is disabled right now`, { because: 'disabled' });
    const refused = await maybe(d.set(cmd.value));
    if (typeof refused === 'string' && refused) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.VALIDATION, refused, { problems: [refused] });
    return consoleControlResult(cmd, { changed: [address], value: d.get ? d.get() : cmd.value });
  }

  private scroll(cmd: ConsoleControlCommand & { address?: string }) {
    if (!this.scroller) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_IMPLEMENTED, 'this app has no scroll control installed', { can: [] });
    const spec = cmd.scroll!;
    let container: Element | null = null;
    if (cmd.address) {
      const { entry } = this.resolveEntry(cmd.address, 'scroll');
      container = this.scroller.containerOf(entry.def.element?.() ?? null);
    }
    let to: Element | null = null;
    if (spec.dir === 'to') {
      const target = this.resolveEntry(typeof spec.to === 'string' ? spec.to : formatAddress(spec.to!.path), 'focus');
      to = target.entry.def.element?.() ?? null;
      if (!to) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.VALIDATION, `${target.address} is not on the screen to scroll to`, { problems: ['scroll.to is not rendered'] });
      if (!container) container = this.scroller.containerOf(to);
    }
    const state = this.scroller.scroll(spec, container, to);
    return consoleControlResult(cmd, { scroll: state });
  }

  private async focus(cmd: ConsoleControlCommand & { address?: string }) {
    const { entry, address } = this.resolveEntry(cmd.address!, 'focus');
    const o = focusOptions(cmd.options);
    await this.openChain(entry);
    if (entry.def.materialize) await maybe(entry.def.materialize());
    await nextFrame();
    const el = await this.elementOf(entry);
    if (o.select && entry.def.select) await maybe(entry.def.select());
    if (o.expand && entry.def.expand) await maybe(entry.def.expand());
    if (!el) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.UNAVAILABLE, `${address} did not render, so it cannot be focused`, { because: 'not rendered' });
    scrollTo(el);
    if (o.highlight) this.highlight(el, o.highlightMs);
    focusElement(el);
    const out: Record<string, unknown> = { focused: address };
    if (this.scroller) { try { out.scroll = this.scroller.state(this.scroller.containerOf(el)); } catch { /* none */ } }
    return consoleControlResult(cmd, out);
  }

  private search(cmd: ConsoleControlCommand) {
    const q = cmd.query!;
    if (this.searcher) return consoleControlResult(cmd, { hits: this.searcher(q) });
    const snap = this.snapshot();
    const hits = searchTargets(snap, q);
    const have = new Set(hits.map((h) => h.address));
    // the search index too (views, actions, dialogs, words on the page): everything that maps to an address
    if (!q.kinds?.length || q.kinds.includes('view') || q.kinds.includes('function')) {
      for (const h of this.rt.search.query(q.q, { limit: q.limit ?? 12 })) {
        const f = h.focus as { kind: string; view?: string; spec?: string };
        const address = f.kind === 'view' || f.kind === 'text' ? `view:${f.view}` : f.kind === 'action' ? `function:${f.spec}` : null;
        if (!address || have.has(address)) continue;
        if (q.kinds?.length && !q.kinds.includes(f.kind === 'action' ? 'function' : 'view')) continue;
        have.add(address);
        hits.push({ address, kind: f.kind === 'action' ? 'function' : 'view', label: h.label, ...(h.detail ? { detail: h.detail } : {}), score: Math.round(h.score * 1000) / 1000 });
      }
      hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    }
    return consoleControlResult(cmd, { hits: hits.slice(0, q.limit ?? 12) });
  }

  private list(cmd: ConsoleControlCommand & { address?: string }) {
    const snap = this.snapshot();
    const targets = listTargets(snap, cmd.address ?? null);
    return consoleControlResult(cmd, { view: snap.view, targets });
  }

  private async plugin(cmd: ConsoleControlCommand & { address?: string }) {
    const { entry, address } = this.resolveEntry(cmd.address!, cmd.verb);
    if (entry.def.kind !== 'plugin') throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, `${address} is not a plugin`, { field: 'address' });
    if (!entry.def.set) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.NOT_IMPLEMENTED, `${address} cannot be turned on or off from here`, { can: targetCan(toTarget(entry)) });
    const enabled = cmd.verb === 'plugin.enable';
    const refused = await maybe(entry.def.set(enabled));
    if (typeof refused === 'string' && refused) throw new ConsoleControlError(CONSOLE_CONTROL_WIRE.INVALID, refused, { field: 'address' });
    return consoleControlResult(cmd, { plugin: entry.parsed[entry.parsed.length - 1]!.id, enabled });
  }

  /* ---------------- DOM helpers ---------------- */

  private async elementOf(entry: Entry): Promise<Element | null> {
    let el = entry.def.element?.() ?? null;
    if (!el) { await nextFrame(); el = entry.def.element?.() ?? null; }
    if (!el) { await wait(120); el = entry.def.element?.() ?? null; }
    return el;
  }

  /** Highlight an element through theme tokens for `ms` (one at a time). */
  highlight(el: Element, ms: number): void {
    if (this.highlighted) { clearTimeout(this.highlighted.timer); this.highlighted.el.classList.remove(CONTROL_HIGHLIGHT_CLASS); }
    if (ms <= 0) return;
    el.classList.remove(CONTROL_HIGHLIGHT_CLASS);
    void (el as HTMLElement).offsetWidth; // restart the animation
    el.classList.add(CONTROL_HIGHLIGHT_CLASS);
    this.highlighted = { el, timer: setTimeout(() => { el.classList.remove(CONTROL_HIGHLIGHT_CLASS); this.highlighted = null; }, ms) };
  }

  /** Scan the document for `data-axf-target` elements and register them (a MutationObserver keeps it current). */
  installDomScanner(root: ParentNode = document): () => void {
    const owned = new Map<Element, () => void>();
    const scan = () => {
      const seen = new Set<Element>();
      for (const el of root.querySelectorAll<HTMLElement>(`[${CONTROL_TARGET_ATTR}]`)) {
        seen.add(el);
        if (owned.has(el)) continue;
        const rel = el.getAttribute(CONTROL_TARGET_ATTR) ?? '';
        const scope = el.closest(`[${CONTROL_SCOPE_ATTR}]`)?.getAttribute(CONTROL_SCOPE_ATTR) ?? null;
        let kind: ConsoleControlKind;
        try { kind = parseAddress(rel)[parseAddress(rel).length - 1]!.kind; } catch { continue; }
        const off = this.register({
          address: rel, kind, label: domLabel(el), element: () => el, invoke: () => el.click(),
          get: () => domValue(el), isDisabled: () => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true',
        }, scope);
        owned.set(el, off);
      }
      for (const [el, off] of owned) if (!seen.has(el)) { off(); owned.delete(el); }
    };
    scan();
    let pending: ReturnType<typeof setTimeout> | null = null;
    const mo = new MutationObserver(() => { if (pending) return; pending = setTimeout(() => { pending = null; scan(); }, 60); });
    // a document by its node type, not `instanceof Document`: that needs a global constructor jsdom hosts don't install
    mo.observe((root as Node).nodeType === 9 ? (root as Document).documentElement : (root as Node), { childList: true, subtree: true, attributes: true, attributeFilter: [CONTROL_TARGET_ATTR, CONTROL_SCOPE_ATTR] });
    return () => { mo.disconnect(); if (pending) clearTimeout(pending); for (const off of owned.values()) off(); owned.clear(); };
  }
}

/* ================================================================== helpers */

const registries = new WeakMap<AxfRuntime, ControlRegistry>();

/** The registry of a runtime (created on first use). */
export function controlRegistry(rt: AxfRuntime): ControlRegistry {
  let r = registries.get(rt);
  if (!r) { r = new ControlRegistry(rt); registries.set(rt, r); }
  return r;
}

export function composeAddress(scope: string | null | undefined, address: string): string {
  const a = address.trim();
  if (!scope || a.startsWith('view:') || a.startsWith('plugin:')) return a;
  return `${scope}/${a}`;
}

function toTarget(e: Entry): ControlTarget {
  const d = e.def;
  const t: ControlTarget = { address: e.address, kind: d.kind, label: d.label };
  if (d.detail) t.detail = d.detail;
  if (d.icon) t.icon = d.icon;
  if (d.keywords?.length) t.keywords = d.keywords.filter(Boolean).slice(0, 24);
  if (d.requires) t.requires = d.requires;
  if (d.can) t.can = d.can;
  if (e.parsed.length > 1) t.parent = formatAddress(e.parsed.slice(0, -1));
  if (d.get) { try { const v = d.get(); if (v !== undefined && v !== null && typeof v !== 'object') t.value = v; } catch { /* a getter may run before render */ } }
  if (d.isDisabled) { try { if (d.isDisabled()) t.disabled = true; } catch { /* same */ } }
  if (d.destructive) t.destructive = true;
  if (d.virtual) t.virtual = true;
  return t;
}

/** A single setting as a target: open = its tab scrolled to it; get / set through the settings registry with the value parser. */
export function settingTargetDef(rt: AxfRuntime, spec: SettingSpec, address: string, detail: string, open?: () => unknown): ControlTargetDef {
  const secret = spec.kind === 'secret';
  return {
    address, kind: 'setting', label: spec.label, detail, icon: spec.icon, keywords: [spec.description ?? '', spec.key],
    ...(spec.requires ? { requires: spec.requires } : {}),
    can: ['open', 'state', 'focus', ...(secret ? [] : ['set' as const])],
    element: () => byAnchor(`setting:${spec.key}`),
    open,
    get: () => (secret ? (rt.settings.get(spec.key) ? '••••' : '') : rt.settings.get(spec.key)),
    set: (value) => {
      if (secret) return 'a secret is never set from a command';
      const raw = typeof value === 'boolean' ? (value ? 'on' : 'off') : Array.isArray(value) ? value.join(',') : String(value);
      const r = consoleFieldValue({ kind: spec.kind, label: spec.label, key: spec.key, options: spec.options, min: spec.min, max: spec.max }, raw, rt.settings.get(spec.key));
      if (r.error) return r.error;
      if (spec.requires && rt.gate(spec.requires) !== 'allow') return `${spec.label} needs ${spec.requires}`;
      rt.settings.set(spec.key, r.value as never);
      return undefined;
    },
    isDisabled: () => !!spec.requires && rt.gate(spec.requires) !== 'allow',
    state: () => ({ type: spec.kind, ...(spec.options ? { options: spec.options.map((o) => o.value) } : {}), ...(spec.min !== undefined ? { min: spec.min } : {}), ...(spec.max !== undefined ? { max: spec.max } : {}), ...(secret ? { secret: true } : {}) }),
  };
}

/** A string safe inside a CSS attribute selector. */
export const escapeSelector = (s: string) => cssEscape(s);
/** A label as an address id: `Restore defaults` → `restore-defaults`. */
export const controlSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const cssEscape = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));
const byAnchor = (anchor: string): Element | null => (typeof document === 'undefined' ? null : document.querySelector(`[data-axf-anchor="${cssEscape(anchor)}"]`));
const maybe = async (v: unknown) => (isPromise(v) ? await v : v);
const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function scrollTo(el: Element) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
}

function focusElement(el: Element) {
  const target = el.matches('input, select, textarea, button, a[href], [tabindex]') ? el : el.querySelector<HTMLElement>('input, select, textarea, button, a[href], [tabindex]');
  (target as HTMLElement | null)?.focus?.({ preventScroll: true });
}

function domLabel(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute(CONTROL_TARGET_ATTR) || '').trim().slice(0, 160);
}

function domValue(el: HTMLElement): unknown {
  if (el instanceof HTMLInputElement) return el.type === 'checkbox' ? el.checked : el.value;
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return el.value;
  for (const a of ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-expanded']) { const v = el.getAttribute(a); if (v !== null) return v === 'true'; }
  return (el.textContent ?? '').trim().slice(0, 200);
}

/* ================================================================== React */

const ScopeContext = createContext<string | null>(null);

/** The address prefix for everything inside (a view, a tab panel, a grid row). Renders a `display: contents` div carrying data-axf-scope. */
export function ControlScope({ address, children }: { address: string; children: ReactNode }) {
  const parent = useContext(ScopeContext);
  const full = composeAddress(parent, address);
  return createElement(ScopeContext.Provider, { value: full }, createElement('div', { [CONTROL_SCOPE_ATTR]: full, className: 'fx-control-scope' }, children));
}

/** The enclosing scope's address, or null. */
export function useControlScope(): string | null { return useContext(ScopeContext); }

/**
 * Register a target for the component's lifetime. Returns a ref callback for the element focus scrolls to and highlights
 * (the def's own `element` wins when given). Pass null to register nothing. Re-registers when `address`, `label` or `deps` change.
 */
export function useControlTarget(def: ControlTargetDef | null, deps: readonly unknown[] = []): (el: Element | null) => void {
  const rt = useOptionalRuntime();
  const scope = useContext(ScopeContext);
  const elRef = useRef<Element | null>(null);
  const defRef = useRef(def);
  defRef.current = def;
  const setEl = useMemo(() => (el: Element | null) => { elRef.current = el; }, []);
  useLayoutEffect(() => {
    if (!rt || !def) return;
    const live: ControlTargetDef = {
      ...def,
      element: def.element ?? (() => elRef.current),
      // every handler reads the latest def, so a re-render never needs a re-register
      get: def.get ? () => defRef.current?.get?.() : undefined,
      set: def.set ? (v) => defRef.current?.set?.(v) : undefined,
      invoke: def.invoke ? (v) => defRef.current?.invoke?.(v) : undefined,
      open: def.open ? () => defRef.current?.open?.() : undefined,
      materialize: def.materialize ? () => defRef.current?.materialize?.() : undefined,
      select: def.select ? () => defRef.current?.select?.() : undefined,
      expand: def.expand ? () => defRef.current?.expand?.() : undefined,
      isDisabled: def.isDisabled ? () => defRef.current?.isDisabled?.() ?? false : undefined,
      state: def.state ? () => defRef.current?.state?.() ?? {} : undefined,
    };
    return controlRegistry(rt).register(live, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, scope, def?.address, def?.kind, def?.label, def?.destructive, def?.virtual, ...deps]);
  return setEl;
}

/** Register a list of targets (a tab row's tabs, a grid's rows) for the component's lifetime; re-registers when `key` changes. Handlers read the latest defs. */
export function useControlTargets(defs: ControlTargetDef[], key: string): void {
  const rt = useOptionalRuntime();
  const scope = useContext(ScopeContext);
  const defsRef = useRef(defs);
  defsRef.current = defs;
  useLayoutEffect(() => {
    if (!rt) return;
    const reg = controlRegistry(rt);
    const offs = defsRef.current.map((d, i) => {
      const at = () => defsRef.current[i] ?? d;
      const live: ControlTargetDef = {
        ...d,
        element: () => at().element?.() ?? null,
        get: d.get ? () => at().get?.() : undefined, set: d.set ? (v) => at().set?.(v) : undefined, invoke: d.invoke ? (v) => at().invoke?.(v) : undefined, open: d.open ? () => at().open?.() : undefined,
        materialize: d.materialize ? () => at().materialize?.() : undefined, select: d.select ? () => at().select?.() : undefined, expand: d.expand ? () => at().expand?.() : undefined,
        isDisabled: d.isDisabled ? () => at().isDisabled?.() ?? false : undefined, state: d.state ? () => at().state?.() ?? {} : undefined,
      };
      return reg.register(live, scope);
    });
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rt, scope, key]);
}

/** Register every view of the shell as a target (open = navigate). AppShell calls it. */
export function useViewTargets(views: Record<string, { title: string; icon?: string; keywords?: string[] }>): void {
  const rt = useRuntime();
  useEffect(() => {
    const reg = controlRegistry(rt);
    const offs = Object.entries(views).map(([id, v]) => reg.register({ address: `view:${id}`, kind: 'view', label: v.title, icon: v.icon, keywords: [id, ...(v.keywords ?? [])], open: () => rt.navigate(id), element: () => document.querySelector(`[data-axf-view="${cssEscape(id)}"]:not([hidden]), .fx-main__inner:not([hidden])`) }));
    return () => offs.forEach((off) => off());
  }, [rt, Object.keys(views).join('|')]);
}

/**
 * Install the registry on a runtime: the search provider (every target is findable), the actions that carry the verbs
 * through console.actions (`console-control:<json or words>`, `control.focus:<address>`, …) and the DOM scanner. AxfProvider calls it.
 */
export function installControlRegistry(rt: AxfRuntime): () => void {
  const reg = controlRegistry(rt);
  const offs: (() => void)[] = [];
  offs.push(rt.search.add('axf.control-targets', () => reg.snapshot().targets
    .filter((t) => t.kind !== 'view' && t.kind !== 'setting' && t.kind !== 'tab' && t.kind !== 'panel' && t.kind !== 'function') // those kinds are listed by their own providers
    .map((t) => ({ id: `target:${t.address}`, kind: 'target', label: t.label, detail: t.detail ?? targetKindLabel(t.kind), icon: t.icon ?? 'crosshair', keywords: [...(t.keywords ?? []), t.address], ...(t.requires ? { requires: t.requires } : {}), focus: { kind: 'control', address: t.address } }))));
  const act = (spec: unknown) => { void reg.run(spec).then((r) => { if (!r.ok) rt.terminal.warn('control', `${r.code}: ${r.message}`); }); return true; };
  offs.push(rt.actions.register(CONTROL_ACTION, (args) => { void reg.run_text(args.join(':')); return true; }, { label: 'Console control command (console-control@1)', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.focus, (args) => act({ verb: 'focus', address: args.join(':') }), { label: 'Focus a control by address', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.open, (args) => act({ verb: 'open', address: args.join(':') }), { label: 'Open a control by address', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.press, (args) => act({ verb: 'press', address: args.join(':') }), { label: 'Press a button or function by address', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.set, ([address, ...rest]) => act({ verb: 'set', address, value: rest.join(':') }), { label: 'Set a setting, tab or selection by address', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.scroll, ([dir, amount, ...rest]) => act({ verb: 'scroll', scroll: { dir, ...(amount && dir !== 'to' ? { amount: Number(amount) } : {}), ...(dir === 'to' ? { to: [amount, ...rest].join(':') } : {}) } }), { label: 'Scroll the active pane', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.search, (args) => act({ verb: 'search', query: { q: args.join(':') } }), { label: 'Search everything on screen', params: true, module: 'axf.framework' }));
  offs.push(rt.actions.register(CONTROL_ACTIONS.state, (args) => act({ verb: 'state', ...(args.length ? { address: args.join(':') } : {}) }), { label: 'Read a control by address', params: true, module: 'axf.framework' }));
  if (typeof document !== 'undefined' && typeof MutationObserver === 'function') offs.push(reg.installDomScanner(document));
  return () => offs.forEach((off) => off());
}

/** Words for a kind in search results. */
export function targetKindLabel(kind: ConsoleControlKind): string {
  return ({ view: 'Page', tab: 'Tab', subtab: 'Tab', setting: 'Setting', button: 'Button', function: 'Action', plugin: 'Plugin', grid: 'Grid', row: 'Row', step: 'Step', panel: 'Panel', scroll: 'Pane' } as Record<ConsoleControlKind, string>)[kind] ?? kind;
}

/** The verbs and their permissions, for a host that gates commands before they reach the registry. */
export const CONTROL_VERBS = CONSOLE_CONTROL_VERBS;
export const CONTROL_FRAME = CONSOLE_CONTROL_FRAME;
