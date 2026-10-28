/**
 * AI connection (`ai.amberx.amberx.ai`): the settings and status face of AmberX's AI server. The keys, the profiles,
 * the Claude plan ↔ API switch and the fallback order all live on the server (`apps/amberx-droid/server`); this page
 * only shows them and sends edits (keys are write-only: pasted, saved, never read back).
 *
 * - Settings → Plugins → AI connection: status, the Claude switch, every provider in fallback order (add from the
 *   framework's provider registry, edit model / label / address, paste a key, Test, make active, move up / down,
 *   remove), the server's keep-alive interval. Changing anything needs a hub admin (the server checks).
 * - A `status` widget on the banner (asset `status/amberx-ai`, counter `ai.ok`): green while the AI answers.
 * - View `ask` (Ask my notes): sends the notes that match the question and shows the answer.
 * - `checkAi()` runs on start, every few minutes while the page is visible, and on focus.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { AxfRuntime } from '../../../axf/core';
import { Button, Chip, Container, IconButton, Markdown, Note, Section, Segmented, SelectField, TextField, useRuntime, type AxfWebLibrary } from '../../../axf/react';
import { search, pathOf, type Item, type Store } from '../../notes/web/core';
import { useNotes } from '../../notes/web/store';
import {
  ask, checkAi, clearAiKey, getAiConfig, putAiConfig, saveAiKey, testAiProfile, useAiStatus,
  type AiConfig, type AiProfile, type ProfileEdit,
} from './client';

export * from './client';

const ID = 'ai.amberx.amberx.ai';
const ASSET_ID = 'amberx-ai';
const COUNTER = 'ai.ok';
const K = { badge: 'amberx.ai.badge', every: 'amberx.ai.every' } as const;

/* ---------------------------------------------------------------- the banner badge */

function badgeAsset(known: boolean, provider: string) {
  return {
    $axf: 'asset@1', type: 'status', id: ASSET_ID, name: 'AI', version: '0.1.0', author: 'AI connection plugin',
    description: 'Green while the AI on the AmberX server answers; red otherwise.', tags: ['ai', 'status'],
    data: { counter: COUNTER, onLabel: provider ? `AI · ${provider}` : 'AI', offLabel: known ? 'AI off' : 'AI …', onTone: 'success', offTone: 'danger', dot: true, link: 'ai.status.open' },
  };
}

let painted = '';
function paint(rt: AxfRuntime) {
  const s = checkState();
  const show = rt.settings.get(K.badge) !== false;
  const key = JSON.stringify([s.ok, s.known, s.provider, show]);
  if (key === painted) return;
  painted = key;
  rt.registry.register(badgeAsset(s.known, s.provider), 'app', ID);
  rt.setBadge(COUNTER, s.ok ? 1 : 0);
  if (show) rt.attachToBanner({ type: 'status', id: ASSET_ID, at: 'right', order: 23, origin: ID });
  else rt.detachFromBanner(`status:${ASSET_ID}`);
}

let lastStatus = { ok: false, known: false, provider: '' };
const checkState = () => lastStatus;

let timer: ReturnType<typeof setTimeout> | null = null;
const everyMs = (rt: AxfRuntime) => { const n = Number(rt.settings.get(K.every) ?? 3); return Math.min(60, Math.max(1, Number.isFinite(n) ? n : 3)) * 60_000; };
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

async function refresh(rt: AxfRuntime) {
  const s = await checkAi();
  lastStatus = { ok: s.ok, known: s.known, provider: s.provider };
  paint(rt);
}

function loop(rt: AxfRuntime) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { if (visible()) void refresh(rt); loop(rt); }, everyMs(rt));
}

/* ---------------------------------------------------------------- status line */

function ago(iso: string): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
}

