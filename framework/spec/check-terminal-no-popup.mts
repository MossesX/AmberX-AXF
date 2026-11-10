#!/usr/bin/env -S npx -y tsx
/*
 * The Terminal never pops up on its own when the console opens (build urgent-terminal-pops-up-every-time-the-console-o,
 * Nov 9 2026, Brett: "Every time I open the console, the terminal seems to pop up. You need to stop that."). Checks the
 * Terminal plugin's pure planners: headless sessions found on the first look after a load or a return to the page are
 * never raised, and approved VPS commands never open a window by themselves.
 *   npx -y tsx framework/spec/check-terminal-no-popup.mts
 */
import { planNew, planRun, toOpen, type Headless } from '../../apps/console-web/plugins/console-terminal/web/headless-core.ts';

let failed = 0;
const check = (ok: boolean, what: string) => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++; };
console.log('terminal: no pop-up on console open');

const running: Headless[] = [{ name: 'axf-b', createdAt: 2 }, { name: 'axf-a', createdAt: 1 }];
const fresh = toOpen(running, new Set(), new Set());

// headless sessions already running when Brett opens the console (baseline = the first look)
for (const mode of ['nothing', 'quiet', 'front'] as const) {
  const p = planNew(mode, fresh, false, true);
  check(!p.raise && !p.open.length, `console open, ${mode}, no Terminal window: no window opens, nothing is raised`);
  const w = planNew(mode, fresh, true, true);
  check(!w.raise, `console open, ${mode}, Terminal window open: nothing is raised`);
}
check(planNew('quiet', fresh, false, true).wait.length === fresh.length, 'console open, quiet: the running sessions only count on the Terminal toolbar icon');
check(planNew('front', fresh, true, true).open.length === fresh.length, 'console open, bring to front, window open: background tabs only');
// after the baseline: the settings keep their meaning
check(planNew('front', fresh, false, false).raise, 'bring to front still raises a session that starts while Brett watches');
const q = planNew('quiet', fresh, false, false);
check(!q.open.length && !q.raise, 'quiet never opens a window, even for a new session');
check(planNew('quiet', fresh, false).wait.length === fresh.length && planNew('front', fresh, false).raise, 'the old three-argument call is unchanged (not a baseline)');

// approved VPS / shell commands (axf.hub-runs@1)
check(planRun(false, true) === 'skip' && planRun(true, true) === 'skip', 'approved VPS commands: the first look after a load is a baseline, nothing opens');
check(planRun(false, false) === 'wait', 'approved VPS command, no Terminal window: it waits on the toolbar count, no window pops');
check(planRun(true, false) === 'background', 'approved VPS command, Terminal window open: a background tab, no raise');

if (failed) { console.log(`FAIL: ${failed} check(s)`); process.exit(1); }
console.log('ok');
