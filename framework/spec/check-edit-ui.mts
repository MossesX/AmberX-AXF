/*
 * edit-ui@1 check (spec/EDIT-UI.md; build edit-ui-mode-inline-edit-anything-active, Nov 17 2026. Brett: "I need a way
 * to inline edit anything. We need an Edit UI. When Edit UI is on, it only works when I'm also holding down Control.")
 *
 *   1. Fixture replay (spec/fixtures/edit-ui.json, gen-fixtures.mts): every target's validation and key, the owner each
 *      context gives, the gate script step by step, the undo stack (push, undo, redo, commit after undo, cap, revert).
 *   2. Contract rules: Edit UI off = Ctrl does nothing; Ctrl released ends editing and cancels an open edit; a long-press
 *      edit survives Ctrl but not a window blur; a cancel or a no-op commit never records; read-only owners refuse with a
 *      reason; hide goes through the hide-any-asset owner and is unavailable until that build lands.
 *   3. Schema snapshots: framework/schemas/edit-ui.json and schemas/json/edit-ui-*.schema.json are what `axf schemas`
 *      writes now (the settings block carries axf.editUi.enabled, off by default).
 *   4. Runtime: rt.editUi exposes state / setEnabled / beginEdit / commit / cancel / undo / redo / subscribe and the owner
 *      adapter registry; the settings group is added once.
 *
 * Run: npx -y tsx framework/spec/check-edit-ui.mts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_UI_INITIAL, editUiStateFrom, editUiStateView, reduceEditUi, resolveOwner, targetKey, validateTarget, type EditUiEvent, type EditUiState, type OwnerContext } from '../core/engines/edit-ui';
import { emptyUndo, pushEdit, redo, revertStep, undo, undoHistory, undoSummary } from '../core/engines/edit-ui-undo';
import { EDIT_UI_ENABLED_KEY, EDIT_UI_HIDE_BUILD, EDIT_UI_SETTINGS_GROUP, editUiRegistry, jsonSchemas } from '../core/engines/edit-ui-rules.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let pass = 0;
const fails: string[] = [];
const ok = (cond: unknown, what: string) => { if (cond) pass++; else fails.push(what); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const fx = read('framework/spec/fixtures/edit-ui.json');

/* 1. fixture replay */
type CtxSpec = { dataSources?: OwnerContext['dataSources']; hideableKinds?: string[]; denied?: string[]; locked?: boolean; owners?: string[]; missingAssets?: string[] };
const ctxFrom = (c: CtxSpec): OwnerContext => ({
  ...(c.dataSources ? { dataSources: c.dataSources } : {}), ...(c.hideableKinds ? { hideableKinds: c.hideableKinds } : {}), ...(c.locked !== undefined ? { locked: c.locked } : {}), ...(c.owners ? { owners: c.owners } : {}),
  ...(c.denied ? { can: (p: string) => !c.denied!.includes(p) } : {}),
  ...(c.missingAssets ? { hasAsset: (t: string, id: string) => !c.missingAssets!.includes(`${t}/${id}`) } : {}),
});
ok(same(fx.initial.off, EDIT_UI_INITIAL) && same(fx.initial.fromSetting.on, editUiStateFrom(true)) && same(fx.initial.fromSetting.off, editUiStateFrom(false)), 'initial states');
for (const [k, t] of Object.entries(fx.targets)) {
  const v = validateTarget(t);
  ok(same(v, fx.validation[k]), `validateTarget ${k}`);
  if (v.ok) ok(targetKey(v.target) === fx.keys[k], `targetKey ${k}`);
}
for (const [c, spec] of Object.entries(fx.contexts as Record<string, CtxSpec>)) {
  for (const [k, t] of Object.entries(fx.targets)) ok(same(resolveOwner(t, ctxFrom(spec)), fx.owners[c][k]), `owner ${c}/${k}`);
}
{
  let state: EditUiState = EDIT_UI_INITIAL;
  (fx.gate.script as EditUiEvent[]).forEach((event, i) => {
    const r = reduceEditUi(state, event);
    state = r.state;
    ok(same({ event, ...r }, fx.gate.steps[i]), `gate step ${i} (${event.type})`);
  });
  const ops = fx.gate.steps.flatMap((g: { op?: unknown }) => (g.op ? [g.op] : []));
  ok(same(ops, fx.undo.ops), 'ops out of the gate');
  const at = (n: number) => `2026-11-17T15:00:${String(n).padStart(2, '0')}.000Z`;
  let stack = emptyUndo();
  ops.forEach((op: never, i: number) => { const r = pushEdit(stack, op, at(i), 'brett'); stack = r.stack; ok(same({ entry: r.entry, summary: undoSummary(stack) }, fx.undo.pushes[i]), `push ${i}`); });
  ok(same(editUiStateView(state, undoSummary(stack)), fx.gate.view), 'state view');
  ok(same(pushEdit(stack, { ...ops[0], after: ops[0].before }, at(9)), fx.undo.noop), 'no-op push');
  const u1 = undo(stack); const u2 = undo(u1.stack); const u3 = undo(u2.stack);
  ok(same(u1, fx.undo.undo1) && same(u2, fx.undo.undo2) && same(u3, fx.undo.undo3), 'undo ×3');
  const r1 = redo(u2.stack);
  ok(same(r1, fx.undo.redo1), 'redo');
  const afterUndo = pushEdit(u1.stack, { ...ops[1], before: 'Z', after: 'Y' }, at(10));
  ok(same(afterUndo, fx.undo.afterUndo) && same(redo(afterUndo.stack), fx.undo.redoAfterPush), 'commit after undo drops the redo tail');
  ok(same(undoHistory(afterUndo.stack), fx.undo.history), 'history');
  let capped = emptyUndo();
  for (let i = 0; i < 5; i++) capped = pushEdit(capped, { ...ops[0], before: i, after: i + 1 }, at(20 + i), undefined, 3).stack;
  ok(same({ stack: capped, summary: undoSummary(capped) }, fx.undo.capped), 'cap');
  ok(same({ undo: revertStep(u1.stack, 'undo'), redo: revertStep(r1.stack, 'redo') }, fx.undo.reverted), 'revert');
}

