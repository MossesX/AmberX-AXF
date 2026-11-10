/**
 * Conversations (conversation-rag): search every chat and voice session with Brett, and the rules ledger every brief
 * carries. Everything here is also an API route (plugin-commands@1): REST /api/plugins/conversation-rag/…, MCP, CLI, voice.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Container, SelectField, Switch, TabGroup, TextField } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { pluginFetch } from '@console/plugins';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { EmptyState } from '@console/emptyState';
import { appMenu } from './menu';
import './conversation-rag.css';

const FOLDER = 'conversation-rag';

interface Hit { id: number; session: string; source: string; at: string; snippet: string; text: string; topics: string[]; builds: string[]; offset: number; score: number }
interface Entry { id: string; kind: string; text: string; at: string; source: string; session: string; builds: string[]; pinned: boolean; hidden: boolean; manual: boolean }
interface Settings { ai: boolean; includeHeadless: boolean; briefLedger: boolean; briefMaxChars: number; minScore: number; everyMinutes: number }
interface Status { sessions: number; chunks: number; bySource: Record<string, number>; ledger: number; newest: string; lastRun: { at?: string; seconds?: number; error?: string }; settings: Settings }

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await pluginFetch(FOLDER, path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
};
const SOURCES = [{ value: '', label: 'All sources' }, { value: 'claude-code', label: 'Claude Code chats' }, { value: 'claude-ai', label: 'claude.ai exports' }, { value: 'recording', label: 'Voice recordings' }];
const KINDS = [{ value: '', label: 'All kinds' }, { value: 'rule', label: 'Rules' }, { value: 'decision', label: 'Decisions' }, { value: 'request', label: 'Requests' }];
const day = (at: string) => (at || '').slice(0, 16).replace('T', ' ');

function SearchTab() {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return undefined; }
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q, limit: '40', ...(source ? { source } : {}) });
      void api<{ hits: Hit[] }>(`search?${p}`).then((j) => setHits(j.hits), () => setHits([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, source]);
  return (
    <div className="axp-conv__stack">
      <div className="axp-conv__bar" role="toolbar" aria-label="Conversation search">
        <TextField label="Search what was said" value={q} onChange={setQ} placeholder="e.g. merge queue, Fable approval" autoFocus />
        <SelectField label="Source" value={source} options={SOURCES} onChange={setSource} />
      </div>
      {hits === null ? <EmptyState icon="search" compact>Type two letters or more. Search is local: no AI, no tokens.</EmptyState>
        : !hits.length ? <EmptyState icon="search" compact>Nothing said matches that.</EmptyState>
          : (
            <ul className="axp-conv__list">
              {hits.map((h) => (
                <li key={h.id} className="axp-conv__item">
                  <button type="button" data-fx-row className="axp-conv__hit" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}>
                    <span className="axp-conv__meta">{day(h.at)} · {h.source}{h.offset >= 0 ? ` · ${Math.floor(h.offset / 60)}:${String(Math.floor(h.offset % 60)).padStart(2, '0')}` : ''}</span>
                    <span className="axp-conv__snippet">{open === h.id ? h.text : h.snippet}</span>
                    <span className="axp-conv__chips">{h.builds.map((b) => <Chip key={b} tone="accent">{b}</Chip>)}{h.topics.slice(0, 3).map((t) => <Chip key={t}>{t}</Chip>)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
    </div>
  );
}

function LedgerTab() {
  const [kind, setKind] = useState('rule');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [brief, setBrief] = useState('');
  const [text, setText] = useState('');
  const load = () => void api<{ entries: Entry[]; briefText: string }>(`ledger?${new URLSearchParams({ kind, limit: '200' })}`).then((j) => { setEntries(j.entries); setBrief(j.briefText); }, () => setEntries([]));
  useEffect(load, [kind]);
  const set = (id: string, patch: Partial<Entry>) => void api(`ledger/${id}`, patch).then(load);
  return (
    <div className="axp-conv__stack">
      <div className="axp-conv__bar" role="toolbar" aria-label="Rules ledger">
        <SelectField label="Kind" value={kind} options={KINDS} onChange={setKind} />
        <TextField label="Add a rule in Brett's words" value={text} onChange={setText} placeholder="Everything comes with an API." />
        <Button icon="plus" disabled={text.trim().length < 4} onClick={() => void api('ledger/add', { text, kind: kind || 'rule' }).then(() => { setText(''); load(); })}>Add</Button>
      </div>
      <Container title="What every brief carries" icon="file-text">{brief ? <pre className="axp-conv__brief">{brief}</pre> : <EmptyState icon="info" compact>Nothing yet, or the brief switch is off.</EmptyState>}</Container>
      <ul className="axp-conv__list">
        {entries.map((e) => (
          <li key={e.id} className="axp-conv__item axp-conv__entry">
            <span className="axp-conv__meta">{day(e.at)} · {e.kind} · {e.source}{e.pinned ? ' · pinned' : ''}</span>
            <span className="axp-conv__snippet">{e.text}</span>
            <span className="axp-conv__actions">
              <Button size="sm" icon="pin" onClick={() => set(e.id, { pinned: !e.pinned })}>{e.pinned ? 'Unpin' : 'Pin'}</Button>
              <Button size="sm" icon="eye-off" onClick={() => set(e.id, { hidden: true })}>Hide</Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConversationsView() {
  const [tab, setTab] = useState<'search' | 'ledger'>('search');
  const [st, setSt] = useState<Status | null>(null);
  const refresh = () => void api<Status>('status').then(setSt, () => setSt(null));
  useEffect(refresh, []);
  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead">
        <div><p className="fx-eyebrow">Claude files · conversations</p><h1>Conversations</h1><p className="fx-muted">Everything said with Brett in one search, and the standing rules every brief carries.</p></div>
        <div role="toolbar" aria-label="Index">
          <Button icon="refresh" onClick={() => void api('reindex', {}).then(refresh)}>Read new sessions</Button>
        </div>
      </header>
      <p className="axp-conv__meta">{st ? `${st.sessions} sessions · ${st.chunks} passages · ${st.ledger} ledger lines · last run ${day(st.lastRun?.at ?? '') || 'not yet'}${st.lastRun?.error ? ` · ${st.lastRun.error}` : ''}` : 'Index unavailable'}</p>
      <TabGroup id="conversation-rag.tabs" label="Conversation sections" value={tab} onChange={setTab} tabs={[{ value: 'search', label: 'Search', icon: 'search' }, { value: 'ledger', label: 'Rules ledger', icon: 'list-checks' }]} />
      {tab === 'search' ? <SearchTab /> : <LedgerTab />}
    </div>
  );
}

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { void api<{ settings: Settings }>('settings').then((j) => setS(j.settings), () => setS(null)); }, []);
  const save = (patch: Partial<Settings>) => void api<{ settings: Settings }>('settings', patch).then((j) => setS(j.settings));
  if (!s) return <EmptyState icon="info" compact>Settings unavailable.</EmptyState>;
  return (
    <div className="axp-conv__stack">
      <Switch label="Put the rules ledger in every brief" checked={s.briefLedger} onChange={(on) => save({ briefLedger: on })} />
      <Switch label="Also index headless build runs" checked={s.includeHeadless} onChange={(on) => save({ includeHeadless: on })} />
      <Switch label="AI answers in the context pack (uses model tokens)" checked={s.ai} onChange={(on) => save({ ai: on })} />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.conversation-rag',
  label: 'Conversations',
  version: '0.1.0',
  appMenu,
  views: { 'conversation-rag': { title: 'Conversations', icon: 'messages-square', render: () => <ConversationsView /> } },
  nav: { label: 'Plugins', items: [{ id: 'conversation-rag', label: 'Conversations', icon: 'messages-square', view: 'conversation-rag' }] },
  settingsTabs: [{ id: 'conversation-rag', label: 'Conversations', icon: 'messages-square', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'conversation-rag.settings', tab: 'conversation-rag', title: 'Conversation index', icon: 'messages-square', order: 10, render: () => <SettingsPanel /> },
    { id: 'conversation-rag.lifecycle', tab: 'conversation-rag', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
