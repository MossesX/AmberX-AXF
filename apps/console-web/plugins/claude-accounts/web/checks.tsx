/**
 * Account tests (build test-button-on-every-claude-account-subscription, Nov 10 2026): a Test button on every account row
 * (Accounts and Job routing) and Test all, which checks the accounts one at a time with an animated progress bar and
 * each row's result as it lands. Only on a click, a console action, MCP, CLI or voice: never when the page opens and
 * never before a launch (Brett: "Don't check them unless it's manual").
 *
 * The server runs deploy/claude-account-check.mjs on the host: one tiny no-tool call per model on the account's own
 * saved login or key. The result is account-check@1: alive / expired / bad-key / no-credit / limit / error, per model.
 */
import { useEffect, useState } from 'react';
import { Button, Chip, Meter } from '@console/axf/react';
import { pluginFetch } from '@console/plugins';

const FOLDER = 'claude-accounts';

export type CheckState = 'alive' | 'expired' | 'bad-key' | 'no-credit' | 'limit' | 'unknown-account' | 'error';
export interface Check { name: string; kind: string; state: CheckState; models: Record<string, string>; detail: string; until: string; at: string; ms: number }

/* ---------------- one shared run, so every panel shows the same progress ---------------- */

interface Run { names: string[]; current: string; done: number; results: Record<string, Check>; error: string }
let run: Run = { names: [], current: '', done: 0, results: {}, error: '' };
const subs = new Set<(r: Run) => void>();
const set = (r: Partial<Run>) => { run = { ...run, ...r }; for (const s of subs) s(run); };
const afterEach = new Set<() => void>();

/** Called after every result so the account lists reload (index.tsx and routing.tsx register their loaders). */
export function onChecked(fn: () => void) { afterEach.add(fn); return () => { afterEach.delete(fn); }; }

async function post(name: string): Promise<Check> {
  const r = await pluginFetch(FOLDER, 'check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; check?: Check; detail?: string };
  if (!r.ok || !j.ok || !j.check) throw new Error(j.detail || `HTTP ${r.status}`);
  return j.check;
}

/** Test these accounts one at a time (Test = one name, Test all = every name). A run already going is not doubled. */
export async function testAccounts(names: string[]): Promise<void> {
  if (run.current || !names.length) return;
  set({ names, done: 0, current: '', error: '', results: {} });
  for (const n of names) {
    set({ current: n });
    try {
      const c = await post(n);
      set({ results: { ...run.results, [n]: c } });
    } catch (e) { set({ error: `${n}: ${(e as Error).message}` }); }
    set({ done: run.done + 1 });
    for (const fn of afterEach) fn();
  }
  set({ current: '' });
}

export function useTestRun(): Run {
  const [r, setR] = useState(run);
  useEffect(() => { subs.add(setR); return () => { subs.delete(setR); }; }, []);
  return r;
}

/* ---------------- what a result looks like ---------------- */

const WORDS: Record<CheckState, string> = { alive: 'Alive', expired: 'Login expired', 'bad-key': 'Bad key', 'no-credit': 'Out of credits', limit: 'Limit hit', 'unknown-account': 'Not on the VPS', error: 'Check failed' };
const TONE: Record<CheckState, 'success' | 'warning' | 'danger'> = { alive: 'success', expired: 'danger', 'bad-key': 'danger', 'no-credit': 'danger', limit: 'warning', 'unknown-account': 'danger', error: 'warning' };
const MODEL_WORDS: Record<string, string> = { ok: 'runs', unavailable: 'not available', limit: 'limit hit', expired: 'login expired', 'bad-key': 'bad key', 'no-credit': 'out of credits', error: 'failed' };
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function checkLine(c: Check): string {
  const models = Object.entries(c.models).map(([m, r]) => `${cap(m)} ${MODEL_WORDS[r] ?? r}`);
  return [...models, c.until ? `back ${when(c.until)}` : '', `tested ${when(c.at)}`].filter(Boolean).join(' · ');
}

/** The status chip and the Test button for one row. `last` is the server's last result for that account. */
export function TestCell({ name, last }: { name: string; last: Check | null | undefined }) {
  const r = useTestRun();
  const c = r.results[name] ?? last ?? null;
  const testing = r.current === name;
  const waiting = !testing && !!r.current && r.names.indexOf(name) > r.names.indexOf(r.current);
  return (
    <>
      {testing ? <Chip tone="accent">Testing…</Chip> : waiting ? <Chip>Waiting to test</Chip> : c ? <Chip tone={TONE[c.state] ?? 'warning'}>{WORDS[c.state] ?? c.state}</Chip> : <Chip>Not tested</Chip>}
      <Button size="sm" icon="zap" busy={testing} disabled={!!r.current} onClick={() => void testAccounts([name])}>Test</Button>
    </>
  );
}

/** The result's detail lines under the account name (models, when, and what Claude said when it failed). */
export function TestDetail({ name, last }: { name: string; last: Check | null | undefined }) {
  const r = useTestRun();
  const c = r.current === name ? null : r.results[name] ?? last ?? null;
  if (!c) return null;
  return (
    <>
      <p className="axp-ca-row__sub" data-check={c.state}>{checkLine(c)}</p>
      {c.state !== 'alive' && c.detail && <p className="axp-ca-row__sub">{c.detail}</p>}
    </>
  );
}

/** Test all, and while a run goes: an animated bar with which account is being checked and how far along it is. */
export function TestAllBar({ names }: { names: string[] }) {
  const r = useTestRun();
  const going = !!r.current;
  const total = r.names.length;
  const finished = !going && total > 1 && r.done === total;
  const bad = finished ? Object.values(r.results).filter((c) => c.state !== 'alive').length : 0;
  return (
    <div className="fx-stack axp-ca-testall">
      <div className="axp-ca-checks" role="toolbar" aria-label="Account tests">
        <Button size="sm" tone="primary" icon="zap" busy={going} disabled={going || !names.length} onClick={() => void testAccounts(names)}>Test all</Button>
        <span className="axp-ca-row__sub">One tiny no-tool call per model on each account's own login or key. Only when you ask.</span>
      </div>
      {going && total > 0 && <Meter value={(r.done / total) * 100} active label={`Checking ${r.current} (${r.done + 1} of ${total})…`} />}
      {going && total > 0 && <p className="axp-ca-row__sub" aria-live="polite">Checking {r.current} ({r.done + 1} of {total})…</p>}
      {finished && <p className="axp-ca-row__sub" aria-live="polite">{bad ? `${total - bad} of ${total} accounts alive.` : `All ${total} accounts alive.`}</p>}
      {r.error && !going && <p className="axp-ca-row__sub">{r.error}</p>}
    </div>
  );
}