/* 2. contract rules */
{
  const steps = fx.gate.steps as { event: EditUiEvent; state: EditUiState; op?: unknown; refused?: { reason: string }; cancelled?: boolean; noop?: boolean }[];
  const at = (i: number) => steps[i]!;
  ok(at(0).state.mode === 'off' && at(1).refused?.reason === 'off', 'Edit UI off: Ctrl does nothing, begin refused');
  ok(at(2).state.mode === 'armed' && at(3).refused?.reason === 'not-held', 'armed: begin without Ctrl is refused');
  ok(at(4).state.mode === 'held' && at(5).refused?.reason === 'code-text' && at(5).state.mode === 'held', 'held: a read-only target refuses with its reason and stays held');
  ok(at(6).state.mode === 'editing' && at(7).refused?.reason === 'busy', 'one edit at a time');
  ok(!!at(8).op && at(8).state.mode === 'held', 'commit emits an op and goes back to held while Ctrl is down');
  ok(at(10).noop === true && !at(10).op, 'equal before/after is a no-op: nothing recorded');
  ok(at(12).cancelled === true && !at(12).op && at(12).state.mode === 'held', 'Esc cancels, never records');
  ok(at(14).cancelled === true && at(14).state.mode === 'armed' && at(15).refused, 'Ctrl released ends editing and cancels the open edit');
  ok(at(16).state.mode === 'editing' && at(16).state.edit?.gate === 'touch' && at(17).state.mode === 'editing', 'a long-press edit stays open when Ctrl is released');
  ok(!!at(18).op && at(18).state.mode === 'armed', 'a touch commit goes back to armed');
  ok(at(20).cancelled === true && at(20).state.mode === 'armed', 'window blur cancels a touch edit too');
  ok(at(23).refused?.reason === 'bad-target' && at(23).state.mode === 'editing', 'a non-scalar value is refused, the edit stays open');
  ok(at(24).cancelled === true && at(24).state.mode === 'off' && at(25).state.mode === 'off' && at(26).refused?.reason === 'off', 'setting off cancels and locks the gate');
  ok(fx.undo.ops.length === 2 && fx.undo.pushes.length === 2, 'two edits reached the stack: cancels and no-ops never did');
  ok(fx.undo.noop.entry === null, 'a no-op push records nothing');
  ok(fx.undo.undo3.refused?.reason === 'nothing-to-undo' && fx.undo.redoAfterPush.refused?.reason === 'nothing-to-redo', 'empty undo / redo refuse with a reason');
  // undo1 steps back over ops[1]; undo2 over ops[0]; redo1 (from undo2's stack) re-applies ops[0]
  ok(fx.undo.undo1.apply?.value === fx.undo.ops[1].before && fx.undo.undo2.apply?.value === fx.undo.ops[0].before && fx.undo.redo1.apply?.value === fx.undo.ops[0].after, 'undo re-applies before, redo re-applies after');
  ok(same(fx.undo.undo1.apply.owner, fx.undo.ops[1].owner), 'undo goes through the same owner');
  ok(fx.undo.capped.stack.entries.length === 3 && fx.undo.capped.stack.entries[0].before === 2, 'the cap drops the oldest');
  const o = fx.owners;
  ok(o.base.toolbarSize.kind === 'asset-token' && o.base.tabColour.kind === 'asset-token' && o.base.themeAccent.kind === 'asset-token' && o.base.themeAccent.key === 'axf.tokens.theme', 'size, colour and tokens are asset-token');
  ok(o.base.navIcon.kind === 'asset-property' && o.base.navIcon.key === 'axf.chrome.nav-menu.main' && o.base.buttonLabel.key === 'look:button/primary', 'icon / order / label are asset-property (chrome instance or look writer)');
  ok(o.base.bannerHide.kind === 'hidden-assets' && o.base.widgetHide.kind === 'hidden-assets' && o.base.cardHide.kind === 'read-only', 'hide is the hide-any-asset owner for its kinds only');
  ok(o.base.columnHide.kind === 'asset-property' && o.base.columnHide.key === 'axf.grid.builds.queue.columns', 'a column hide is a grid override, not a Hidden-list entry');
  ok(o.base.cell.kind === 'data' && o.base.recordTitle.kind === 'data' && o.base.cellReadOnly.reason === 'no-writer' && o.base.cellNoSource.reason === 'unknown-source' && o.base.cellNoPermission.reason === 'permission', 'data owner and its refusals');
  ok(o.base.codeText.reason === 'code-text', 'a string written in code has no owner');
  ok(o.locked.toolbarSize.reason === 'locked' && o.locked.bannerHide.reason === 'locked' && o.locked.cell.kind === 'data', 'a locked look stops look owners, not data');
  ok(o.noLookPermission.toolbarSize.reason === 'permission' && o.noLookPermission.cell.kind === 'data', 'assets.swap gates look owners only');
  ok(o.hideNotLanded.bannerHide.reason === 'owner-unavailable' && o.hideNotLanded.bannerHide.detail.includes(EDIT_UI_HIDE_BUILD) && o.hideNotLanded.toolbarSize.kind === 'asset-token', 'hide is unavailable until the hide-any-asset build lands');
  ok(o.noDataOwner.cell.reason === 'owner-unavailable', 'a missing data owner refuses');
  ok(o.missingAsset.toolbarSize.reason === 'unknown-asset' && o.missingAsset.menuLabel.reason === 'unknown-asset' && o.missingAsset.tabColour.kind === 'asset-token', 'an asset that does not exist refuses');
  ok(o.narrowHide.widgetHide.reason === 'bad-target' && o.narrowHide.bannerHide.reason === 'bad-target', 'hideable kinds come from the context');
  ok(o.empty.cell.reason === 'unknown-source' && o.empty.toolbarSize.kind === 'asset-token', 'an empty context objects to nothing but unknown sources');
  for (const k of ['badKind', 'badProp', 'badColumnProp', 'badSlot', 'missingField', 'textNoOwner', 'notObject']) ok(o.base[k].reason === 'bad-target' && fx.validation[k].ok === false, `bad target ${k}`);
}

