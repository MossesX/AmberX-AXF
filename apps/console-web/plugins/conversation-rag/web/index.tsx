/**
 * Conversations (conversation-rag): two-field entries (entry: value) pulled out of every chat and voice session with
 * Brett; briefs carry only the entries that match their task. Whole sessions are not stored unless "passages" is on. Everything here is also an API route (plugin-commands@1): REST /api/plugins/conversation-rag/…, MCP, CLI, voice.
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
interface Entry { id: string; kind: string; entry: string; value: string; at: string; source: string; session: string; builds: string[]; pinned: boolean; hidden: boolean; manual: boolean }
interface Settings { ai: boolean; passages: boolean; includeHeadless: boolean; briefLedger: boolean; briefMaxEntries: number; briefMaxChars: number; minScore: number; everyMinutes: number }
interface Status { sessions: number; chunks: number; passages: boolean; bySource: Record<string, number>; ledger: number; newest: string; lastRun: { at?: string; seconds?: number; error?: string }; settings: Settings }

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const r = await pluginFetch(FOLDER, path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
};
const SOURCES = [{ value: '', label: 'All sources' }, { value: 'claude-code', label: 'Claude Code chats' }, { value: 'claude-ai', label: 'claude.ai exports' }, { value: 'recording', label: 'Voice recordings' }];
const KINDS = [{ value: '', label: 'All kinds' }, { value: 'rule', label: 'Rules' }, { value: 'mistake', label: 'Mistakes' }, { value: 'decision', label: 'Decisions' }, { value: 'request', label: 'Requests' }];

function EntryRow({ e, onChange }: { e: Entry; onChange?: () => void }) {
  const [edit, setEdit] = useState(false);
  const [entry, setEntry] = useState(e.entry);
  const [value, setValue] = useState(e.value);
  const set = (patch: Partial<Entry>) => void api(`ledger/${e.id}`, patch).then(() => { setEdit(false); onChange?.(); });
  return (
    <li className="axp-conv__item axp-conv__entry">
      <span className="axp-conv__meta">{day(e.at)} · {e.kind} · {e.source}{e.pinned ? ' · pinned' : ''}</span>
      {edit ? (
        <span className="axp-conv__bar" role="toolbar" aria-label="Edit entry">
          <TextField label="Entry" value={entry} onChange={setEntry} />
          <TextField label="Value" value={value} onChange={setValue} />
          <Button size="sm" icon="check" disabled={entry.trim().length < 2 || value.trim().length < 4} onClick={() => set({ entry, value })}>Save</Button>
        </span>
      ) : <span className="axp-conv__snippet"><strong>{e.entry}</strong>: {e.value}</span>}
      {onChange ? (
        <span className="axp-conv__actions">
          <Button size="sm" icon="pencil" onClick={() => setEdit(!edit)}>{edit ? 'Cancel' : 'Edit'}</Button>
          <Button size="sm" icon="pin" onClick={() => set({ pinned: !e.pinned })}>{e.pinned ? 'Unpin' : 'Pin'}</Button>
          <Button size="sm" icon="eye-off" onClick={() => set({ hidden: true })}>Hide</Button>
        </span>
      ) : null}
    </li>
  );
}
const day = (at: string) => (at || '').slice(0, 16).replace('T', ' ');

function SearchTab() {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setHits(null); setEntries([]); return undefined; }
    const t = setTimeout(() => {
      const p = new URLSearchParams({ q, limit: '40', ...(source ? { source } : {}) });
      void api<{ hits: Hit[]; entries: Entry[] }>(`search?${p}`).then((j) => { setHits(j.hits); setEntries(j.entries); }, () => { setHits([]); setEntries([]); });
    }, 220);
    return () => clearTimeout(t);
  }, [q, source]);
  return (
    <div className="axp-conv__stack">
      <div className="axp-conv__bar" role="toolbar" aria-label="Conversation search">
        <TextField label="Search the entries" value={q} onChange={setQ} placeholder="e.g. merge queue, Fable approval" autoFocus />
        <SelectField label="Source" value={source} options={SOURCES} onChange={setSource} />
      </div>
      {hits === null ? <EmptyState icon="search" compact>Type two letters or more. Search is local: no AI, no tokens.</EmptyState>
        : !hits.length && !entries.length ? <EmptyState icon="search" compact>No entry matches that.</EmptyState>
          : (<>
            {entries.length ? <ul className="axp-conv__list">{entries.map((e) => <EntryRow key={e.id} e={e} />)}</ul> : null}
            {hits.length ? (
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
            ) : null}
          </>)}
    </div>
  );
}

function LedgerTab() {
  const [kind, setKind] = useState('rule');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [brief, setBrief] = useState('');
  const [entry, setEntry] = useState('');
  const [value, setValue] = useState('');
  const load = () => void api<{ entries: Entry[]; briefText: string }>(`ledger?${new URLSearchParams({ kind, limit: '200' })}`).then((j) => { setEntries(j.entries); setBrief(j.briefText); }, () => setEntries([]));
  useEffect(load, [kind]);
  return (
    <div className="axp-conv__stack">
      <div className="axp-conv__bar" role="toolbar" aria-label="Entries">
        <SelectField label="Kind" value={kind} options={KINDS} onChange={setKind} />
        <TextField label="Entry" value={entry} onChange={setEntry} placeholder="Whole sessions in briefs" />
        <TextField label="Value" value={value} onChange={setValue} placeholder="Don't: paste sessions. Do: one-line entries." />
        <Button icon="plus" disabled={entry.trim().length < 2 || value.trim().length < 4} onClick={() => void api('ledger/add', { entry, value, kind: kind || 'rule' }).then(() => { setEntry(''); setValue(''); load(); })}>Add</Button>
      </div>
      <Container title="Every brief carries (plus the entries that match its task)" icon="file-text">{brief ? <pre className="axp-conv__brief">{brief}</pre> : <EmptyState icon="info" compact>No pinned entries, or the brief switch is off. Matching entries are still added per task.</EmptyState>}</Container>
      <ul className="axp-conv__list">
        {entries.map((e) => <EntryRow key={`${e.id}:${e.entry}:${e.value}:${e.pinned}`} e={e} onChange={load} />)}
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
        <div><p className="fx-eyebrow">Claude files · conversations</p><h1>Conversations</h1><p className="fx-muted">Short entry: value notes from every session with Brett. A brief carries only the ones that match its task.</p></div>
        <div role="toolbar" aria-label="Index">
          <Button icon="refresh" onClick={() => void api('reindex', {}).then(refresh)}>Read new sessions</Button>
        </div>
      </header>
      <p className="axp-conv__meta">{st ? `${st.sessions} sessions · ${st.ledger} entries${st.passages ? ` · ${st.chunks} passages` : ''} · last run ${day(st.lastRun?.at ?? '') || 'not yet'}${st.lastRun?.error ? ` · ${st.lastRun.error}` : ''}` : 'Index unavailable'}</p>
      <TabGroup id="conversation-rag.tabs" label="Conversation sections" value={tab} onChange={setTab} tabs={[{ value: 'search', label: 'Search', icon: 'search' }, { value: 'ledger', label: 'Entries', icon: 'list-checks' }]} />
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
      <Switch label="Put matching entries in every brief" checked={s.briefLedger} onChange={(on) => save({ briefLedger: on })} />
      <Switch label="Also store whole-session passages (off: entries only; switching off deletes them)" checked={s.passages} onChange={(on) => save({ passages: on })} />
      <Switch label="Also index headless build runs" checked={s.includeHeadless} onChange={(on) => save({ includeHeadless: on })} />
      <Switch label="AI tidies entries and answers (uses model tokens)" checked={s.ai} onChange={(on) => save({ ai: on })} />
    </div>
  );
}

export const plugin: AxfWebLibrary = {
  id: 'ai.amberx.axf.console.conversation-rag',
  label: 'Conversations',
  version: '0.2.0',
  appMenu,
  views: { 'conversation-rag': { title: 'Conversations', icon: 'messages-square', render: () => <ConversationsView /> } },
  nav: { label: 'Plugins', items: [{ id: 'conversation-rag', label: 'Conversations', icon: 'messages-square', view: 'conversation-rag' }] },
  settingsTabs: [{ id: 'conversation-rag', label: 'Conversations', icon: 'messages-square', order: 90, parent: 'plugins' }],
  settingsPanels: [
    { id: 'conversation-rag.settings', tab: 'conversation-rag', title: 'Conversation index', icon: 'messages-square', order: 10, render: () => <SettingsPanel /> },
    { id: 'conversation-rag.lifecycle', tab: 'conversation-rag', title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
