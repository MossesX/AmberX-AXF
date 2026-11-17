/**
 * Act catalog part 2: a deliberate crash (the fake session is killed, exit 143), the watchdog catching it with the
 * real build-watchdog@1 decision table, and the retry back to the Queue. The session is fake-runner.sh: no Claude
 * account is spent.
 */
import { decide, recoveryLine, recoveryRecord } from '../../../../../framework/core/build-watchdog.mjs';
import { createFixtures, findBuild, updateDemoBuild } from '../sandbox.mjs';
import { custom, evidence, focusRow, note, rowAddress, tickStep } from './common.mjs';

export const PART = 2;
export const TITLE = 'Crash, watchdog and retry';

export function acts(ids) {
  const c = ids.crash;
  return [
    {
      id: 'crash-start', title: 'A second build starts running',
      caption: `"${c}" is created, launched on the fake runner and finishes its first step. In the next act its session is killed on purpose.`,
      focus: focusRow(c, 's1', 'orchestrator demo: the build that will crash'),
      run: custom('demo.crash-start', { build: c }), expect: { kind: 'step-done', build: c, step: 's1', within: 15000 },
      builds: [c], tags: ['grid', 'watchdog'],
    },
    {
      id: 'crash', title: 'The session crashes',
      caption: `The fake session of "${c}" is killed (SIGTERM, exit 143), the way a reboot or a killed tmux ends a real one. The row still says Running: nothing is alive behind it.`,
      focus: focusRow(c, 's2', 'orchestrator demo: the session is killed'),
      run: custom('demo.kill', { build: c }), expect: { kind: 'custom', build: c, text: 'session-dead', within: 10000, fails: true },
      builds: [c], tags: ['failure', 'watchdog'],
    },
    {
      id: 'watchdog-catches', title: 'The watchdog catches it',
      caption: `The watchdog probes "${c}": no process, no session, exit 143. It names the cause, resets step s2, releases the slot and records the fix on the build.`,
      focus: focusRow(c, '', 'orchestrator demo: the watchdog catches the crash'),
      run: custom('demo.watchdog', { build: c }), expect: { kind: 'note', build: c, text: 'Watchdog fixed', within: 15000 },
      builds: [c], tags: ['watchdog'],
    },
    {
      id: 'retry-to-queue', title: 'The retry goes back to the Queue',
      caption: `"${c}" is back in the Queue as retry 1, at its place, with the crash in its notes. It is relaunched on the fake runner and finishes.`,
      focus: focusRow(c, '', 'orchestrator demo: retry back in the Queue'),
      run: custom('demo.retry', { build: c }), expect: { kind: 'step-done', build: c, step: 's3', within: 20000 },
      builds: [c], tags: ['watchdog', 'queue'],
    },
  ];
}

export const handlers = {
  async 'demo.crash-start'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    if (!findBuild(ctx.store, id)) await createFixtures({ store: ctx.store, data: ctx.data, suffix: ctx.suffix, runId: ctx.runId, keys: ['crash'] });
    const s = await ctx.sessions.start(id);
    await updateDemoBuild(ctx.store, id, (b) => {
      b.status = 'running';
      b.pipeline = { ...(b.pipeline ?? {}), queuedAt: at, queuedBy: 'orchestrator-demo', launchedAt: at, session: s.session, model: 'Opus', runs: 1 };
      tickStep(b, 's1', at);
      note(b, `Launched on the fake runner (session ${s.session}).`, at);
    }, 'demo-launch');
    ctx.log(`launched ${id} on ${s.session}, s1 done`);
    return { observed: `${id} running on ${s.session}, s1 crossed off`, evidence: [evidence('step', 's1 done', rowAddress(id, 's1'))] };
  },
  async 'demo.kill'(ctx, act) {
    const id = act.run.body.build;
    const k = await ctx.sessions.kill(id);
    ctx.log(`session-dead ${id} exit ${k.exit}`);
    return { observed: `fake session killed: exit ${k.exit}; the row still says Running`, evidence: [evidence('error', `exit ${k.exit} (SIGTERM)`, rowAddress(id, 's2'))] };
  },
  async 'demo.watchdog'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const b0 = findBuild(ctx.store, id);
    // the launch was just now: probe as if past the grace window so the decision table judges the exit, not the age
    const probe = ctx.sessions.probe(id, at);
    const d = decide(b0, probe, { enabled: true, graceMin: 0, staleMin: 20, maxRetries: 3 }, { now: at });
    if (d.action === 'none') return { observed: `watchdog left it alone: ${d.note}`, evidence: [evidence('error', d.note, rowAddress(id))], error: d.note };
    const rec = recoveryRecord(b0, d, { now: at, session: b0.pipeline?.session });
    const line = recoveryLine(rec, b0);
    await updateDemoBuild(ctx.store, id, (b) => {
      if (d.resetStep && d.step) { const s = b.steps.find((x) => x.id === d.step); if (s) { s.done = false; s.doneAt = ''; } }
      b.status = d.status || 'queued';
      b.pipeline = { ...(b.pipeline ?? {}), session: '', crashes: (b.pipeline?.crashes ?? 0) + 1, heldAt: at, heldBy: 'orchestrator-demo', heldWhy: 'demo build: retried by the guided live demo' };
      b.recoveries = [...(b.recoveries ?? []), rec];
      note(b, line, at);
    }, 'demo-watchdog');
    ctx.log(`watchdog ${id}: ${d.cause} → ${d.action}`);
    return { observed: `${d.cause} → ${d.action} (attempt ${d.attempt})`, evidence: [evidence('note', line, rowAddress(id)), evidence('status', `${id} ${d.status}`, rowAddress(id))] };
  },
  async 'demo.retry'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const s = await ctx.sessions.start(id);
    await updateDemoBuild(ctx.store, id, (b) => {
      b.status = 'running';
      b.pipeline = { ...(b.pipeline ?? {}), heldAt: '', heldBy: '', heldWhy: '', launchedAt: at, session: s.session, runs: (b.pipeline?.runs ?? 0) + 1 };
      tickStep(b, 's2', at); tickStep(b, 's3', at);
      note(b, `Retry 1 on the fake runner (session ${s.session}): s2 and s3 done.`, at);
    }, 'demo-retry');
    await ctx.sessions.stop(id);
    ctx.log(`retried ${id}: s2, s3 done`);
    return { observed: `${id} relaunched (retry 1), s2 and s3 crossed off`, evidence: [evidence('step', 's2 done', rowAddress(id, 's2')), evidence('step', 's3 done', rowAddress(id, 's3'))] };
  },
};

export const expects = {
  'session-dead': (ctx, act) => !ctx.sessions.alive(act.expect.build),
};
