#!/usr/bin/env node
/**
 * One-shot migration (build remove-ui-review-as-a-gate-…, Brett Nov 13 2026: UI Review is no longer a gate): every
 * open step whose only job is UI Review (submit shots, approval screenshots, options made for review) in a build that
 * is still live is marked skipped with the note 'UI Review no longer a gate'. Done steps, skipped steps and archived,
 * complete or deleted builds are left alone. Written through the store's own writer (builds-store.mjs withStore), so
 * it is journalled and published to main by builds-live like any other change.
 *
 *   node apps/console-web/plugins/build-orchestrator/migrate-ui-review-steps.mjs            dry run: what it would skip
 *   node apps/console-web/plugins/build-orchestrator/migrate-ui-review-steps.mjs --apply    write it
 *   --json prints JSON. Idempotent: a second run finds nothing.
 */
import { UI_REVIEW_SKIP_NOTE, uiReviewOnlyStep } from './pipeline-core.mjs';
import { readStoreNow as readStore, withStore } from '../../../../framework/cli/builds-store.mjs';

const ENDED = new Set(['archived', 'complete']);

/** The steps the migration skips: [{ build, step, text }]. Pure over a builds@1 store. */
export function plan(store) {
  const out = [];
  for (const b of store?.builds ?? []) {
    if (!b || b.deleted || ENDED.has(b.status)) continue;
    for (const s of b.steps ?? []) if (!s.done && !s.skip && uiReviewOnlyStep(s.text)) out.push({ build: b.id, step: s.id, text: String(s.text).slice(0, 200) });
  }
  return out;
}

/** The store with those steps skipped and noted (a new object; the input is not changed). */
export function apply(store, hits = plan(store)) {
  const want = new Set(hits.map((h) => `${h.build}\u0000${h.step}`));
  return { ...store, builds: store.builds.map((b) => (!b.steps?.some((s) => want.has(`${b.id}\u0000${s.id}`)) ? b
    : { ...b, steps: b.steps.map((s) => (want.has(`${b.id}\u0000${s.id}`) ? { ...s, skip: true, note: s.note ? `${s.note} · ${UI_REVIEW_SKIP_NOTE}` : UI_REVIEW_SKIP_NOTE } : s)) })) };
}

async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json'); const write = argv.includes('--apply');
  const hits = plan(readStore());
  if (write && hits.length) {
    withStore((s) => apply(s, plan(s)), { by: 'migration', action: 'ui-review-steps', note: `${UI_REVIEW_SKIP_NOTE}: ${hits.length} step(s) skipped` });
  }
  if (json) console.log(JSON.stringify({ ok: true, applied: write, steps: hits }));
  else {
    console.log(`${write ? 'skipped' : 'would skip'} ${hits.length} step(s) whose only job is UI Review${hits.length ? ':' : ''}`);
    for (const h of hits) console.log(`  ${h.build} ${h.step}  ${h.text.slice(0, 110)}`);
    if (!write && hits.length) console.log('dry run: nothing written (add --apply)');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
