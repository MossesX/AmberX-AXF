/**
 * UI shortcuts (web part): open anything in the UI by name or by voice (ui-registry@1). The quick-open dialog (type or
 * speak; aliases and fuzzy words; the first match opens on Enter), the framework action `ui.open:<item id>` every
 * registered item opens through (a view, a dialog, a settings tab + anchor, an action, a URL, or an element on a page:
 * found by `data-axf-ui` / its help id, scrolled to, flashed and clicked when the item says so), `ui-shortcuts.say:<words>`,
 * this console's live registry reported to the server (so a plugin installed a minute ago can be opened by voice), and
 * Settings → Plugins → UI shortcuts: your shortcuts, the mic and spoken answers, what is registered per app.
 *
 * Matching happens on the server through the one rules file (core/engines/ui-registry-rules.mjs); the same functions run
 * here for the dialog's live list, so what you see is what the voice would pick.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Chip, Note, Switch, TextField, useRuntime, type AxfWebLibrary } from '@console/axf/react';
import { UI_ATTR, UI_KIND_LABELS, UI_OPEN_ACTION, mergeUiItems, searchUiItems, uiOpenPlan, uiSay, type UiItem, type UiShortcut } from '@console/axf/core/engines/ui-registry-rules.mjs';
import { uiRegistryFromRuntime } from '@console/axf/core/engines/ui-registry';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu } from './menu';
import './ui-shortcuts.css';

const ID = 'ai.amberx.axf.console.ui-shortcuts';
const FOLDER = 'ui-shortcuts';
const DIALOG = 'ui-shortcuts';
const APP = 'axf-console-web';
const K = { mic: 'ui-shortcuts.mic', speak: 'ui-shortcuts.speak', lang: 'ui-shortcuts.lang' } as const;
const KINDS = ['screen', 'dialog', 'settings', 'setting', 'menu-item', 'nav-item', 'button', 'link', 'tab', 'banner', 'widget', 'action'];
const LIVE_EVERY_MS = 5 * 60_000;
const FLASH_CLASS = 'fx-search-flash';

interface Registry { items: UiItem[]; shortcuts: UiShortcut[]; at: number }
interface SayAnswer { ok: boolean; say?: string; item?: UiItem; via?: string; candidates?: UiItem[]; message?: string; opened?: boolean }
interface AppRow { app: string; folder: string; displayName: string; items: number; generatedFrom: string[] }

const get = <T,>(path: string) => pluginFetch(FOLDER, path).then((r) => r.json() as Promise<T>);
const post = <T,>(path: string, body: unknown, method = 'POST') => pluginFetch(FOLDER, path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);

/* ---------------- the registry this console works from: the server's (every app + live) and its own live items ---------------- */

let cache: Registry | null = null;
let loading: Promise<Registry> | null = null;
async function registry(rt: AxfRuntime, fresh = false): Promise<Registry> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache;
  if (!loading) {
    loading = (async () => {
      let items: UiItem[] = []; let shortcuts: UiShortcut[] = [];
      try { items = (await get<{ items: UiItem[] }>('items?limit=5000')).items ?? []; } catch { /* server part off: this console's own items still work */ }
      try { shortcuts = (await get<{ shortcuts: UiShortcut[] }>('shortcuts')).shortcuts ?? []; } catch { /* none */ }
      const live = uiRegistryFromRuntime(rt, APP);
      cache = { items: mergeUiItems(live, items), shortcuts, at: Date.now() };
      loading = null;
      return cache;
    })();
  }
  return loading;
}

/* ---------------- opening an item in this console ---------------- */

/** Wait for an element to exist (a screen may still be rendering), then scroll, flash and maybe click it. */
function findThen(selector: string, click: boolean, done: (found: boolean) => void, timeoutMs = 3000) {
  const started = Date.now();
  const tick = () => {
    let el: HTMLElement | null = null;
    try { el = document.querySelector<HTMLElement>(selector); } catch { el = null; }
    if (el) {
      const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      el.classList.remove(FLASH_CLASS); void el.offsetWidth; el.classList.add(FLASH_CLASS);
      setTimeout(() => el?.classList.remove(FLASH_CLASS), 1900);
      if (click) setTimeout(() => el?.click(), reduce ? 0 : 350); else el.focus?.({ preventScroll: true });
      done(true); return;
    }
    if (Date.now() - started > timeoutMs) { done(false); return; }
    requestAnimationFrame(tick);
  };
  tick();
}

