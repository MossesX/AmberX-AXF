/*
 * Build manager — "open the session": the icon next to a build's timer opens whatever is running that build, in focus
 * (Brett, Oct 21 2026). What runs it comes from the build's change-log@1 `runner` (written by the codebase-changes
 * hooks: detectRunner) or, for activity-feed builds, the run's link.
 *
 *   url (claude.ai / Claude Code on the web, GitHub run…)  → a named browser window, so a second tap focuses the same one
 *   terminal (a console terminal tab)                       → action terminal.focus:<session id> (Terminal plugin)
 *   tmux (Claude Code in tmux on the VPS, e.g. from Moshi)  → action terminal.attach:<session> (Terminal plugin): a VPS
 *                                                             tab attached to that tmux session, or the open one focused
 *   anything else (a laptop terminal, an IDE)               → a note saying where it runs: there is no window to reach
 *
 * Cross-plugin only through action names (plugin rule): without the Terminal plugin the tmux/terminal cases say so.
 */
import type { AxfRuntime } from '@console/axf/core';
import type { Runner } from './history.mjs';

/** Only https links open from the banner (the hooks allow just claude.ai, platform.claude.com, console.anthropic.com and github.com). */
const httpsUrl = (u: string | undefined) => { try { return u && new URL(u).protocol === 'https:' ? u : ''; } catch { return ''; } };

/** The runner for a live entry: its own, else the activity run's link. */
export function runnerOf(e: { runner?: Runner | null; url?: string }): Runner | null {
  if (e.runner && typeof e.runner === 'object' && e.runner.kind) return e.runner;
  const u = httpsUrl(e.url);
  return u ? { kind: 'link', url: u, label: 'the run' } : null;
}

export const canOpen = (r: Runner | null): boolean => !!r && (!!httpsUrl(r.url) || !!r.tmux?.session || !!r.terminal);

export function runnerIcon(r: Runner | null): string {
  if (!r) return 'info';
  if (httpsUrl(r.url)) return 'external';
  return r.tmux || r.terminal ? 'terminal' : 'info';
}

const where = (r: Runner) => {
  const name = r.label || (r.tmux ? `tmux ${r.tmux.session}` : r.kind);
  return r.host && !name.includes(r.host) ? `${name} on ${r.host}` : name;
};

export function runnerTitle(r: Runner | null): string {
  if (!r) return 'Where this build runs isn’t known yet';
  return canOpen(r) ? `Open the session (${where(r)})` : `Runs in ${where(r)}: open it there`;
}

/** Open (or focus) what runs the build. `key` names the browser window so the same build reuses it. */
export function openRunner(rt: AxfRuntime, r: Runner | null, key: string): void {
  if (!r) { rt.toast('This build hasn’t said where it runs. Sessions started after this update do.', 'info', 'Open session'); return; }
  const url = httpsUrl(r.url);
  if (url) {
    const w = globalThis.open(url, `axf-session-${key}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60));
    if (!w) { rt.toast('The browser blocked the new window. Allow pop-ups for the console and tap again.', 'warning', 'Open session'); return; }
    try { w.opener = null; } catch { /* cross-origin already: nothing to cut */ }
    try { w.focus(); } catch { /* some browsers focus new windows themselves */ }
    return;
  }
  if (r.terminal) {
    if (rt.actions.get('terminal.focus')) { rt.dispatch(`terminal.focus:${encodeURIComponent(r.terminal)}`); return; }
    rt.toast('Turn on the Terminal plugin to open console terminals from here.', 'info', 'Open session');
    return;
  }
  if (r.tmux?.session) {
    if (rt.actions.get('terminal.attach')) { rt.dispatch(`terminal.attach:${encodeURIComponent(r.tmux.session)}`); return; }
    rt.toast(`It runs in tmux session “${r.tmux.session}” on the VPS. Turn on the Terminal plugin to open it here, or run: tmux attach -t ${r.tmux.session}`, 'info', 'Open session');
    return;
  }
  rt.toast(`It runs in ${where(r)}. There’s no window the console can open for it: switch to it there.`, 'info', 'Open session');
}
