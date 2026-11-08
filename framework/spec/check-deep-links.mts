/**
 * deep-link@1 in the browser layer (framework/react/deepLinks.ts): a link opens the view, settings tab and dialog, runs
 * only navigate / read actions in order, waits for a lazy plugin's action to register, and refuses writes with a toast.
 *   npx -y tsx framework/spec/check-deep-links.mts
 */
import assert from 'node:assert/strict';
import { applyDeepLink } from '../react/deepLinks';

type Meta = { label: string; effect?: string; personOnly?: boolean };
function fakeRuntime() {
  const actions = new Map<string, Meta>();
  const log: string[] = [];
  const rt = {
    actions: { list: () => [...actions].map(([id, meta]) => ({ id, meta })) },
    navigate: (v: string) => log.push(`nav ${v}`),
    openDialog: (d: string) => log.push(`dialog ${d}`),
    dispatch: (spec: string) => { log.push(`run ${spec}`); return actions.has(spec.split(':')[0]!); },
    toast: (m: string) => log.push(`toast ${m}`),
  };
  return { rt, actions, log };
}

let n = 0;
const { rt, actions, log } = fakeRuntime();
actions.set('settings.open', { label: 'Open a settings tab' });
actions.set('demo.edit', { label: 'Open in the designer', effect: 'navigate' });
actions.set('demo.delete', { label: 'Delete', effect: 'destructive' });
setTimeout(() => actions.set('book.tab', { label: 'Book tab', effect: 'navigate' }), 120); // a lazy plugin registers late

const r = await applyDeepLink(rt as never, '?axf-view=demo-designer&axf-settings=glossary-index&axf-dialog=glossary-index.book-wizard&axf-do=demo.edit:demonstration:tour&axf-do=demo.delete:demonstration:tour&axf-do=book.tab:plan&axf-do=never.registered', { waitMs: 400, stepMs: 20 });
assert.deepEqual([r.view, r.settings, r.dialog], ['demo-designer', 'glossary-index', 'glossary-index.book-wizard']); n++;
assert.deepEqual(r.ran, ['demo.edit:demonstration:tour', 'book.tab:plan'], 'navigate actions ran, in order, the late one after it registered'); n++;
assert.deepEqual(r.refused.map((x) => x.spec), ['demo.delete:demonstration:tour', 'never.registered'], 'a write and an unknown action are refused'); n++;
assert.ok(!log.includes('run demo.delete:demonstration:tour'), 'the destructive action never ran'); n++;
assert.ok(log.indexOf('nav demo-designer') < log.indexOf('run demo.edit:demonstration:tour'), 'the view opens before its actions run'); n++;
assert.ok(log.includes('run settings.open:glossary-index') && log.includes('dialog glossary-index.book-wizard'), 'settings tab and dialog open'); n++;
assert.equal(log.filter((l) => l.startsWith('toast')).length, 2, 'one toast per refusal'); n++;

const bad = fakeRuntime();
const r2 = await applyDeepLink(bad.rt as never, '?axf-view=Not%20A%20View', { waitMs: 0 });
assert.ok(!r2.view && r2.errors.length === 1 && !bad.log.some((l) => l.startsWith('nav')), 'a bad view navigates nowhere and says why'); n++;

console.log(`✓ deep links — ${n} checks`);
