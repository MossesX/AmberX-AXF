/**
 * Act catalog part 4: a build dies for good and shows what failed (the red row and the break alert with its dialog),
 * the stale-row cleanup, and a phone notification through the alert hub / axf.notify@1, tagged demo (notify.json type
 * `orchestrator-demo.demo`).
 *
 * The break dialog itself belongs to the live build status build (live-build-status-real-time-grids-15, "Broke
 * dialog"); the dependency check (deps.mjs) refuses to start the demo when it isn't there.
 */
import { decide, recoveryLine, recoveryRecord } from '../../../../../framework/core/build-watchdog.mjs';
import { DEMO_MARK } from '../../../../../framework/core/demo-build.mjs';
import { createFixtures, findBuild, removeFixtures, updateDemoBuild } from '../sandbox.mjs';
import { APP, custom, evidence, focusRow, focusView, note, rowAddress, tickStep } from './common.mjs';

export const PART = 4;
export const TITLE = 'Dies for good, break alert, cleanup and phone';
/** The console-control address of the break ("broke") dialog for a build. */
export const brokeDialog = (build) => `dialog:build-orchestrator.live.broke/row:${build}`;
export const ALERT_SOURCE = 'orchestrator-demo';
export const NOTIFY_TYPE = 'orchestrator-demo.demo';
export const MAX_RETRIES = 3;

/** The break alert for a demo build that died for good (alert hub payload; demo-marked from the id). */
export function breakAlert(b, why) {
  return {
    source: ALERT_SOURCE, key: `orchestrator-demo:broke:${b.id}`, severity: 'error', link: `#/builds?row=${encodeURIComponent(b.id)}`,
    title: `${DEMO_MARK} Build failed: ${b.title}`.slice(0, 200), body: why.slice(0, 1500),
    meta: { kind: 'broke', build: b.id, demo: true },
  };
}

/** The demo phone notification (alert hub payload, checked against axf.notify@1 by the hub). */
export function demoNotice(runId, text) {
  return {
    source: ALERT_SOURCE, key: `orchestrator-demo:notify:${runId}`, severity: 'info', link: '#/builds',
    title: `${DEMO_MARK} Orchestrator demo: ${text}`.slice(0, 200), body: 'Sent by the guided live demo to show a phone notification. Nothing real happened.',
    meta: { kind: 'demo', type: NOTIFY_TYPE, demo: true, run: runId },
  };
}

export function acts(ids) {
  const d = ids.die; const g = ids.grid;
  return [
    {
      id: 'die-retries', title: 'A build fails every retry',
      caption: `"${d}" is launched on the fake runner and fails (exit 1). The watchdog retries it ${MAX_RETRIES} times; every try fails the same way.`,
      focus: focusRow(d, 's2', 'orchestrator demo: a build that keeps failing'),
      run: custom('demo.die-retries', { build: d }), expect: { kind: 'note', build: d, text: `retry ${MAX_RETRIES} of ${MAX_RETRIES}`, within: 20000 },
      builds: [d], tags: ['failure', 'watchdog'],
    },
    {
      id: 'dies-for-good', title: 'It dies for good: red row',
      caption: `After the last retry the watchdog gives up. "${d}" turns red as Failed, and the note says what failed: step s2, exit 1, ${MAX_RETRIES} retries.`,
      focus: focusRow(d, '', 'orchestrator demo: the red row'),
      run: custom('demo.give-up', { build: d }), expect: { kind: 'status', build: d, status: 'failed', within: 15000, fails: true },
      builds: [d], tags: ['failure', 'grid'],
    },
    {
      id: 'break-alert', title: 'The break alert and its dialog',
      caption: `The break alert for "${d}" goes out (marked [demo]) and its dialog opens: the cause, the exit code, the last step and what the watchdog did.`,
      focus: { app: APP, route: 'builds', address: brokeDialog(d), selector: `[data-axf-target="${brokeDialog(d)}"]`, note: 'orchestrator demo: the break alert dialog' },
      run: custom('demo.break-alert', { build: d }), expect: { kind: 'alert', build: d, text: `${DEMO_MARK} Build failed`, within: 15000 },
      builds: [d], tags: ['alerts', 'failure'],
    },
    {
      id: 'stale-row-cleanup', title: 'Stale rows are cleaned up',
      caption: `"${g}" still says Running but its fake session has ended: a stale row. The cleanup finds it and takes the row off the grid.`,
      focus: focusRow(g, '', 'orchestrator demo: stale-row cleanup'),
      run: custom('demo.stale-cleanup', { build: g }), expect: { kind: 'row-gone', build: g, within: 15000 },
      builds: [g], tags: ['grid', 'cleanup'],
    },
    {
      id: 'phone-notify', title: 'A notification reaches the phone',
      caption: 'A notification tagged [demo] goes through the alert hub and the notification registry to the phone (AmberX). Nothing real happened.',
      focus: focusView('view:alerts', 'orchestrator demo: the phone notification', 'alerts'),
      run: custom('demo.notify', {}), expect: { kind: 'alert', text: `${DEMO_MARK} Orchestrator demo`, within: 15000 },
      builds: [], tags: ['alerts', 'notify'],
    },
  ];
}

