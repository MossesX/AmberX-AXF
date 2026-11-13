/**
 * Decision dialog console plugin (ai.amberx.axf.console.decision-dialog).
 *
 * Brett, Nov 13 2026: "anytime something goes to UI review I'm gonna get a notification, and another type of dialogue
 * just pops up like approve, for other types of things, an approve deny control panel".
 *
 * One dialog (`decisions.show`) for everything waiting for his decision (decision@1, server queue in this plugin). It
 * pops up by itself on whatever screen he is on and never navigates: the item (title, build, body), its screenshots or
 * options side by side (desktop + phone), and the buttons its source registered (UI Review: Pick option N / Approve,
 * Request changes with a note, Reject), plus Later and the source's "Open in UI Review" (navigates only on his tap).
 * Several waiting stack: "2 of 5" with previous / next. Answered elsewhere (UI Review, voice, the API) = it closes.
 *
 * Browser sources (a plugin whose decision lives only in the page, e.g. a held call's countdown) raise one by firing
 * `axf:decision` on window with decision@1 fields (buttons may name the console action to run, `action`), and take it
 * back with `axf:decision-withdraw` {source, ref}; no plugin names another.
 *
 * Deep link: ?axf-decision=<id>; actions decisions.show:<id> | next | check | later:<id> | answer:<id>:<words>.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AxfRuntime } from '@console/axf/core';
import { Button, Icon, Note, Switch, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginApi, pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu, WAITING } from './menu';
import { matchButton, nextPopup, parseAnswer, place, type Decision, type DecisionButton, type DecisionShot } from './queue';
import './decision-dialog.css';

const ID = 'ai.amberx.axf.console.decision-dialog';
const FOLDER = 'decision-dialog';
const DIALOG = 'decisions.show';
const PARAM = 'axf-decision';
const POLL_MS = 5_000;
const api = pluginApi(FOLDER, 'The decision dialog');
let runtime: AxfRuntime | null = null;

/* ---------------- the queue (one per page) ---------------- */

interface QueueState { items: Decision[]; error: string; checkedAt: number }
let st: QueueState = { items: [], error: '', checkedAt: 0 };
const subs = new Set<() => void>();
const opened = new Set<string>();
let onScreen: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function emit(next: Partial<QueueState>) { st = { ...st, ...next }; for (const f of subs) f(); }
function useQueue(): QueueState { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st); }

export async function checkNow(): Promise<void> {
  try {
    const r = await api.call<{ items: Decision[] }>('list?status=waiting');
    emit({ items: r.items, error: '', checkedAt: Date.now() });
    runtime?.setBadge(WAITING, r.items.length);
    maybePop();
  } catch (e) {
    emit({ error: (e as Error).message || 'unreachable', checkedAt: Date.now() });
  }
}

function maybePop() {
  const rt = runtime;
  if (!rt) return;
  const dlg = rt.getState().dialog;
  const busy = !!dlg && dlg.id !== DIALOG;
  if (dlg?.id !== DIALOG) onScreen = null;
  const id = nextPopup(st.items, opened, onScreen, busy);
  if (id) show(id);
}

export function show(id: string) {
  opened.add(id);
  onScreen = id;
  runtime?.openDialog(DIALOG, { id });
}

function close() { onScreen = null; runtime?.closeDialog(); }

/** After an answer, Later or a withdraw: the next waiting one, else close. */
function advance(fromId: string) {
  const next = st.items.find((d) => d.id !== fromId && d.status === 'waiting');
  if (next) show(next.id); else close();
}

async function answer(d: Decision, button: string, option = '', note = ''): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await api.post<{ action?: string }>('answer', { id: d.id, button, option, note, via: 'console' });
    if (r.action) runtime?.dispatch(r.action); // a browser source's own console action (e.g. a held call's Deny)
    emit({ items: st.items.filter((x) => x.id !== d.id) });
    return { ok: true, message: 'Done.' };
  } catch (e) {
    return { ok: false, message: (e as Error).message || 'That answer did not go through.' };
  }
}