/** Open one registered item here. → what happened (for the toast / the ack). */
export function openHere(rt: AxfRuntime, item: UiItem, arg?: string): string {
  const plan = uiOpenPlan(item);
  const label = item.label;
  if (plan.via === 'url' && plan.url) { window.open(plan.url, '_blank', 'noopener'); return `opened ${label} in a new tab`; }
  if (plan.via === 'view' && plan.view) { rt.search.focus({ id: `view:${plan.view}`, kind: 'view', label, focus: { kind: 'view', view: plan.view } }); return `opened ${label}`; }
  if (plan.via === 'dialog' && plan.dialog) { rt.openDialog(plan.dialog, arg || plan.arg ? { arg: arg ?? plan.arg } : undefined); return `opened ${label}`; }
  if (plan.via === 'settings' && plan.tab) { rt.search.focus({ id: `settings-tab:${plan.tab}`, kind: 'setting', label, focus: { kind: 'setting', tab: plan.tab, ...(plan.anchor ? { anchor: plan.anchor } : {}) } }); return `opened ${label}`; }
  if (plan.via === 'action' && plan.action) return rt.dispatch(plan.action) ? `ran ${label}` : `${label} didn't run here (no handler, or this role can't)`;
  // an element (a button, link, tab, menu entry, banner, widget, card): go where it lives first, then find it
  if (plan.view) rt.navigate(plan.view);
  else if (plan.tab) rt.dispatch(`settings.open:${plan.tab}`);
  else if (plan.dialog) rt.openDialog(plan.dialog);
  if (plan.via === 'menu' && plan.menu) { const m = document.querySelector<HTMLElement>(`[${UI_ATTR}="menu:${plan.menu}"], [data-axf-menu="${plan.menu}"]`); m?.click(); }
  const selector = plan.selector ?? `[${UI_ATTR}="${item.id}"]`;
  findThen(selector, !!plan.click, (found) => { if (!found) rt.toast(`${label} isn't on this screen (nothing matches ${selector})`, 'warning', 'UI shortcuts'); });
  return `looking for ${label}`;
}

/** Say something here: a shortcut, an alias, a fuzzy match → open it, speak the answer. */
export async function sayHere(rt: AxfRuntime, text: string): Promise<SayAnswer> {
  const reg = await registry(rt);
  const r = uiSay(reg.items, reg.shortcuts, text);
  if ('item' in r && r.item) {
    const what = openHere(rt, r.item, r.shortcut?.arg);
    speak(rt, r.say);
    void post('say', { text, open: false, by: 'console' }).catch(() => undefined); // the server keeps "recent"; this console already opened it
    return { ok: true, say: r.say, item: r.item, via: r.via, message: what, opened: true };
  }
  speak(rt, r.say);
  return { ok: false, say: r.say, candidates: 'candidates' in r ? r.candidates : [] };
}

function speak(rt: AxfRuntime, text: string) {
  if (rt.settings.get(K.speak) !== true || typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = String(rt.settings.get(K.lang) || 'en-US');
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
}

/* ---------------- speech in (when the browser has it) ---------------- */

type Recognition = { lang: string; interimResults: boolean; maxAlternatives: number; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null; start(): void; stop(): void };
const recognizer = (lang: string): Recognition | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 1; return r;
};
const canListen = () => typeof window !== 'undefined' && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);

/* ---------------- the quick-open dialog ---------------- */

