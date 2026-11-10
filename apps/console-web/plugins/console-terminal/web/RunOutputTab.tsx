/*
 * Approved VPS / shell commands, shown in the terminal (Brett, Oct 23 2026): once a command you approved on axHub has run
 * through Mosses's axhub_call, its command and output open here in a read-only tab (tab kind `terminal-output`, in the
 * terminal window), so you see what ran and what it said. Runs come from the agent manager's `axf.hub-runs@1` through
 * this plugin's `GET hub-runs` (console token); only runs newer than when this page loaded get a tab by themselves, while the
 * page is visible, and only in the background of an open Terminal window: with none open they wait on the Terminal
 * toolbar count (Nov 9 2026, Brett: the Terminal must not pop up on its own). Settings → Plugins → Terminal → "Open approved VPS commands here" switches it off.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Icon } from '@console/axf/react';
import type { AxfRuntime, TabSpec } from '@console/axf/core';
import { call, getSettings, loadXterm, themeFromTokens } from './api';
import { planRun } from './headless-core';

export interface HubRun { id: string; at: number; tool: string; command: string; output: string; exit: number | null; reason: string; agent: string }
interface Answer { available: boolean; on: boolean; items: HubRun[]; now: number }

const runs = new Map<string, HubRun>();
const P = 'axp-terminal';

/** Open (or bring forward) the output tab for one run, in the terminal window when there is one. `background` (the
 *  watcher): only into an open Terminal window, behind the tab in front, never a new window, never a raise. */
export function openRunTab(rt: AxfRuntime, run: HubRun, background = false): boolean {
  runs.set(run.id, run);
  const wm = rt.windows;
  const tabId = `hubrun-${run.id}`;
  const gid = wm.groupOf(tabId);
  if (gid) { if (!background) { const g = wm.state.groups[gid]; if (g) wm.activate(gid, g.tabs.findIndex((t) => t.id === tabId)); } return true; }
  const tab = { id: tabId, title: `VPS: ${(run.command.split('\n')[0] ?? '').slice(0, 32)}`, kind: 'terminal-output', payload: run.id, icon: 'terminal' };
  const existing = terminalGroup(rt);
  if (existing) {
    const keep = wm.state.groups[existing]?.active ?? 0;
    wm.addTab(existing, tab);
    if (background) wm.activate(existing, keep); // addTab puts the new tab in front: the one Brett was on stays there
    return true;
  }
  if (background) return false;
  wm.openFloating([tab], 'Terminal', 'floating', Math.min(820, innerWidth - 32), Math.min(480, innerHeight - 120));
  return true;
}

const terminalGroup = (rt: AxfRuntime) => Object.values(rt.windows.state.groups).find((g) => g.tabs.some((t) => t.kind === 'terminal-host' || t.kind === 'terminal-output'))?.id;

/** Runs that finished while no Terminal window was open: they count on the Terminal toolbar icon and get a background
 *  tab once Brett opens the Terminal himself (flushRuns). */
const waiting = new Map<string, HubRun>();
const waitingListeners = new Set<() => void>();
export const waitingRuns = () => waiting.size;
export const onWaitingRuns = (f: () => void) => { waitingListeners.add(f); return () => { waitingListeners.delete(f); }; };
const waitingChanged = () => waitingListeners.forEach((f) => f());
/** Put the waiting runs into the open Terminal window, in the background. */
export function flushRuns(rt: AxfRuntime) {
  if (!waiting.size || !terminalGroup(rt)) return;
  for (const r of [...waiting.values()].sort((a, b) => a.at - b.at)) if (openRunTab(rt, r, true)) waiting.delete(r.id);
  waitingChanged();
}

let started = false;
/**
 * Poll for new approved runs every 5 s while the page is visible (and at once when it comes back). The first answer
 * is a baseline on the server's clock (planRun): runs from before this page loaded never open, and a browser clock
 * that runs behind the VPS can't make old runs look new. New runs never pop a window up (Nov 9 2026).
 */
