/**
 * Act catalog part 1: a build appears in Pending, is queued, launched on the fake runner, shows the running animation,
 * and its steps are crossed off one at a time in the grid.
 */
import { createFixtures, findBuild, updateDemoBuild } from '../sandbox.mjs';
import { custom, evidence, focusRow, focusView, note, rowAddress, tickStep } from './common.mjs';

export const PART = 1;
export const TITLE = 'Queue, launch and steps crossed off';

/** The demo-act@1 entries of part 1 for this run's ids. */
export function acts(ids) {
  const g = ids.grid;
  const steps = ['s1', 's2', 's3', 's4'];
  return [
    {
      id: 'pending-appears', title: 'A new build appears in Pending',
      caption: `A throwaway build "${g}" is created. Watch it appear in the Pending grid with its 4 steps, marked as a demo build.`,
      focus: focusView('view:builds/tab:pipeline', 'orchestrator demo: a demo build appears in Pending'),
      run: custom('demo.create', { fixture: 'grid' }), expect: { kind: 'row', build: g, within: 15000 },
      builds: [g], tags: ['grid', 'pending'],
    },
    {
      id: 'queue', title: 'The build is queued',
      caption: `"${g}" moves from Pending to the Queue. It is held for the demo, so the real dispatcher never launches it on a Claude account.`,
      focus: focusRow(g, '', 'orchestrator demo: the build moves to the Queue'),
      run: custom('demo.queue', { build: g }), expect: { kind: 'status', build: g, status: 'queued', within: 15000 },
      builds: [g], tags: ['grid', 'queue'],
    },
    {
      id: 'launch', title: 'The build is launched',
      caption: `"${g}" is launched on the fake headless runner (no Claude account is spent). Its row turns to Running.`,
      focus: focusRow(g, '', 'orchestrator demo: launch on the fake runner'),
      run: custom('demo.launch', { build: g }), expect: { kind: 'status', build: g, status: 'running', within: 15000 },
      builds: [g], tags: ['grid', 'dispatch'],
    },
    {
      id: 'running-animation', title: 'The running animation',
      caption: `While "${g}" runs, its row shows the running animation and the session it runs on. Nothing changes in this act: just watch the row.`,
      focus: focusRow(g, '', 'orchestrator demo: the running animation'),
      run: custom('demo.heartbeat', { build: g }), expect: { kind: 'custom', build: g, text: 'session-alive', within: 10000 },
      builds: [g], tags: ['grid', 'running'],
    },
    ...steps.map((s, i) => ({
      id: `tick-${s}`, title: `Step ${s} is crossed off`,
      caption: `The fake session finishes step ${s} of "${g}" (${i + 1} of ${steps.length}). Watch it get crossed off in the grid.`,
      focus: focusRow(g, s, `orchestrator demo: ${s} is crossed off`),
      run: custom('demo.tick', { build: g, step: s }), expect: { kind: 'step-done', build: g, step: s, within: 15000 },
      builds: [g], tags: ['grid', 'steps'],
    })),
  ];
}

export const handlers = {
  async 'demo.create'(ctx, act) {
    const ids = await createFixtures({ store: ctx.store, data: ctx.data, suffix: ctx.suffix, runId: ctx.runId, keys: [act.run.body?.fixture ?? 'grid'] });
    ctx.log(`created ${ids.join(', ')}`);
    return { observed: `created ${ids.join(', ')} in Pending`, evidence: ids.map((id) => evidence('status', `${id} pending`, rowAddress(id))) };
  },
  async 'demo.queue'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    await updateDemoBuild(ctx.store, id, (b) => {
      b.status = 'queued';
      b.pipeline = { ...(b.pipeline ?? {}), queuedAt: at, queuedBy: 'orchestrator-demo', heldAt: at, heldBy: 'orchestrator-demo', heldWhy: 'demo build: driven by the guided live demo, never by the dispatcher' };
      note(b, 'Queued by the guided live demo (held so the real dispatcher leaves it alone).', at);
    }, 'demo-queue');
    ctx.log(`queued ${id}`);
    return { observed: `${id} queued (held for the demo)`, evidence: [evidence('status', `${id} queued`, rowAddress(id))] };
  },
  async 'demo.launch'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const s = await ctx.sessions.start(id);
    await updateDemoBuild(ctx.store, id, (b) => {
      b.status = 'running';
      b.pipeline = { ...(b.pipeline ?? {}), heldAt: '', heldBy: '', heldWhy: '', launchedAt: at, session: s.session, account: '', model: 'Opus', runs: (b.pipeline?.runs ?? 0) + 1 };
      note(b, `Launched on the fake runner (session ${s.session}, pid ${s.pid}).`, at);
    }, 'demo-launch');
    ctx.log(`launched ${id} on ${s.session}`);
    return { observed: `${id} running on ${s.session} (pid ${s.pid})`, evidence: [evidence('status', `${id} running`, rowAddress(id)), evidence('log', `fake session ${s.session} pid ${s.pid}`)] };
  },
  async 'demo.heartbeat'(ctx, act) {
    const id = act.run.body.build;
    const alive = ctx.sessions.alive(id);
    ctx.log(alive ? `session-alive ${id}` : `session-dead ${id}`);
    return { observed: alive ? `${id}: fake session alive, row animating` : `${id}: fake session not alive`, evidence: [evidence('custom', alive ? 'session-alive' : 'session-dead', rowAddress(id))] };
  },
  async 'demo.tick'(ctx, act) {
    const { build: id, step } = act.run.body; const at = ctx.now();
    await updateDemoBuild(ctx.store, id, (b) => { tickStep(b, step, at); }, 'demo-tick');
    const b = findBuild(ctx.store, id);
    const left = (b?.steps ?? []).filter((s) => !s.done && !s.skip).length;
    ctx.log(`ticked ${id} ${step}`);
    return { observed: `${id} ${step} crossed off (${left} left)`, evidence: [evidence('step', `${step} done`, rowAddress(id, step))] };
  },
};

/** Custom expectations of this part: name → (ctx, act) → boolean. */
export const expects = {
  'session-alive': (ctx, act) => ctx.sessions.alive(act.expect.build),
};