async function later(d: Decision): Promise<void> {
  try { await api.post('later', { id: d.id }); } catch { /* the pop-up still closes; the queue keeps it */ }
  emit({ items: st.items.map((x) => (x.id === d.id ? { ...x, popup: false } : x)) });
}

/* ---------------- the dialog ---------------- */

function Shot({ id, s }: { id: string; s: DecisionShot }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made = '';
    pluginFetch(FOLDER, `shot?id=${encodeURIComponent(id)}&src=${encodeURIComponent(s.src)}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { made = URL.createObjectURL(b); if (live) setUrl(made); }, () => live && setFailed(true));
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, s.src]);
  return (
    <figure className={`axp-decision__shot axp-decision__shot--${s.device || 'any'}`}>
      {url ? <img src={url} alt={s.name || s.device || 'screenshot'} /> : <span className="fx-small fx-muted">{failed ? 'Picture not available' : 'Loading…'}</span>}
      <figcaption className="fx-small fx-muted"><Icon name={s.device === 'phone' ? 'smartphone' : 'monitor'} size={12} /> {s.device || 'screen'}{s.name ? ` · ${s.name}` : ''}</figcaption>
    </figure>
  );
}

function Shots({ id, shots }: { id: string; shots: DecisionShot[] }) {
  if (!shots.length) return null;
  const ordered = [...shots.filter((s) => s.device !== 'phone'), ...shots.filter((s) => s.device === 'phone')];
  return <div className="axp-decision__shots">{ordered.map((s) => <Shot key={s.src} id={id} s={s} />)}</div>;
}

/** 'model-upgrade' → 'Model upgrade'; UI Review keeps its name. */
export function typeLabel(t: string): string { return t === 'ui-review' ? 'UI Review' : (t.charAt(0).toUpperCase() + t.slice(1)).replace(/-/g, ' '); }

const TONE: Record<DecisionButton['kind'], 'primary' | 'danger' | 'neutral'> = { primary: 'primary', danger: 'danger', neutral: 'neutral' };

export function DecisionView({ id }: { id: string }) {
  const q = useQueue();
  const d = q.items.find((x) => x.id === id) ?? null;
  const [busy, setBusy] = useState('');
  const [noteFor, setNoteFor] = useState<DecisionButton | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [openedAt] = useState(() => Date.now());
  useEffect(() => { setNoteFor(null); setNote(''); setResult(null); }, [id]);
  useEffect(() => { const t = setInterval(() => void checkNow(), 3_000); return () => clearInterval(t); }, []);
  // Answered somewhere else (UI Review itself, voice, the phone): say so, then the next one or close.
  const gone = !d && q.checkedAt > openedAt;
  useEffect(() => { if (!gone) return; const t = setTimeout(() => advance(id), 1_500); return () => clearTimeout(t); }, [gone, id]);
  if (!d) return <p className="fx-small fx-muted" role="status">{gone ? 'Already decided. Closing…' : 'Reading it…'}</p>;
  const p = place(q.items, d.id);
  const go = async (button: string, option = '', n = '') => {
    setBusy(button + option);
    setResult(null);
    const r = await answer(d, button, option, n);
    setBusy('');
    if (r.ok) advance(d.id); else setResult(r);
  };
  const tap = (b: DecisionButton) => { if (b.note) { setNoteFor(b); setNote(''); } else void go(b.id); };
  return (
    <div className="fx-stack axp-decision" data-decision={d.id}>
      <div className="axp-decision__head">
        <div className="axp-decision__what">
          <p className="fx-eyebrow">{typeLabel(d.type)}{d.build ? ` · ${d.build}` : ''}{d.app ? ` · ${d.app}` : ''}</p>
          <h2 className="axp-decision__title">{d.title}</h2>
        </div>
        {p.of > 1 && (
          <div className="axp-decision__count" role="toolbar" aria-label="Waiting decisions">
            <Button size="sm" tone="ghost" icon="chevron-left" aria-label="Previous decision" disabled={!p.prev} onClick={() => p.prev && show(p.prev)} />
            <span className="fx-small" aria-live="polite">{p.at} of {p.of} waiting</span>
            <Button size="sm" tone="ghost" icon="chevron-right" aria-label="Next decision" disabled={!p.next} onClick={() => p.next && show(p.next)} />
          </div>
        )}
      </div>
      {d.body && <p className="axp-decision__body">{d.body}</p>}
      {d.options.length > 0 ? (
        <div className="axp-decision__options">
          {d.options.map((o, i) => (
            <div key={o.id} className="axp-decision__option">
              <p className="axp-decision__optlabel"><strong>Option {i + 1}</strong> · {o.label}</p>
              {o.notes && <p className="fx-small fx-muted">{o.notes}</p>}
              <Shots id={d.id} shots={o.shots} />
              <Button tone="primary" icon="check" busy={busy === `pick${o.id}`} disabled={!!busy} onClick={() => void go('pick', o.id)}>Pick option {i + 1}</Button>
            </div>
          ))}
        </div>
      ) : null}
      <Shots id={d.id} shots={d.shots} />
      {noteFor && (
        <div className="fx-stack axp-decision__note">
          <TextField label={`${noteFor.label}: what should change?`} value={note} onChange={setNote} rows={3} autoFocus />
          <div className="fx-row axp-decision__acts" role="toolbar" aria-label="Note">
            <Button tone={TONE[noteFor.kind]} icon="arrow-right" disabled={!note.trim() || !!busy} busy={busy === noteFor.id} onClick={() => void go(noteFor.id, '', note.trim())}>Send</Button>
            <Button tone="ghost" onClick={() => setNoteFor(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {result && !result.ok && <Note tone="danger">{result.message}</Note>}
      <div className="fx-row axp-decision__acts" role="toolbar" aria-label="Decide">
        {d.buttons.map((b) => (
          <Button key={b.id} tone={TONE[b.kind]} icon={b.icon || undefined} disabled={!!busy} busy={busy === b.id} onClick={() => tap(b)}>
            {d.options.length && b.id === 'approve' ? 'Approve as is' : b.label}
          </Button>
        ))}
        <Button tone="ghost" icon="clock" disabled={!!busy} onClick={() => { void later(d); advance(d.id); }}>Later</Button>
        {d.openAction && <Button tone="ghost" icon="external" onClick={() => { close(); runtime?.dispatch(d.openAction); }}>{d.openLabel || 'Open'}</Button>}
      </div>
    </div>
  );
}

/* ---------------- settings: which types pop up ---------------- */

interface DecisionType { id: string; label: string; icon?: string; description?: string }
interface DecisionSettings { popup: Record<string, boolean>; notify: Record<string, boolean>; laterMinutes: number }

function SettingsPanel() {
  const [types, setTypes] = useState<DecisionType[]>([]);
  const [s, setS] = useState<DecisionSettings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.call<{ types: DecisionType[] }>('types').then((r) => setTypes(r.types), (e: Error) => setErr(e.message));
    api.call<DecisionSettings>('settings').then(setS, (e: Error) => setErr(e.message));
  }, []);
  const put = (patch: Partial<DecisionSettings>) => api.put<DecisionSettings>('settings', patch).then(setS, (e: Error) => setErr(e.message));
  if (err) return <Note tone="danger">{err}</Note>;
  if (!s) return <p className="fx-small fx-muted">Reading…</p>;
  return (
    <div className="fx-stack axp-decision-settings">
      {types.map((t) => (
        <div key={t.id} className="axp-decision-settings__row">
          <div className="axp-decision-settings__what"><strong><Icon name={t.icon || 'info'} size={14} /> {t.label}</strong>{t.description && <span className="fx-small fx-muted">{t.description}</span>}</div>
          <Switch label="Pops up" checked={s.popup[t.id] !== false} onChange={(v) => void put({ popup: { [t.id]: v } })} />
          <Switch label="Notifies" checked={s.notify[t.id] !== false} onChange={(v) => void put({ notify: { [t.id]: v } })} />
        </div>
      ))}
      <TextField label="Later waits (minutes)" type="number" value={String(s.laterMinutes)} onChange={(v) => { const n = Number(v); if (Number.isInteger(n) && n >= 1 && n <= 1440) void put({ laterMinutes: n }); }} />
    </div>
  );
}

/** The approve / deny control panel: everything waiting, decided in place (Settings → Plugins → Decision dialog). */
function QueuePanel() {
  const q = useQueue();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const w = q.items.filter((d) => d.status === 'waiting');
  return (
    <div className="fx-stack">
      {(q.error || err) && <Note tone="danger">{q.error || err}</Note>}
      {!w.length ? <p className="fx-small fx-muted">Nothing is waiting for you.</p> : w.map((d) => (
        <div key={d.id} className="fx-row axp-decision-settings__row">
          <span className="axp-decision-settings__what"><strong>{d.title}</strong><span className="fx-small fx-muted">{typeLabel(d.type)}{d.build ? ` · ${d.build}` : ''}</span></span>
          <span className="fx-row axp-decision__acts" role="toolbar" aria-label={`Decide: ${d.title}`}>
            {!d.options.length && d.buttons.filter((b) => !b.note).map((b) => (
              <Button key={b.id} size="sm" tone={TONE[b.kind]} icon={b.icon || undefined} disabled={busy === d.id} onClick={() => { setBusy(d.id); void answer(d, b.id).then((r) => { setBusy(''); if (!r.ok) setErr(r.message); }); }}>{b.label}</Button>
            ))}
            <Button size="sm" icon="eye" onClick={() => show(d.id)}>{d.options.length ? 'Pick…' : 'Show'}</Button>
          </span>
        </div>
      ))}
      <div className="fx-row" role="toolbar" aria-label="Decision queue"><Button size="sm" tone="ghost" icon="refresh" onClick={() => void checkNow()}>Check now</Button></div>
    </div>
  );
}

/* ---------------- browser sources ---------------- */

function onBrowserDecision(e: Event) {
  const f = (e as CustomEvent<Record<string, unknown>>).detail;
  if (!f || typeof f !== 'object') return;
  void api.post('raise', f).then(() => checkNow(), () => undefined);
}
function onBrowserWithdraw(e: Event) {
  const f = (e as CustomEvent<{ source?: string; ref?: string; id?: string }>).detail;
  if (!f || typeof f !== 'object') return;
  void api.post('withdraw', f).then(() => checkNow(), () => undefined);
}

export const plugin: AxfWebLibrary = {
  id: ID, // equals plugin.json "id"
  label: 'Decision dialog',
  version: '0.1.0',
  appMenu,
  register(rt) {
    runtime = rt;
    void checkNow();
    if (!timer) timer = setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') void checkNow(); }, POLL_MS);
    globalThis.addEventListener?.('focus', () => void checkNow());
    globalThis.addEventListener?.('axf:decision', onBrowserDecision);
    globalThis.addEventListener?.('axf:decision-withdraw', onBrowserWithdraw);
    // A dialog that was blocking the pop-up closed: the waiting one comes up now.
    rt.subscribe(() => { if (!rt.getState().dialog) maybePop(); });
    // ?axf-decision=<id>: the notification's tap opens that decision over the screen it lands on.
    const linked = new URLSearchParams(globalThis.location?.search ?? '').get(PARAM);
    if (linked) setTimeout(() => show(linked), 0);
    rt.actions.register('decisions.show', ([id]) => { if (id) show(id); else void checkNow().then(() => (st.items[0] ? show(st.items[0].id) : rt.toast('Nothing is waiting for you.', 'info', 'Decisions'))); }, { label: 'Show a waiting decision', params: true, searchable: false, effect: 'navigate' });
    rt.actions.register('decisions.next', () => void checkNow().then(() => (st.items[0] ? show(st.items[0].id) : rt.toast('Nothing is waiting for you.', 'info', 'Decisions'))), { label: 'Show the decisions waiting for me', effect: 'navigate' });
    rt.actions.register('decisions.check', () => void checkNow(), { label: 'Check for waiting decisions' });
    // decisions.popup:<type|all>:<on|off> and decisions.notify:<type|all>:<on|off> — the per-type switches by name (voice: "UI Review pop-ups off").
    for (const what of ['popup', 'notify'] as const) {
      rt.actions.register(`decisions.${what}`, async ([type = '', value = '']) => {
        const on = /^(on|true|yes|1)$/i.test(value) ? true : /^(off|false|no|0)$/i.test(value) ? false : null;
        if (!type || on === null) { rt.toast(`decisions.${what}:<type|all>:<on|off>`, 'warning', 'Decisions'); return; }
        try {
          const s = await api.call<DecisionSettings>('settings');
          const ids = type === 'all' ? Object.keys(s[what]) : [type];
          await api.put('settings', { [what]: Object.fromEntries(ids.map((id) => [id, on])) });
          rt.toast(`${type === 'all' ? 'Every decision' : typeLabel(type)}: ${what === 'popup' ? 'pops up' : 'notifies'} ${on ? 'on' : 'off'}`, 'success', 'Decisions');
          void checkNow();
        } catch (e) { rt.toast((e as Error).message, 'danger', 'Decisions'); }
      }, { label: `Decision ${what === 'popup' ? 'pop-up' : 'notification'} on or off per type (decisions.${what}:<type|all>:<on|off>)`, params: true });
    }
    rt.actions.register('decisions.later', ([id]) => { const d = st.items.find((x) => x.id === id); if (d) { void later(d); if (onScreen === id) advance(id); } }, { label: 'Ask again later', params: true, searchable: false });
    // decisions.answer:<id|latest|N>:<words> — 'pick option 2', 'approve it', 'request changes: bigger'. His tap or words only.
    rt.actions.register('decisions.answer', async ([ref = 'latest', ...rest]) => {
      await checkNow();
      const d = ref === 'latest' || !ref ? st.items[0] : /^\d+$/.test(ref) ? st.items[Number(ref) - 1] : st.items.find((x) => x.id === ref || x.id.startsWith(ref));
      const a = parseAnswer(rest.join(':'));
      if (!d) { rt.toast('Nothing like that is waiting.', 'info', 'Decisions'); return; }
      if (!a) { rt.toast('Say pick option N, approve, request changes: <note>, reject, deny, shelve or later.', 'warning', 'Decisions'); return; }
      if (a.button === 'later') { void later(d); return; }
      const button = a.button === 'pick' ? 'pick' : matchButton(d, a.button);
      if (!button) { rt.toast(`"${a.button}" isn't an answer here: ${d.buttons.map((b) => b.label).join(', ')}.`, 'warning', 'Decisions'); return; }
      const r = await answer(d, button, a.option ?? '', a.note ?? '');
      rt.toast(r.ok ? `${d.title}: ${button === 'pick' ? `option ${a.option}` : button}` : r.message, r.ok ? 'success' : 'danger', 'Decisions');
      if (r.ok && onScreen === d.id) advance(d.id);
    }, { label: 'Answer a decision (decisions.answer:<id|latest|N>:<pick option 2 | approve | request changes: note | reject | deny>)', params: true, searchable: false, personOnly: true });
  },
  dialogs: {
    [DIALOG]: { title: 'Waiting for your decision', icon: 'shield', searchable: false, render: (p) => <DecisionView id={typeof p.id === 'string' ? p.id : ''} /> },
  },
  settingsTabs: [{ id: 'decision-dialog', label: 'Decision dialog', icon: 'shield', order: 9, parent: 'plugins' }],
  settingsPanels: [
    { id: 'decision-dialog.queue', tab: 'decision-dialog', title: 'Waiting for you', icon: 'clock', order: 5, render: () => <QueuePanel /> },
    { id: 'decision-dialog.types', tab: 'decision-dialog', title: 'Which decisions pop up', icon: 'bell', order: 10, render: () => <SettingsPanel /> },
    { id: 'decision-dialog.lifecycle', tab: 'decision-dialog', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
