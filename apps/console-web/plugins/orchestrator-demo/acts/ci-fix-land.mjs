/**
 * Act catalog part 3: simulated red CI on a demo branch, the auto-fix the lander files, merge-main for a clash, and the
 * landing. Red CI, the fix and merge-main use the dry-run landing line (dry-lander.mjs: the real auto-lander decisions,
 * recorded only). The landing act runs for REAL (Nov 18 2026, Brett: "If it recorded the test of the pipeline and didn't
 * merge it on its own, then the test failed. It should have tested itself before it did the demo."): first the self-test
 * (selftest.mjs: the real gate verdict, the real review lookup, the queue in check mode); if it fails the demo stops and
 * files a systems check item. Then the demo PR is created, queued and must merge through the real merge queue
 * (real-landing.mjs); a PR that does not merge is a failed act.
 */
import { createFixtures, findBuild, updateDemoBuild } from '../sandbox.mjs';
import { branchOf, prOf, snapshot } from '../dry-lander.mjs';
import { custom, evidence, focusRow, note, rowAddress, tickStep } from './common.mjs';
import { alertFor } from '../selftest.mjs';

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
      id: 'self-test', title: 'The lander tests itself first',
      caption: `Before anything lands, the demo runs the real lander path on a throwaway PR: the live gate rules, the review item lookup in the console, and the merge queue in check mode. If any of it fails the demo stops here and a systems check item says what.`,
      focus: focusRow(c, 's3', 'orchestrator demo: the lander self-test'),
      run: custom('demo.self-test', { build: c }), expect: { kind: 'custom', build: c, text: 'self-tested', within: 60000 },
      builds: [c], tags: ['lander', 'land', 'self-test'],
    },
    {
      id: 'land', title: 'It lands for real',
      caption: `CI is green and nothing clashes, so "${c}" lands for real: a demo branch with one commit, its PR opened and put in the real merge queue. The act passes only once the queue has merged it on main.`,
      focus: focusRow(c, 's3', 'orchestrator demo: the real landing'),
      run: custom('demo.land', { build: c }, LAND_TIMEOUT_MS), expect: { kind: 'custom', build: c, text: 'landed', within: LAND_TIMEOUT_MS },
      builds: [c], tags: ['lander', 'land'],
    },
  ];
}

/** How long the real landing may take: the merge queue's batch runs CI once on main + the PR (Nov 18 2026). */
export const LAND_TIMEOUT_MS = 45 * 60000;

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
  /** The self-test before the landing act: a failure stops the demo (result.stop) and files the systems check item. */
  async 'demo.self-test'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    if (!ctx.selfTest) return { observed: 'no self-test in this context', evidence: [evidence('error', 'the demo has no self-test wired: it cannot prove the lander path')], error: 'no self-test available', stop: true };
    const st = await ctx.selfTest();
    const bad = st.checks.filter((c) => !c.ok);
    const lines = st.checks.map((c) => `${c.ok ? 'ok' : 'FAIL'} ${c.id}: ${c.detail}`);
    await updateDemoBuild(ctx.store, id, (b) => { note(b, `Lander self-test ${st.ok ? 'passed' : 'FAILED'}: ${lines.join(' · ')}`.slice(0, 1200), at); }, 'demo-self-test');
    ctx.log(`self-test ${id}: ${st.ok ? 'passed' : `failed (${bad.map((c) => c.id).join(', ')})`}`);
    const ev = st.checks.map((c) => evidence(c.ok ? 'log' : 'error', `${c.id}: ${c.detail}`));
    if (!st.ok) {
      await ctx.alerts.raise?.(alertFor(st));
      return { observed: `self-test failed: ${bad.map((c) => c.id).join(', ')}`, evidence: ev, error: `the lander did not pass its own test before the demo (${bad[0].id}: ${bad[0].detail}); the demo stops here and a systems check item says what`, stop: true };
    }
    return { observed: `self-test passed: ${st.checks.map((c) => c.id).join(', ')} (${st.durationMs} ms)`, evidence: ev };
  },
  /** The landing, for real: the lander's decision on the green snapshot, then the demo PR through the real merge queue. */
  async 'demo.land'(ctx, act) {
    const id = act.run.body.build; const at = ctx.now();
    const d = ctx.lander.decide(findBuild(ctx.store, id), snapshot(id, { ci: 'success' }), [], at);
    if (d.action !== 'land') return { observed: `lander said ${d.action}, not land`, evidence: [evidence('error', d.reason ?? '')], error: `expected land, got ${d.action}` };
    if (!ctx.realLanding) {
      // no real landing wired (tests set AXF_DEMO_LAND=dry): the dry-run line records what it would merge, and that is a failed landing act
      const e = ctx.lander.land(findBuild(ctx.store, id), at);
      await updateDemoBuild(ctx.store, id, (b) => { note(b, `Landing not run for real: ${e.reason}`, at); }, 'demo-land-dry');
      ctx.log(`dry-landed ${id} (no real landing available)`);
      return { observed: e.reason, evidence: [evidence('log', e.reason), evidence('error', 'the real landing is not available here: a dry run is not a landing')], error: 'the demo PR did not merge: the real landing is not available (dry run only)' };
    }
    const r = await ctx.realLanding.land({ build: id, runId: ctx.runId, at });
    await updateDemoBuild(ctx.store, id, (b) => {
      if (r.pr) { b.pr = r.pr; b.branch = r.branch; }
      note(b, r.ok ? `Landing for real: PR #${r.pr} from ${r.branch} is in the merge queue; it lands when the queue's run is green.` : `Landing for real failed: ${r.why}`, at);
    }, 'demo-land');
    ctx.log(r.ok ? `queued ${id}: PR #${r.pr} (${r.branch})` : `land ${id} failed: ${r.why}`);
    if (!r.ok) return { observed: r.why, evidence: [evidence('error', r.why)], error: `the demo PR did not reach the merge queue: ${r.why}` };
    return { observed: `PR #${r.pr} from ${r.branch} is in the merge queue${r.url ? ` (${r.url})` : ''}; waiting for the queue to merge it`, evidence: [evidence('log', `queued #${r.pr}`, rowAddress(id, 's3')), ...(r.url ? [evidence('custom', r.url)] : [])] };
  },
};

export const expects = {
  'self-tested': (ctx, act) => (findBuild(ctx.store, act.expect.build)?.notes ?? []).some((n) => n.text.startsWith('Lander self-test passed')),
  /** Landed = the real merge queue merged the demo PR (the act's s3 is crossed off then); never the dry-run entry. */
  'landed': async (ctx, act) => {
    if (!ctx.realLanding) return false;
    const ok = await ctx.realLanding.merged(act.expect.build);
    if (ok) { const at = ctx.now(); const b = findBuild(ctx.store, act.expect.build); if (b && !b.steps?.find((s) => s.id === 's3')?.done) await updateDemoBuild(ctx.store, act.expect.build, (x) => { tickStep(x, 's3', at); x.status = 'landed'; note(x, `Landed for real: the merge queue merged PR #${ctx.realLanding.entry(act.expect.build)?.pr}.`, at); }, 'demo-landed'); }
    return ok;
  },
  'dry-landed': (ctx, act) => ctx.lander.entries(act.expect.build).some((e) => e.action === 'land' && e.dryRun),
};
