/**
 * Act catalog part 3: simulated red CI on a demo branch, the auto-fix the lander files, merge-main for a clash, and
 * landing through the dry-run landing line (dry-lander.mjs: the real auto-lander decisions, never the merge queue).
 */
import { createFixtures, findBuild, updateDemoBuild } from '../sandbox.mjs';
import { branchOf, prOf, snapshot } from '../dry-lander.mjs';
import { custom, evidence, focusRow, note, rowAddress, tickStep } from './common.mjs';

export const PART = 3;
export const TITLE = 'Red CI, auto-fix, merge-main and landing';

export function acts(ids) {
  const c = ids.ci;
  return [
    {
      id: 'ci-red', title: 'CI goes red on a demo branch',
      caption: `"${c}" finishes its first step and opens a (simulated) PR from ${branchOf(c)}. CI comes back red; watch the row turn to Fixing.`,
      focus: focusRow(c, '', 'orchestrator demo: red CI on a demo branch'),
      run: custom('demo.ci-red', { build: c }), expect: { kind: 'status', build: c, status: 'fixing', within: 15000 },
      builds: [c], tags: ['lander', 'ci', 'failure'],
    },
    {
      id: 'auto-fix', title: 'An auto-fix is filed and fixes it',
      caption: `The lander files a fix session for the red check. A fake session fixes it: step s2 is crossed off and CI turns green.`,
      focus: focusRow(c, 's2', 'orchestrator demo: the auto-fix'),
      run: custom('demo.auto-fix', { build: c }), expect: { kind: 'step-done', build: c, step: 's2', within: 15000 },
      builds: [c], tags: ['lander', 'ci'],
    },
    {
      id: 'merge-main', title: 'Main moved on: merge-main',
      caption: `Main changed under "${c}" and the PR now clashes. The lander's answer is merge-main; watch the note it leaves.`,
      focus: focusRow(c, '', 'orchestrator demo: merge-main'),
      run: custom('demo.merge-main', { build: c }), expect: { kind: 'note', build: c, text: 'merge-main', within: 15000 },
      builds: [c], tags: ['lander', 'clash'],
    },
    {
      id: 'land-dry', title: 'It lands (dry run)',
      caption: `CI is green and nothing clashes, so the lander lands "${c}". This is the dry-run landing line: it says what it would merge and merges nothing.`,
      focus: focusRow(c, 's3', 'orchestrator demo: dry-run landing'),
      run: custom('demo.land', { build: c }), expect: { kind: 'custom', build: c, text: 'dry-landed', within: 15000 },
      builds: [c], tags: ['lander', 'land'],
    },
  ];
}

export const handlers = {
  async 'demo.ci-red'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    if (!findBuild(ctx.store, id)) await createFixtures({ store: ctx.store, data: ctx.data, suffix: ctx.suffix, runId: ctx.runId, keys: ['ci'] });
    const d = ctx.lander.decide(findBuild(ctx.store, id), snapshot(id, { ci: 'failure', failing: ['demo-check'] }), [], at);
    await updateDemoBuild(ctx.store, id, (b) => {
      b.branch = branchOf(id); b.pr = prOf(id);
      tickStep(b, 's1', at);
      b.status = 'fixing';
      note(b, `CI is red on ${branchOf(id)} (demo-check failed). Lander: ${d.action}. ${d.reason ?? ''}`.trim(), at);
    }, 'demo-ci-red');
    ctx.log(`ci-red ${id}: lander ${d.action}`);
    return { observed: `CI red on ${branchOf(id)}; lander answered ${d.action}`, evidence: [evidence('status', `${id} fixing`, rowAddress(id)), evidence('log', `lander: ${d.action} (${d.reason ?? ''})`)] };
  },
  async 'demo.auto-fix'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const s = await ctx.sessions.start(id);
    await updateDemoBuild(ctx.store, id, (b) => {
      tickStep(b, 's2', at); b.status = 'landing';
      note(b, `Auto-fix ran on the fake runner (session ${s.session}): demo-check fixed, CI green.`, at);
    }, 'demo-auto-fix');
    await ctx.sessions.stop(id);
    ctx.log(`auto-fix ${id}: green`);
    return { observed: `fix session ${s.session} fixed demo-check; CI green`, evidence: [evidence('step', 's2 done', rowAddress(id, 's2'))] };
  },
  async 'demo.merge-main'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const d = ctx.lander.decide(findBuild(ctx.store, id), snapshot(id, { ci: 'success', conflicts: ['apps/demo/README.md'] }), [], at);
    await updateDemoBuild(ctx.store, id, (b) => { note(b, `Main moved on and the PR clashes (apps/demo/README.md). Lander: ${d.action} (dry run: main merged into ${branchOf(id)} in the ledger only).`, at); }, 'demo-merge-main');
    ctx.log(`merge-main ${id}: lander ${d.action}`);
    const ok = d.action === 'merge-main';
    return { observed: `clash → lander ${d.action}`, evidence: [evidence('note', `lander: ${d.action}`, rowAddress(id))], ...(ok ? {} : { error: `expected merge-main, the lander said ${d.action}` }) };
  },
  async 'demo.land'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const d = ctx.lander.decide(findBuild(ctx.store, id), snapshot(id, { ci: 'success' }), [], at);
    if (d.action !== 'land') return { observed: `lander said ${d.action}, not land`, evidence: [evidence('error', d.reason ?? '')], error: `expected land, got ${d.action}` };
    const e = ctx.lander.land(findBuild(ctx.store, id), at);
    await updateDemoBuild(ctx.store, id, (b) => { tickStep(b, 's3', at); note(b, `Landed (dry run): ${e.reason}`, at); }, 'demo-land');
    ctx.log(`dry-landed ${id}`);
    return { observed: e.reason, evidence: [evidence('step', 's3 done', rowAddress(id, 's3')), evidence('log', e.reason)] };
  },
};

export const expects = {
  'dry-landed': (ctx, act) => ctx.lander.entries(act.expect.build).some((e) => e.action === 'land' && e.dryRun),
};