export function watchHubRuns(rt: AxfRuntime) {
  if (started) return;
  started = true;
  let since: number | null = null;
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const a = await call<Answer>(`hub-runs?since=${since ?? Date.now()}`);
      const baseline = since === null;
      since = Math.max(since ?? 0, a.now || 0, ...a.items.map((r) => r.at));
      let changed = false;
      for (const r of a.items) {
        const plan = planRun(!!terminalGroup(rt), baseline);
        if (plan === 'background') openRunTab(rt, r, true);
        else if (plan === 'wait') { runs.set(r.id, r); waiting.set(r.id, r); changed = true; }
      }
      if (changed) waitingChanged();
      flushRuns(rt);
    } catch { /* plugin off or console unreachable: try again next tick */ }
  };
  setInterval(() => void tick(), 5000);
  document.addEventListener('visibilitychange', () => void tick());
  void tick();
}

/** The read-only tab: "$ command", the output, exit code. Not a shell: nothing typed here runs. */
export function RunOutputTab({ tab }: { tab: TabSpec }) {
  const host = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState<HubRun | null>(runs.get(String(tab.payload)) ?? null);
  const [err, setErr] = useState('');

  useEffect(() => { // after a reload the run isn't in memory: read it back (last 50 kept)
    if (run) return;
    call<Answer>('hub-runs?since=0').then((a) => {
      const r = a.items.find((x) => x.id === tab.payload);
      if (r) { runs.set(r.id, r); setRun(r); } else setErr('This run is no longer kept (only the last 50 are).');
    }, (e: Error) => setErr(e.message));
  }, [run, tab.payload]);

  useEffect(() => {
    if (!run || !host.current) return;
    let disposed = false;
    let cleanup = () => {};
    void Promise.all([loadXterm(), getSettings().catch(() => null)]).then(([L, st]) => {
      if (disposed || !host.current) return;
      const el = host.current;
      const term = new L.Terminal({ fontFamily: getComputedStyle(el).getPropertyValue('--fx-font-mono').trim() || 'monospace', fontSize: st?.fontSize ?? 14,
        disableStdin: true, cursorBlink: false, scrollback: 20000, convertEol: true, theme: themeFromTokens(el) });
      const fit = new L.FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      const when = new Date(run.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      term.write(`\x1b[2m# Approved on axHub · ran through ${run.agent || 'Mosses'} (${run.tool}) · ${when}${run.reason ? ` · ${run.reason}` : ''}\x1b[0m\r\n`);
      term.write(`\x1b[1m$ ${run.command.replace(/\n/g, '\r\n  ')}\x1b[0m\r\n\r\n`);
      // the hub's answer starts with its own "$ command" + "exit N · ms" header: show the output under ours
      const body = run.output.replace(/^\$ [^\n]*\n(exit [^\n]*\n)?/, '');
      term.write(body.replace(/\r?\n/g, '\r\n'));
      term.write(`\r\n\r\n${run.exit === 0 ? '\x1b[32m✓ exit 0' : `\x1b[31m✗ exit ${run.exit ?? '?'}`}\x1b[0m\r\n`);
      const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* hidden */ } });
      ro.observe(el);
      cleanup = () => { ro.disconnect(); term.dispose(); };
    }, (e: Error) => setErr(e.message));
    return () => { disposed = true; cleanup(); };
  }, [run]);

  if (err) return <p className={`${P}__err fx-small`}>{err}</p>;
  return (
    <div className={`${P}__run`}>
      <div className={`${P}__runbar fx-row`}>
        <Icon name="shield" size={13} />
        <span className="fx-small fx-grow">{run ? `Approved command on the VPS · ${run.exit === 0 ? 'finished' : run.exit == null ? 'ran' : `exit ${run.exit}`} · read-only` : 'Loading…'}</span>
        {run && <Button size="sm" tone="quiet" icon="copy" onClick={() => void navigator.clipboard?.writeText(`$ ${run.command}\n${run.output}`)}>Copy</Button>}
      </div>
      <div ref={host} className={`${P}__runterm`} />
    </div>
  );
}