function StatusLine() {
  const rt = useRuntime();
  const s = useAiStatus();
  const [busy, setBusy] = useState(false);
  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--wrap">
        <Chip tone={s.ok ? 'success' : 'danger'}>{s.ok ? 'AI answers' : s.known ? 'AI not answering' : 'Not checked yet'}</Chip>
        {s.provider && <strong>{s.provider}</strong>}
        {s.model && <span className="fx-mono fx-muted">{s.model}</span>}
        {s.checkedAt && <span className="fx-muted">{ago(s.checkedAt)}</span>}
      </div>
      {s.reason && <p className="fx-muted" style={{ margin: 0 }}>{s.reason}</p>}
      <div className="fx-row">
        <Button icon="refresh" size="sm" busy={busy} disabled={busy} onClick={async () => { setBusy(true); try { await refresh(rt); } finally { setBusy(false); } }}>Check now</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the connection settings (admins) */

const toEdit = (p: AiProfile): ProfileEdit => ({ id: p.id, kind: p.kind, label: p.label, model: p.model, baseUrl: p.baseUrl, enabled: p.enabled });

function KeyChip({ p }: { p: AiProfile }) {
  if (p.keySource === 'saved') return <Chip tone="success">{p.pair ? 'token pair saved' : 'key saved'}</Chip>;
  if (p.keySource === 'env') return <Chip tone="success">key from the server</Chip>;
  if (p.keySource === 'not needed') return <Chip>no key needed</Chip>;
  return <Chip tone="warning">no key</Chip>;
}

function HealthChip({ p }: { p: AiProfile }) {
  if (!p.health) return null;
  return <Chip tone={p.health.ok ? 'success' : 'danger'}>{p.health.ok ? `answered${p.health.ms ? ` · ${p.health.ms} ms` : ''}` : 'failed'}</Chip>;
}

function ProfileRow({ p, cfg, index, onChange, setError }: {
  p: AiProfile; cfg: AiConfig; index: number; onChange: (c: AiConfig) => void; setError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(p.label);
  const [model, setModel] = useState(p.model);
  const [base, setBase] = useState(p.baseUrl);
  const [key, setKey] = useState('');
  const [refreshTok, setRefreshTok] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = cfg.kinds.find((k) => k.kind === p.kind);
  const plan = p.kind === 'claude-code';
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const all = cfg.profiles.map(toEdit);
  const save = () => run(async () => { onChange(await putAiConfig({ profiles: all.map((x) => (x.id === p.id ? { ...x, label, model, baseUrl: base } : x)) })); setNote('Saved.'); });
  const move = (d: -1 | 1) => run(async () => {
    const order = [...cfg.order];
    const j = index + d;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    onChange(await putAiConfig({ order }));
  });
  return (
    <Container title={`${index + 1}. ${p.label}`} collapsible defaultOpen actions={
      <div className="fx-row fx-row--wrap">
        {cfg.active === p.id ? <Chip tone="accent">active</Chip> : null}
        <KeyChip p={p} />
        <HealthChip p={p} />
      </div>
    }>
      <div className="fx-stack">
        <div className="fx-row fx-row--wrap">
          <span className="fx-muted">{kind?.label ?? p.kind}</span>
          <span className="fx-mono fx-muted">{p.model || 'no model'}</span>
        </div>
        {p.health && !p.health.ok && p.health.error && <Note tone="warning">{p.health.error}</Note>}
        {p.refreshError && <Note tone="danger">Renewing the token failed: {p.refreshError}</Note>}
        {plan && !cfg.cli && <Note tone="warning">The Claude Code CLI isn't installed on the AmberX server, so the Claude plan can't answer.</Note>}
        <div className="fx-row fx-row--wrap">
          <Button size="sm" tone="primary" disabled={busy || cfg.active === p.id} onClick={() => run(async () => onChange(await putAiConfig({ active: p.id })))}>Make active</Button>
          <Button size="sm" icon="zap" disabled={busy} onClick={() => run(async () => {
            const t = await testAiProfile(p.id);
            setNote(t.ok ? `Answered in ${t.ms ?? 0} ms.` : `Failed: ${t.error ?? 'no answer'}`);
            onChange(await getAiConfig());
          })}>Test</Button>
          <IconButton icon="chevron-up" label="Earlier in the fallback order" disabled={busy || index === 0} onClick={() => void move(-1)} />
          <IconButton icon="chevron-down" label="Later in the fallback order" disabled={busy || index === cfg.order.length - 1} onClick={() => void move(1)} />
          <Button size="sm" icon="edit" tone="ghost" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Edit'}</Button>
          <Button size="sm" icon="trash" tone="danger" confirm={`Remove ${p.label}? Its saved key is deleted too.`} disabled={busy}
            onClick={() => run(async () => onChange(await putAiConfig({ profiles: all.filter((x) => x.id !== p.id) })))}>Remove</Button>
        </div>
        {note && <p className="fx-muted" style={{ margin: 0 }}>{note}</p>}
        {open && (
          <div className="fx-stack">
            <TextField label="Name" value={label} onChange={setLabel} placeholder={kind?.label} />
            {kind && kind.models.length > 0
              ? <SelectField label="Model" value={model} onChange={setModel} empty={`Default (${kind.models[0]})`} options={[...new Set([...kind.models, ...(model ? [model] : [])])].map((m) => ({ value: m, label: m }))} />
              : <TextField label="Model" value={model} onChange={setModel} mono placeholder="model id" />}
            {kind && kind.models.length > 0 && <TextField label="Or type a model id" value={model} onChange={setModel} mono />}
            {kind?.editableBaseUrl && <TextField label="Address" value={base} onChange={setBase} mono placeholder={kind.baseUrl} hint="https, or plain http only to the server itself or a host the server allows." />}
            <Button size="sm" icon="save" disabled={busy} onClick={() => void save()}>Save</Button>
            {(kind?.needsKey ?? true) && (
              <Section title={plan ? 'Claude plan token' : 'Key'} aside={<KeyChip p={p} />}>
                <div className="fx-stack">
                  <TextField label={plan ? 'Access token (sk-ant-oat…)' : 'API key'} type="password" value={key} onChange={setKey} mono
                    hint={plan ? <>From <span className="fx-mono">claude setup-token</span> (long-lived), or the access token of a pair with its refresh token below.</> : kind?.keyUrl ? <>Get one at {kind.keyUrl}</> : undefined} />
                  {plan && <TextField label="Refresh token (sk-ant-ort…, optional)" type="password" value={refreshTok} onChange={setRefreshTok} mono hint="With it the server renews the access token before it expires." />}
                  <div className="fx-row fx-row--wrap">
                    <Button size="sm" tone="primary" icon="key" disabled={busy || !key.trim()} onClick={() => run(async () => {
                      await saveAiKey(p.id, key.trim(), refreshTok.trim() || undefined);
                      setKey(''); setRefreshTok(''); setNote('Key saved on the server. It is never shown again.');
                      onChange(await getAiConfig());
                    })}>Save key</Button>
                    {p.keySource === 'saved' && <Button size="sm" tone="danger" confirm="Delete the saved key?" disabled={busy} onClick={() => run(async () => { await clearAiKey(p.id); onChange(await getAiConfig()); setNote('Key deleted.'); })}>Delete key</Button>}
                  </div>
                  {kind && kind.envNames.length > 0 && <p className="fx-muted fx-small" style={{ margin: 0 }}>Or set <span className="fx-mono">{kind.envNames[0]}</span> on the server.</p>}
                </div>
              </Section>
            )}
          </div>
        )}
      </div>
    </Container>
  );
}

function ConnectionPanel() {
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [error, setError] = useState('');
  const [addKind, setAddKind] = useState('');
  const [every, setEvery] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const c = await getAiConfig(); setCfg(c); setEvery(String(c.keepAliveMin)); setError(''); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const change = (c: AiConfig) => { setCfg(c); setEvery(String(c.keepAliveMin)); void checkAi(); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  if (!cfg) return error ? <Note tone="warning">{error}</Note> : <p className="fx-muted">Loading the AI connection…</p>;
  return (
    <div className="fx-stack fx-stack--lg">
      {error && <Note tone="danger">{error}</Note>}
      <Container title="Claude">
        <div className="fx-stack">
          <Segmented label="Which Claude" value={cfg.claude || 'none'} onChange={(v) => { if (v !== 'none') void run(async () => change(await putAiConfig({ claude: v as 'plan' | 'api' }))); }}
            options={[{ value: 'plan', label: 'Claude plan (subscription)', icon: 'user' }, { value: 'api', label: 'Claude API (key)', icon: 'key' }, ...(cfg.claude ? [] : [{ value: 'none' as const, label: 'Another AI', disabled: true }])]} />
          <p className="fx-muted" style={{ margin: 0 }}>
            {cfg.claude === 'plan' ? 'Claude answers on your Claude subscription, through the Claude Code CLI on the AmberX server.'
              : cfg.claude === 'api' ? 'Claude answers through the Anthropic API with an API key, billed per use.'
                : 'The active AI isn\'t Claude. Pick one to make that Claude active and first in line.'}
          </p>
        </div>
      </Container>
      <Section title={`Providers, in fallback order (${cfg.profiles.length})`} aside={cfg.last ? <span className="fx-muted fx-small">Last answer: {cfg.last.label}{cfg.last.fallback ? ' (fallback)' : ''}</span> : undefined}>
        <div className="fx-stack">
          {cfg.profiles.length === 0 && <p className="fx-muted">None yet. Pick Claude above or add a provider below.</p>}
          {cfg.profiles.map((p, i) => <ProfileRow key={p.id} p={p} cfg={cfg} index={i} onChange={change} setError={setError} />)}
          <div className="fx-row fx-row--wrap">
            <SelectField label="Add a provider" value={addKind} onChange={setAddKind} empty="Pick one…" options={cfg.kinds.map((k) => ({ value: k.kind, label: k.label }))} />
            <Button icon="plus" disabled={busy || !addKind} onClick={() => run(async () => {
              change(await putAiConfig({ profiles: [...cfg.profiles.map(toEdit), { kind: addKind, label: '', model: '', baseUrl: '', enabled: true }] }));
              setAddKind('');
            })}>Add</Button>
          </div>
          <p className="fx-muted fx-small" style={{ margin: 0 }}>The active one is asked first, then the others from the top. A provider that is busy or down is retried a few times, then the next one answers.</p>
        </div>
      </Section>
      <Section title="Keep-alive">
        <div className="fx-row fx-row--wrap">
          <TextField label="Check the AI every (minutes, 0 = off)" type="number" value={every} onChange={setEvery} />
          <Button size="sm" disabled={busy} onClick={() => run(async () => change(await putAiConfig({ keepAliveMin: Math.round(Number(every)) })))}>Save</Button>
        </div>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------- Ask my notes */

const STOP = new Set(['the', 'and', 'for', 'what', 'when', 'where', 'which', 'who', 'how', 'did', 'does', 'was', 'are', 'is', 'my', 'me', 'about', 'with', 'from', 'that', 'this', 'have', 'any', 'you', 'your', 'can', 'tell', 'there']);

/** The notes worth sending for a question: everything when there are few, else the ones most of its words hit. */
export function notesFor(store: Store, question: string, max = 60): Item[] {
  const all = search(store, {});
  if (all.length <= max) return all;
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const score = new Map<string, number>();
  for (const w of words) for (const it of search(store, { q: w })) score.set(it.id, (score.get(it.id) ?? 0) + 1);
  const hits = all.filter((i) => score.has(i.id)).sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
  return (hits.length ? hits : all).slice(0, max);
}

function AskView() {
  const notes = useNotes();
  const s = useAiStatus();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; sent: number } | null>(null);
  const [error, setError] = useState('');
  const go = async () => {
    const question = q.trim();
    if (!question) return;
    setBusy(true); setError(''); setAnswer(null);
    const picked = notesFor(notes.view, question);
    const a = await ask(question, picked.map((i) => ({ title: i.title, text: i.text, list: pathOf(notes.view, i.list) })));
    setBusy(false);
    if (a === null) setError('The AI didn\'t answer. Check Settings → Plugins → AI connection.');
    else setAnswer({ text: a, sent: picked.length });
  };
  const total = Object.keys(notes.view.items).length;
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div>
          <p className="fx-eyebrow">AI</p>
          <h1>Ask my notes</h1>
          <p className="fx-muted">The AI answers only from your notes ({total} {total === 1 ? 'note' : 'notes'}).</p>
        </div>
      </header>
      {!s.ok && s.known && <Note tone="warning">{s.reason || 'The AI isn\'t answering right now.'}</Note>}
      <form className="fx-stack" onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <TextField label="Your question" value={q} onChange={setQ} rows={2} placeholder="What did I write about the trip?" />
        <div className="fx-row">
          <Button tone="primary" icon="sparkles" type="submit" busy={busy} disabled={busy || !q.trim()}>{busy ? 'Asking…' : 'Ask'}</Button>
        </div>
      </form>
      {error && <Note tone="danger">{error}</Note>}
      {answer && (
        <Container title="Answer">
          <div className="fx-stack">
            <Markdown text={answer.text} compact />
            <p className="fx-muted fx-small" style={{ margin: 0 }}>From {answer.sent} {answer.sent === 1 ? 'note' : 'notes'}.</p>
          </div>
        </Container>
      )}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) { return <div className="fx-stack">{children}</div>; }

/* ---------------------------------------------------------------- library */

export const library: AxfWebLibrary = {
  id: ID,
  label: 'AI connection',
  version: '0.1.0',
  builtWith: { model: 'opus', builtAt: '2026-10-27' },
  provides: ['amberx.ai'],
  views: { ask: { title: 'Ask my notes', icon: 'sparkles', keywords: ['ask', 'ai', 'question', 'notes', 'answer'], render: () => <AskView /> } },
  nav: { label: 'AI', items: [{ id: 'ask', label: 'Ask my notes', icon: 'sparkles', view: 'ask' }] },
  settingsTabs: [{ id: 'ai', label: 'AI connection', icon: 'sparkles', order: 15, parent: 'plugins', description: 'The AI on the AmberX server: Claude plan or API, other providers as fallbacks.' }],
  settings: [
    { id: 'amberx.ai', label: 'On this device', icon: 'eye', tab: 'ai', order: 30, settings: [
      { key: K.badge, label: 'Show the AI badge on the banner', kind: 'toggle', default: true, scope: 'device', slot: 'banner' },
      { key: K.every, label: 'Check the AI every (minutes)', kind: 'number', default: 3, min: 1, max: 60, step: 1 },
    ] },
  ],
  settingsPanels: [
    { id: 'amberx.ai.status', tab: 'ai', title: 'Status', icon: 'sparkles', order: 5, render: () => <Panel><StatusLine /></Panel> },
    { id: 'amberx.ai.connection', tab: 'ai', title: 'Connection', icon: 'cloud', order: 10, render: () => <ConnectionPanel /> },
  ],
  contextMenu: [{ id: 'amberx.ai', items: [{ id: 'ai.ask', label: 'Ask my notes', icon: 'sparkles', action: 'nav:ask' }] }],
  register(rt) {
    rt.actions.register('ai.status.open', () => rt.dispatch('settings.open:ai'), { label: 'Show the AI connection' });
    rt.actions.register('ai.check', () => void refresh(rt), { label: 'Check the AI now' });
    for (const k of Object.values(K)) rt.settings.onChange(k, () => { painted = ''; paint(rt); if (k === K.every) loop(rt); });
    paint(rt);
    void refresh(rt);
    loop(rt);
    const onFocus = () => { if (visible()) void refresh(rt); };
    globalThis.addEventListener?.('focus', onFocus);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onFocus);
  },
};

export default library;