/* 3. schema snapshots */
ok(same(read('framework/schemas/edit-ui.json'), editUiRegistry()), 'framework/schemas/edit-ui.json is current (axf schemas)');
for (const [n, s] of Object.entries(jsonSchemas())) ok(same(read(`framework/schemas/json/${n}`), s), `schemas/json/${n} is current (axf schemas)`);
ok(same(fx.registry, editUiRegistry()), 'fixture registry is current');
ok(EDIT_UI_SETTINGS_GROUP.settings.some((s) => s.key === EDIT_UI_ENABLED_KEY && s.kind === 'toggle' && s.default === false), 'the settings block carries axf.editUi.enabled, off by default');

/* 4. runtime */
{
  const text = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
  const rt = text('framework/core/runtime.ts');
  const owners = text('framework/core/edit-ui-owners.ts');
  ok(owners.length > 0, 'framework/core/edit-ui-owners.ts exists');
  ok(/readonly editUi/.test(rt) && /new EditUiController\(this\)/.test(rt), 'the runtime carries rt.editUi');
  for (const m of ['state()', 'setEnabled(', 'beginEdit(', 'commit(', 'cancel(', 'undo()', 'redo()', 'subscribe(', 'registerOwner(', 'registerDataSource(', 'resolve(', 'set(']) ok(owners.includes(`  ${m}`), `rt.editUi.${m}`);
  ok(/EDIT_UI_SETTINGS_GROUP/.test(owners) && /addGroup\(/.test(owners), 'the settings group is added by the controller');
  ok(/registerOwner\('asset-token'/.test(owners) && /registerOwner\('asset-property'/.test(owners) && /registerOwner\('data'/.test(owners), 'asset-token, asset-property and data owners are registered by default');
  ok(!/registerOwner\('hidden-assets'/.test(owners), `the hidden-assets owner is registered by build ${EDIT_UI_HIDE_BUILD}, not here`);
}

console.log(`edit-ui: ${pass} checks passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f of fails) console.log(`  ✗ ${f}`);
if (fails.length) process.exit(1);
