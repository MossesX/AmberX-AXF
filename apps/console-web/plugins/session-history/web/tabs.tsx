/** Context, Tools and Conversation tabs of an expanded run (paged from runs/{id}/events). */
import { useEffect, useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { fmtTokens, fmtUsd, fmtWhen, type Tokens } from './core';

const FOLDER = 'session-history';
const PAGE = 60;

export type Tab = 'context' | 'tools' | 'conversation';
export interface Ev { n: number; at?: string; role?: string; kind: string; label?: string; text?: string; tool?: string; input?: unknown; isError?: boolean; sidechain?: boolean }
export interface Turn { turn: number; at?: string | null; model?: string | null; inputs: Ev[]; outputs: Ev[]; usage?: Tokens | null; usd?: number | null }
export interface ToolCall { n: number; turn: number; at?: string; tool: string; summary: string; input?: unknown; result: string; isError: boolean; done: boolean; sidechain?: boolean; usd?: number | null }
export interface Said { n: number; at?: string; who: 'you' | 'claude'; text: string; turn: number }
interface Page<T> { total: number; offset: number; items: T[] }

/** Pages of one tab; `version` changes (the run grew) reload the first page. */
export function usePaged<T>(runId: string, tab: Tab, version: string): { items: T[]; total: number; more: () => void; loading: boolean; error: string } {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fetchPage = async (offset: number, keep: T[]) => {
    setLoading(true);
    try {
      const r = await pluginFetch(FOLDER, `runs/${encodeURIComponent(runId)}/events?tab=${tab}&offset=${offset}&limit=${Math.max(PAGE, keep.length && offset === 0 ? keep.length : PAGE)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Page<T>;
      setItems(offset === 0 ? j.items : [...keep, ...j.items]);
      setTotal(j.total);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void fetchPage(0, items); }, [runId, tab, version]);
  return { items, total, loading, error, more: () => void fetchPage(items.length, items) };
}

function Text({ text, cls = '' }: { text?: string; cls?: string }) {
  const [all, setAll] = useState(false);
  const t = text ?? '';
  const long = t.length > 1200;
  return (
    <div className={`axp-session-history__text fx-small ${cls}`}>
      {long && !all ? `${t.slice(0, 1200)}…` : t}
      {long ? <button type="button" className="axp-session-history__more fx-small" onClick={() => setAll(!all)}>{all ? 'less' : `show all (${t.length.toLocaleString()} characters)`}</button> : null}
    </div>
  );
}

const KIND: Record<string, string> = { prompt: 'prompt', context: 'context', tool_result: 'tool result', text: 'said', thinking: 'thinking', tool_use: 'tool call', init: 'start', result: 'result' };

function EvView({ e }: { e: Ev }) {
  const body = e.kind === 'tool_use' ? `${e.tool}: ${JSON.stringify(e.input ?? {}, null, 1)}` : e.text;
  return (
    <div className={`axp-session-history__ev axp-session-history__ev--${e.role ?? 'x'}`}>
      <span className="fx-small fx-muted">{KIND[e.kind] ?? e.kind}{e.label && e.label !== 'meta' ? ` · ${e.label}` : ''}{e.sidechain ? ' · sub-agent' : ''}{e.isError ? ' · error' : ''}</span>
      <Text text={body} cls={e.kind === 'tool_use' || e.kind === 'tool_result' ? 'fx-mono' : ''} />
    </div>
  );
}

function Pager({ shown, total, loading, more, error }: { shown: number; total: number; loading: boolean; more: () => void; error: string }) {
  return (
    <div className="axp-session-history__pager">
      {error ? <span className="fx-small fx-muted">Couldn’t load ({error}). </span> : null}
      <span className="fx-small fx-muted">{shown} of {total}</span>
      {shown < total ? <Button size="sm" onClick={more} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</Button> : null}
    </div>
  );
}

export function ContextTab({ runId, version }: { runId: string; version: string }) {
  const p = usePaged<Turn>(runId, 'context', version);
  return (
    <div className="fx-stack">
      <ol className="axp-session-history__turns">
        {p.items.map((t) => (
          <li key={t.turn} className="axp-session-history__turn">
            <div className="axp-session-history__turnhead fx-small">
              <strong>Turn {t.turn + 1}</strong>
              <span className="fx-muted">{fmtWhen(t.at)}{t.usage ? ` · ${fmtTokens((t.usage.input ?? 0) + (t.usage.cacheRead ?? 0) + (t.usage.cacheWrite ?? 0) + (t.usage.cacheWrite1h ?? 0))} in · ${fmtTokens(t.usage.output)} out` : ''}</span>
              <span className="fx-grow" />
              {t.usage ? <span className="axp-session-history__price" title="This turn’s tokens at model-pricing@1 prices">{fmtUsd(t.usd)}</span> : null}
            </div>
            {t.inputs.length ? <div className="axp-session-history__in"><span className="fx-small fx-muted">Into its context</span>{t.inputs.map((e) => <EvView key={e.n} e={e} />)}</div> : null}
            {t.outputs.length ? <div className="axp-session-history__out"><span className="fx-small fx-muted">What it said back</span>{t.outputs.map((e) => <EvView key={e.n} e={e} />)}</div> : null}
          </li>
        ))}
      </ol>
      <Pager shown={p.items.length} total={p.total} loading={p.loading} more={p.more} error={p.error} />
    </div>
  );
}

function ToolRow({ c }: { c: ToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="axp-session-history__tool">
      <button type="button" className="axp-session-history__toolbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="fx-small">{open ? '▾' : '▸'} <strong>{c.tool}</strong> <span className="fx-mono">{c.summary}</span></span>
      </button>
      <span className="axp-session-history__toolmeta fx-small">
        {!c.done ? <Chip tone="accent">running</Chip> : c.isError ? <Chip tone="danger">error</Chip> : null}
        {c.sidechain ? <span className="fx-muted"> sub-agent</span> : null}
        <span className="fx-muted"> {fmtWhen(c.at)}</span>
        {c.usd != null ? <span className="axp-session-history__price" title="Its share of the turn that issued it (est.)"> {fmtUsd(c.usd, true)}</span> : null}
      </span>
      {open ? <div className="fx-stack axp-session-history__toolbody"><Text text={JSON.stringify(c.input ?? {}, null, 1)} cls="fx-mono" /><Text text={c.result || (c.done ? '(no output)' : '(waiting for the result)')} cls="fx-mono" /></div> : null}
    </li>
  );
}

export function ToolsTab({ runId, version }: { runId: string; version: string }) {
  const p = usePaged<ToolCall>(runId, 'tools', version);
  return (
    <div className="fx-stack">
      <ul className="axp-session-history__tools">{p.items.map((c) => <ToolRow key={c.n} c={c} />)}</ul>
      <Pager shown={p.items.length} total={p.total} loading={p.loading} more={p.more} error={p.error} />
    </div>
  );
}

export function ConversationTab({ runId, version }: { runId: string; version: string }) {
  const p = usePaged<Said>(runId, 'conversation', version);
  return (
    <div className="fx-stack">
      <div className="axp-session-history__chat">
        {p.items.map((m) => (
          <div key={m.n} className={`axp-session-history__msg axp-session-history__msg--${m.who}`}>
            <span className="fx-small fx-muted">{m.who === 'you' ? 'You' : 'Claude'} · {fmtWhen(m.at)}</span>
            <Text text={m.text} />
          </div>
        ))}
      </div>
      <Pager shown={p.items.length} total={p.total} loading={p.loading} more={p.more} error={p.error} />
    </div>
  );
}