export const handlers = {
  async 'demo.die-retries'(ctx, act) {
    const id = act.run.body.build;
    if (!findBuild(ctx.store, id)) await createFixtures({ store: ctx.store, data: ctx.data, suffix: ctx.suffix, runId: ctx.runId, keys: ['die'] });
    const lines = [];
    for (let i = 1; i <= MAX_RETRIES; i += 1) {
      const at = ctx.now();
      const s = await ctx.sessions.start(id);
      await updateDemoBuild(ctx.store, id, (b) => {
        b.status = 'running';
        b.pipeline = { ...(b.pipeline ?? {}), launchedAt: at, session: s.session, model: 'Opus', runs: (b.pipeline?.runs ?? 0) + 1 };
        if (i === 1) tickStep(b, 's1', new Date(Date.parse(at) - 1000).toISOString()); // progress before the first failure
      }, 'demo-launch');
      await ctx.sessions.kill(id);
      const b0 = findBuild(ctx.store, id);
      // a session that failed (exit 1) rather than one that was killed: the cause the watchdog names is exit-failed
      const probe = { ...ctx.sessions.probe(id, at), exit: 1, exitKind: 'crash' };
      const d = decide(b0, probe, { enabled: true, graceMin: 0, staleMin: 20, maxRetries: MAX_RETRIES }, { now: at });
      const rec = recoveryRecord(b0, d, { now: at, session: s.session });
      const line = recoveryLine(rec, b0);
      lines.push(line);
      await updateDemoBuild(ctx.store, id, (b) => {
        b.status = 'queued';
        b.pipeline = { ...(b.pipeline ?? {}), session: '', crashes: (b.pipeline?.crashes ?? 0) + 1, heldAt: at, heldBy: 'orchestrator-demo', heldWhy: 'demo build: retried by the guided live demo' };
        b.recoveries = [...(b.recoveries ?? []), rec];
        note(b, line, at);
      }, 'demo-watchdog');
    }
    ctx.log(`die-retries ${id}: ${lines.length} tries failed`);
    return { observed: `${lines.length} tries, each exit 1`, evidence: lines.map((l) => evidence('note', l, rowAddress(id, 's2'))) };
  },
  async 'demo.give-up'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const b0 = findBuild(ctx.store, id);
    const s = await ctx.sessions.start(id);
    await ctx.sessions.kill(id);
    const running = { ...b0, status: 'running', pipeline: { ...(b0.pipeline ?? {}), launchedAt: at, session: s.session } };
    const d = decide(running, { ...ctx.sessions.probe(id, at), exit: 1, exitKind: 'crash' }, { enabled: true, graceMin: 0, staleMin: 20, maxRetries: MAX_RETRIES }, { now: at });
    const rec = recoveryRecord(running, d, { now: at, session: s.session });
    const why = `What failed: step ${d.step || 's2'}, exit 1 on every try. ${d.note}`;
    await updateDemoBuild(ctx.store, id, (b) => {
      b.status = 'failed';
      b.pipeline = { ...(b.pipeline ?? {}), session: '', heldAt: '', heldBy: '', heldWhy: '' };
      b.failure = { kind: 'session', why, at, head: '' };
      if (rec) b.recoveries = [...(b.recoveries ?? []), rec];
      note(b, why, at);
    }, 'demo-give-up');
    ctx.log(`gave up ${id}: ${d.action}`);
    return { observed: `watchdog ${d.action}: ${why}`, evidence: [evidence('status', `${id} failed`, rowAddress(id)), evidence('note', why, rowAddress(id))] };
  },
  async 'demo.break-alert'(ctx, act) {
    const id = act.run.body.build;
    const b = findBuild(ctx.store, id);
    const why = b?.failure?.why || (b?.notes ?? []).at(-1)?.text || 'failed';
    const a = breakAlert(b, why);
    await ctx.alerts.raise(a);
    ctx.log(`break alert ${id}`);
    return { observed: `alert "${a.title}" raised; dialog ${brokeDialog(id)}`, evidence: [evidence('alert', a.title, a.key), evidence('custom', 'break dialog', brokeDialog(id))] };
  },
  async 'demo.stale-cleanup'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const b = findBuild(ctx.store, id);
    if (!b) return { observed: `${id} was already gone`, evidence: [] };
    await ctx.sessions.stop(id);
    const stale = b.status === 'running' && !ctx.sessions.alive(id);
    if (stale) await updateDemoBuild(ctx.store, id, (x) => note(x, 'Stale row: marked Running, no session alive. Cleaned up.', at), 'demo-stale');
    const r = await removeFixtures({ store: ctx.store, data: ctx.data, runId: ctx.runId, only: [id] });
    ctx.log(`stale-cleanup ${id}: ${stale ? 'stale' : 'not stale'}, removed ${r.removed.join(', ')}`);
    return { observed: `${stale ? 'stale row found' : 'row was not running'}; removed ${r.removed.join(', ') || 'nothing'}`, evidence: [evidence('status', `${id} removed`, rowAddress(id))] };
  },
  async 'demo.notify'(ctx) {
    const n = demoNotice(ctx.runId, 'this is what a phone notification looks like');
    const r = await ctx.notify(n);
    ctx.log(`notify ${n.key}: ${r?.sent ? 'sent' : r?.why || 'held by the registry'}`);
    return { observed: r?.sent ? `sent: ${n.title}` : `not sent: ${r?.why || 'the notification registry held it'}`, evidence: [evidence('alert', n.title, n.key)] };
  },
};

export const expects = {};
