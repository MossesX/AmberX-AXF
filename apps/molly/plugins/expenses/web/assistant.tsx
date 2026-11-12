import { useEffect, useRef, useState } from 'react';
import type { AxfRuntime } from '../../../src/axf/core';
import { Button, Markdown, Note, SelectField, Switch, TextField, useRuntime } from '../../../src/axf/react';
import { apiBase, call, ledgerChanged, useApi } from './api';

/**
 * The Expense Tracker's assistant and settings as Molly screens. The assistant talks to the app's own `/api/ai/*`
 * (same conversations as the standalone app's panel, streamed turns); settings are the app's own rows over
 * `/api/expenses/v1/settings` (same document the app's settings dialog writes). Both are also `expenses.*` actions.
 */

export interface Conversation { id: number; title: string; mode: string; updatedAt: number; messages: number }
export interface Message { id: number; role: 'user' | 'assistant'; content: string }

export const aiBase = (rt: AxfRuntime): string => apiBase(rt).replace(/\/expenses\/v1$/, '/ai');

async function ai<T>(rt: AxfRuntime, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${aiBase(rt)}/${path}`, {
    method: init?.method ?? 'GET', credentials: 'include',
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to Expenses (expenses.amberxai.com) to use its assistant here.' : json.error ?? `HTTP ${res.status}`);
  return json;
}

export const listConversations = (rt: AxfRuntime) => ai<{ conversations: Conversation[] }>(rt, 'conversations');
export const newConversation = (rt: AxfRuntime) => ai<{ conversation: Conversation }>(rt, 'conversations', { method: 'POST', body: { mode: 'chat' } });
export const readConversation = (rt: AxfRuntime, id: number) => ai<{ conversation: Conversation; messages: Message[] }>(rt, `conversations/${id}`);

/** One assistant turn, streamed (server-sent events: text, status, done, error). Resolves with the reply. */
export async function ask(rt: AxfRuntime, id: number, content: string, onText?: (soFar: string, status: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${aiBase(rt)}/conversations/${id}/messages`, {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, context: { title: 'Molly · Expenses', url: location.href } }), signal,
  });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', status = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
      let event = 'message', data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const d = JSON.parse(data) as { text?: string; message?: string; status?: string; changed?: string[] };
      if (event === 'text' && d.text) text += d.text;
      if (event === 'status') status = d.status ?? d.text ?? status;
      if (event === 'done') { if (d.text) text = d.text; if (d.changed?.length) ledgerChanged(); }
      if (event === 'error') throw new Error(d.message ?? 'The assistant stopped.');
      onText?.(text, status);
    }
  }
  return text;
}

/** The conversation on screen (also what `expenses.assistant.ask` talks into when no id is given). */
export const assistantState = { id: null as number | null, listeners: new Set<() => void>() };
export const assistantChanged = () => assistantState.listeners.forEach((f) => f());

