/** Watch a running run live (its live file tailed every 2 s) and kill a running headless / agent run (tap twice). */
import { useEffect, useRef, useState } from 'react';
import { Button, Chip } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';
import { fmtTokens, fmtUsd, STATUS_LABEL, statusTone, type Run } from './core';

const FOLDER = 'session-history';
const TAIL_MS = 2000;
const KEEP = 600;

interface TailEv { at?: string; role?: string; kind: string; text?: string; tool?: string; input?: Record<string, unknown>; isError?: boolean; sidechain?: boolean }
interface Tail { offset: number; events: TailEv[]; status: string; usd?: number | null; tokensTotal?: number }

/** One readable line per event (same idea as deploy/claude-stream.mjs). */
export function tailLine(e: TailEv): string {
  const one = (s: unknown, n = 220) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  if (e.kind === 'tool_use') {
    const i = e.input ?? {};
    const pick = i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt;
    return `▸ ${e.tool}: ${one(pick ?? JSON.stringify(i), 180)}`;
  }
  if (e.kind === 'tool_result') return `  ↳ ${e.isError ? 'error: ' : ''}${one((e.text ?? '').split('\n').find((l) => l.trim()) ?? '', 180) || 'done'}`;
  if (e.kind === 'thinking') return `(thinking) ${one(e.text, 200)}`;
  if (e.kind === 'result') return `■ ${one(e.text, 400) || 'ended'}`;
  if (e.kind === 'prompt') return `› ${one(e.text, 400)}`;
  if (e.kind === 'context') return '';
  return one(e.text, 1200);
}

export function Watch({ run }: { run: Run }) {
  const [lines, setLines] = useState<{ k: number; text: string; cls: string }[]>([]);
  const [info, setInfo] = useState<{ status: string; usd?: number | null; tokens?: number }>({ status: run.status });
  const [error, setError] = useState('');
  const [follow, setFollow] = useState(true);
  const offset = useRef(-1);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const r = await pluginFetch(FOLDER, `runs/${encodeURIComponent(run.id)}/tail?offset=${offset.current}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as Tail;
        if (!live) return;
        offset.current = j.offset;
        const add = j.events.map((e) => ({ k: ++seq.current, text: tailLine(e), cls: e.kind === 'tool_use' ? 'is-tool' : e.isError ? 'is-error' : e.kind === 'tool_result' || e.kind === 'thinking' ? 'is-dim' : '' })).filter((l) => l.text);
        if (add.length) setLines((x) => [...x, ...add].slice(-KEEP));
        setInfo({ status: j.status, usd: j.usd, tokens: j.tokensTotal });
        setError('');
      } catch (e) { if (live) setError(e instanceof Error ? e.message : String(e)); }
    };
    void poll();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void poll(); }, TAIL_MS);
    return () => { live = false; window.clearInterval(t); };
  }, [run.id]);

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines, follow]);

  return (
    <div className="fx-stack">
      <div className="axp-session-history__watchbar">
        <Chip tone={statusTone(info.status)}>{STATUS_LABEL[info.status] ?? info.status}</Chip>
        <span className="fx-small fx-muted">{fmtTokens(info.tokens)} tokens · {fmtUsd(info.usd)}</span>
        <span className="fx-grow" />
        <Button size="sm" onClick={() => setFollow(!follow)}>{follow ? 'Stop following' : 'Follow'}</Button>
        <KillButton run={run} status={info.status} />
      </div>
      {error ? <p className="fx-small fx-muted">Live feed interrupted ({error}); retrying.</p> : null}
      <div ref={box} className="axp-session-history__watch fx-mono fx-small" role="log" aria-live="polite">
        {lines.length ? lines.map((l) => <div key={l.k} className={`axp-session-history__wl ${l.cls}`}>{l.text}</div>) : <span className="fx-muted">Waiting for output…</span>}
      </div>
    </div>
  );
}

export function KillButton({ run, status }: { run: Run; status: string }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (!armed) return; const t = window.setTimeout(() => setArmed(false), 4000); return () => window.clearTimeout(t); }, [armed]);
  if (run.kind === 'session' || status !== 'running') return msg ? <span className="fx-small">{msg}</span> : null;
  const go = async () => {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const r = await pluginFetch(FOLDER, `runs/${encodeURIComponent(run.id)}/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: run.id }) });
      const j = (await r.json().catch(() => ({}))) as { detail?: string; how?: string };
      setMsg(r.ok ? `Stopped (${j.how ?? 'signal sent'})` : `Couldn’t stop it: ${j.detail ?? r.status}`);
    } catch (e) { setMsg(`Couldn’t stop it: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <span className="axp-session-history__kill">
      <Button size="sm" tone="danger" onClick={() => void go()} disabled={busy}>{busy ? 'Stopping…' : armed ? 'Tap again to kill' : 'Kill'}</Button>
      {msg ? <span className="fx-small"> {msg}</span> : null}
    </span>
  );
}