function QuickOpen({ close }: { close: () => void }) {
  const rt = useRuntime();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [reg, setReg] = useState<Registry | null>(cache);
  const [answer, setAnswer] = useState<SayAnswer | null>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => { void registry(rt).then(setReg); }, [rt]);
  const hits = useMemo(() => (reg ? searchUiItems(reg.items, q, { kind: kind || undefined, limit: 40 }) : []), [reg, q, kind]);
  const open = useCallback((item: UiItem) => { const what = openHere(rt, item); rt.toast(what, 'info', 'UI shortcuts'); if (item.open.via !== 'dialog') close(); }, [rt, close]);
  const submit = async () => {
    if (!q.trim()) return;
    const r = await sayHere(rt, q);
    setAnswer(r);
    if (r.ok && r.item && r.item.open.via !== 'dialog') close();
  };
  const listen = () => {
    if (listening) { rec.current?.stop(); return; }
    const r = recognizer(String(rt.settings.get(K.lang) || 'en-US'));
    if (!r) { rt.toast('This browser has no speech recognition; type instead.', 'info', 'UI shortcuts'); return; }
    rec.current = r;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript ?? ''; setQ(t); void sayHere(rt, t).then((a) => { setAnswer(a); if (a.ok && a.item && a.item.open.via !== 'dialog') close(); }); };
    r.onend = () => setListening(false);
    r.onerror = (e) => { setListening(false); if (e.error !== 'no-speech') rt.toast(`Could not listen: ${e.error ?? 'error'}`, 'danger', 'UI shortcuts'); };
    setListening(true); r.start();
  };
  const micOn = rt.settings.get(K.mic) !== false && canListen();
  return (
    <div className="axp-ui-shortcuts" data-help="dialog:ui-shortcuts">
      <form className="axp-ui-shortcuts__say" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <TextField label="What do you want to open?" value={q} onChange={setQ} placeholder="plan studio · ui review settings · new plan button · orkestrator" autoFocus />
        <Button type="submit" tone="primary" icon="arrow-right" data-help="ui-say">Open</Button>
        {micOn && <Button type="button" icon="mic" tone={listening ? 'primary' : 'neutral'} onClick={listen} className={listening ? 'axp-ui-shortcuts__listening' : ''} data-help="ui-mic">{listening ? 'Listening…' : 'Speak'}</Button>}
      </form>
      <div className="axp-ui-shortcuts__kinds">
        <Button size="sm" tone={kind ? 'neutral' : 'primary'} onClick={() => setKind('')} data-help="ui-kind">Everything</Button>
        {KINDS.map((k) => <Button key={k} size="sm" tone={kind === k ? 'primary' : 'neutral'} onClick={() => setKind(kind === k ? '' : k)} data-help="ui-kind">{UI_KIND_LABELS[k] ?? k}</Button>)}
      </div>
      {answer && !answer.ok && <Note tone="warning" icon="alert">{answer.say}</Note>}
      {!reg && <Note tone="info">Reading the registry…</Note>}
      <div className="axp-ui-shortcuts__hits" role="list">
        {hits.map((h) => (
          // a menu-style row (the framework's fx-menu__item: hover and focus from the engines), laid out as label + id
          <button key={h.id} type="button" className="fx-menu__item axp-ui-shortcuts__hit" onClick={() => open(h)} data-help="ui-hit" role="listitem" title={h.id}>
            <span className="axp-ui-shortcuts__hit-text"><strong>{h.label}</strong><span className="fx-muted"> · {UI_KIND_LABELS[h.kind] ?? h.kind}{h.owner && h.owner !== 'app' ? ` · ${h.owner.replace(/^(plugin|library):/, '').replace(/^ai\.amberx\.axf\.console\./, '')}` : ''}{h.app && h.app !== APP ? ` · ${h.app}` : ''}</span></span>
            <Chip>{h.id}</Chip>
          </button>
        ))}
        {reg && q.trim() && !hits.length && <Note tone="info">Nothing registered matches. Plugins register their UI in <code>ui-registry.json</code>; <code>axf ui generate</code> scans the rest.</Note>}
      </div>
    </div>
  );
}

/* ---------------- settings: shortcuts, voice, the registry ---------------- */