export function AssistantScreen() {
  const rt = useRuntime();
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [id, setId] = useState<number | null>(assistantState.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState<{ text: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  assistantState.id = id;

  useEffect(() => { const f = () => setTick((n) => n + 1); assistantState.listeners.add(f); return () => { assistantState.listeners.delete(f); }; }, []);
  useEffect(() => {
    listConversations(rt).then((r) => {
      setConvs(r.conversations); setError(null);
      if (id === null && r.conversations[0]) setId(r.conversations[0].id);
    }, (e: Error) => setError(e.message));
  }, [rt, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (id === null) { setMessages([]); return; }
    readConversation(rt, id).then((r) => setMessages(r.messages), (e: Error) => setError(e.message));
  }, [rt, id, tick]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    let cid = id;
    try {
      if (cid === null) { cid = (await newConversation(rt)).conversation.id; setId(cid); }
      setDraft(''); setMessages((m) => [...m, { id: -1, role: 'user', content: text }]);
      setLive({ text: '', status: 'Thinking…' });
      abort.current = new AbortController();
      await ask(rt, cid, text, (t, s) => setLive({ text: t, status: s }), abort.current.signal);
    } catch (e) { if ((e as Error).name !== 'AbortError') rt.toast((e as Error).message, 'danger', 'Expenses assistant'); }
    setLive(null); abort.current = null; assistantChanged();
  };

  return (
    <div className="axp-exp" data-screen="expenses.assistant">
      <div className="axp-exp__toolbar" role="toolbar" aria-label="Assistant">
        <SelectField label="Conversation" value={id === null ? '' : String(id)} empty="New conversation"
          options={convs.map((c) => ({ value: String(c.id), label: c.title || `Conversation ${c.id}` }))}
          onChange={(v) => setId(v ? Number(v) : null)} className="axp-exp__grow" />
        <Button icon="plus" onClick={() => { setId(null); setMessages([]); }}>New</Button>
        {live && <Button icon="x" tone="danger" onClick={() => abort.current?.abort()}>Stop</Button>}
      </div>
      {error && <Note tone="warning" icon="alert">{error}</Note>}
      <div className="axp-exp__chat" aria-live="polite">
        {!messages.length && !live && <Note tone="info" icon="sparkles">Ask about your spending, paydays or a report: "What did I spend on dining last month?"</Note>}
        {messages.map((m, i) => (
          <div key={`${m.id}-${i}`} className="axp-exp__msg" data-role={m.role}><Markdown text={m.content} compact /></div>
        ))}
        {live && <div className="axp-exp__msg" data-role="assistant">{live.text ? <Markdown text={live.text} compact /> : <p>{live.status || 'Thinking…'}</p>}</div>}
      </div>
      <div className="axp-exp__composer" role="toolbar" aria-label="Message">
        <TextField label="Message" value={draft} onChange={setDraft} rows={3} placeholder="Ask the Expenses assistant" className="axp-exp__grow" />
        <Button icon="arrow-right" tone="primary" busy={!!live} disabled={!draft.trim() || !!live} onClick={send}>Send</Button>
      </div>
    </div>
  );
}

/* --------------------------------- settings -------------------------------- */

export interface SettingRow { key: string; label: string; hint?: string; kind: string; default: unknown; options?: { value: string; label: string }[]; min?: number; max?: number; section: string }
export interface SettingsData { values: Record<string, unknown>; changed: string[]; rows: SettingRow[]; sections: { id: string; title: string; blurb: string }[] }

export const SETTINGS_SECTIONS = [
  { id: 'general', title: 'General', icon: 'settings' },
  { id: 'grid', title: 'Grid & filter', icon: 'grid' },
  { id: 'paydays', title: 'Paydays', icon: 'clock' },
  { id: 'welcome', title: 'Welcome', icon: 'home' },
  { id: 'import', title: 'Import', icon: 'upload' },
  { id: 'ai', title: 'AI', icon: 'sparkles' },
] as const;

export const patchSettings = (rt: AxfRuntime, patch: Record<string, unknown>) => call<SettingsData>(rt, 'settings', { method: 'PATCH', body: patch });

/** One section of the Expense Tracker's settings (Settings → Plugins → Expenses), saved to the app's own document. */
export function SettingsSection({ section }: { section: string }) {
  const rt = useRuntime();
  const { data, error, reload } = useApi<SettingsData>(rt, 'settings');
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  if (error) return <Note tone="warning" icon="alert">{error}</Note>;
  if (!data) return <p>Loading…</p>;
  const rows = data.rows.filter((r) => r.section === section);
  const val = (k: string) => (k in draft ? draft[k] : data.values[k]);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async (patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await patchSettings(rt, patch); setDraft({}); ledgerChanged(); rt.toast(done, 'success', 'Expenses'); } catch (e) { rt.toast((e as Error).message, 'danger', 'Expenses'); }
    setBusy(false);
  };
  const blurb = data.sections.find((s) => s.id === section)?.blurb;
  return (
    <div className="axp-exp__settings" data-screen={`expenses.settings.${section}`}>
      {blurb && <p>{blurb}</p>}
      {rows.map((r) => {
        const v = val(r.key);
        if (r.kind === 'switch') return <Switch key={r.key} label={r.label} hint={r.hint} checked={v === true} onChange={(c) => set(r.key, c)} />;
        if (r.kind === 'select') return <SelectField key={r.key} label={r.label} hint={r.hint} value={String(v ?? '')} options={r.options ?? []} onChange={(x) => set(r.key, x)} />;
        return <TextField key={r.key} label={r.label} hint={r.hint} type={r.kind === 'number' ? 'number' : 'text'} value={String(v ?? '')}
          onChange={(x) => set(r.key, r.kind === 'number' ? (x === '' ? '' : Number(x)) : x)} />;
      })}
      <div className="axp-exp__toolbar" role="toolbar" aria-label="Save settings">
        <Button tone="primary" icon="check" busy={busy} disabled={!Object.keys(draft).length} onClick={() => save(draft, 'Settings saved.')}>Save</Button>
        <Button tone="ghost" icon="undo" disabled={!Object.keys(draft).length} onClick={() => setDraft({})}>Discard</Button>
        <Button tone="ghost" icon="refresh" disabled={!rows.some((r) => data.changed.includes(r.key))}
          onClick={() => save(Object.fromEntries(rows.map((r) => [r.key, null])), 'Back to the defaults.')}>Reset section</Button>
        <Button tone="ghost" icon="refresh" onClick={reload}>Re-read</Button>
      </div>
    </div>
  );
}