function ShortcutsPanel() {
  const rt = useRuntime();
  const [list, setList] = useState<UiShortcut[]>([]);
  const [phrase, setPhrase] = useState('');
  const [item, setItem] = useState('');
  const [say, setSay] = useState('');
  const [note, setNote] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const load = useCallback(() => get<{ shortcuts: UiShortcut[] }>('shortcuts').then((r) => setList(r.shortcuts ?? [])).catch(() => setList([])), []);
  useEffect(() => { void load(); }, [load]);
  const add = async () => {
    if (!phrase.trim() || !item.trim()) { setNote({ tone: 'warning', text: 'A shortcut needs a phrase and an item.' }); return; }
    const r = await post<{ ok: boolean; shortcut?: UiShortcut; item?: UiItem; message?: string; candidates?: UiItem[] }>('shortcuts', { phrase, item, say: say || undefined });
    if (r.ok && r.shortcut) { setNote({ tone: 'success', text: `"${r.shortcut.phrase}" opens ${r.item?.label ?? r.shortcut.item} (${r.shortcut.item}).` }); setPhrase(''); setItem(''); setSay(''); cache = null; void load(); }
    else setNote({ tone: 'warning', text: r.candidates?.length ? `Which one: ${r.candidates.slice(0, 4).map((c) => `${c.label} (${c.id})`).join(', ')}? Use the id.` : r.message ?? 'That did not save.' });
  };
  const remove = async (id: string) => { await pluginFetch(FOLDER, `shortcuts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); cache = null; void load(); };
  return (
    <div className="axp-ui-shortcuts">
      <p className="fx-muted">A phrase of your own that opens one item, matched before every other name. Say it to Gizmo, Molly or the quick-open dialog.</p>
      <div className="axp-ui-shortcuts__rows">
        {list.map((s) => (
          <div key={s.id} className="axp-ui-shortcuts__row">
            <span className="axp-ui-shortcuts__row-text"><strong>{s.phrase}</strong>{s.aliases?.length ? <span className="fx-muted">{s.aliases.join(' · ')}</span> : null}</span>
            <span className="axp-ui-shortcuts__row-text"><span>{s.item}</span>{s.say ? <span className="fx-muted">“{s.say}”</span> : null}</span>
            <span className="axp-ui-shortcuts__say">
              <Button size="sm" icon="play" onClick={() => void sayHere(rt, s.phrase)} data-help="ui-shortcut-try">Try</Button>
              <Button size="sm" tone="danger" icon="trash" onClick={() => void remove(s.id)} data-help="ui-shortcut-remove" confirm="Remove this shortcut?">Remove</Button>
            </span>
          </div>
        ))}
        {!list.length && <Note tone="info">No shortcuts yet. Add one below: a phrase, and the item it opens.</Note>}
      </div>
      <div className="axp-ui-shortcuts__add">
        <TextField label="Phrase" value={phrase} onChange={setPhrase} placeholder="my plans" />
        <TextField label="Item (id or words)" value={item} onChange={setItem} placeholder="screen:plan-studio · plan studio screen" />
        <div>
          <TextField label="Spoken answer (optional)" value={say} onChange={setSay} placeholder="Here are your plans." />
          <Button tone="primary" icon="plus" onClick={() => void add()} data-help="ui-shortcut-add">Add shortcut</Button>
        </div>
      </div>
      {note && <Note tone={note.tone}>{note.text}</Note>}
    </div>
  );
}

function VoicePanel() {
  const rt = useRuntime();
  const [mic, setMic] = useState(rt.settings.get(K.mic) !== false);
  const [speakOn, setSpeakOn] = useState(rt.settings.get(K.speak) === true);
  return (
    <div className="axp-ui-shortcuts">
      <Switch label="Microphone button in the quick-open dialog" checked={mic} onChange={(v) => { setMic(v); rt.settings.set(K.mic, v); }} />
      <Switch label="Speak the answers" checked={speakOn} onChange={(v) => { setSpeakOn(v); rt.settings.set(K.speak, v); }} />
      <p className="fx-muted">{canListen() ? 'This browser can listen.' : 'This browser has no speech recognition; Gizmo, Molly and the API still open items by voice through ui-shortcuts_say.'}</p>
    </div>
  );
}

function RegistryPanel() {
  const rt = useRuntime();
  const [apps, setApps] = useState<AppRow[]>([]);
  const [live, setLive] = useState(0);
  const [error, setError] = useState('');
  const load = useCallback(() => get<{ apps: AppRow[]; live: number }>('registry').then((r) => { setApps(r.apps ?? []); setLive(r.live ?? 0); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { void load(); }, [load]);
  const report = async () => { const items = uiRegistryFromRuntime(rt, APP); await post('live', { app: APP, client: 'settings', items }); cache = null; rt.toast(`reported ${items.length} live items`, 'success', 'UI shortcuts'); void load(); };
  return (
    <div className="axp-ui-shortcuts">
      <p className="fx-muted">Every app ships its registry at <code>src/assets/ui-registry/&lt;app&gt;.json</code>; <code>axf ui generate</code> refreshes it and CI fails when new UI is missing. Open consoles add what they have live.</p>
      {error && <Note tone="warning">{error}</Note>}
      <div className="axp-ui-shortcuts__apps">
        {apps.map((a) => <div key={a.app} className="axp-ui-shortcuts__app"><span>{a.displayName} <span className="fx-muted">{a.app}</span></span><Chip>{a.items} items</Chip></div>)}
        <div className="axp-ui-shortcuts__app"><span>Live from open consoles</span><Chip>{live} items</Chip></div>
      </div>
      <div className="axp-ui-shortcuts__say">
        <Button icon="refresh" onClick={() => void load()} data-help="ui-reload">Reload</Button>
        <Button icon="upload" onClick={() => void report()} data-help="ui-report-live">Report this console</Button>
      </div>
    </div>
  );
}

/* ---------------- the library ---------------- */

export const plugin: AxfWebLibrary = {
  id: ID,
  label: 'UI shortcuts',
  version: '0.1.0',
  provides: ['ui-registry@1'],
  builtWith: { model: 'fable', builtAt: '2026-11-06' },
  appMenu,
  opens: 'dialog',
  register(rt) {
    // the framework action every registered item opens through: ui.open:<item id>  (navigate)
    rt.actions.register(UI_OPEN_ACTION, (args) => {
      const id = args.join(':');
      if (!id) { rt.openDialog(DIALOG); return; }
      void registry(rt).then((reg) => {
        const item = reg.items.find((i) => i.id === id) ?? reg.items.find((i) => i.id.toLowerCase() === id.toLowerCase());
        if (item) { rt.toast(openHere(rt, item), 'info', 'UI shortcuts'); return; }
        void sayHere(rt, id).then((a) => { if (!a.ok) rt.toast(a.say ?? `nothing registered as ${id}`, 'warning', 'UI shortcuts'); });
      });
    }, { label: 'Open a registered UI item', params: true, effect: 'navigate' });
    rt.actions.register('ui-shortcuts.dialog', () => rt.openDialog(DIALOG), { label: 'UI shortcuts: open anything by name or voice', effect: 'navigate' });
    rt.actions.register('ui-shortcuts.say', (args) => { void sayHere(rt, args.join(':')).then((a) => { if (!a.ok) rt.toast(a.say ?? 'nothing matched', 'warning', 'UI shortcuts'); }); }, { label: 'Say what to open', params: true, effect: 'navigate' });
    // this console's live registry → the server, so what it has right now can be opened by voice from anywhere
    if (typeof window !== 'undefined') {
      const report = () => { try { void post('live', { app: APP, client: 'console', items: uiRegistryFromRuntime(rt, APP) }).catch(() => undefined); } catch { /* not yet */ } };
      setTimeout(report, 4000);
      const every = setInterval(report, LIVE_EVERY_MS);
      window.addEventListener('pagehide', () => clearInterval(every), { once: true });
    }
  },
  dialogs: { [DIALOG]: { title: 'UI shortcuts', icon: 'zap', render: (_props, close) => <QuickOpen close={close} /> } },
  settingsTabs: [{ id: FOLDER, label: 'UI shortcuts', icon: 'zap', order: 44, parent: 'plugins', description: 'Open anything by name or voice: your shortcuts, the microphone, what is registered.' }],
  settingsPanels: [
    { id: 'ui-shortcuts.shortcuts', tab: FOLDER, title: 'Your shortcuts', icon: 'zap', order: 10, render: () => <ShortcutsPanel /> },
    { id: 'ui-shortcuts.voice', tab: FOLDER, title: 'Voice', icon: 'mic', order: 20, render: () => <VoicePanel /> },
    { id: 'ui-shortcuts.registry', tab: FOLDER, title: 'The registry', icon: 'list', order: 30, render: () => <RegistryPanel /> },
    { id: 'ui-shortcuts.lifecycle', tab: FOLDER, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
