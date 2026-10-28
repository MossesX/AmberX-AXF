// @ts-nocheck: a Node test (node --experimental-strip-types), not part of the console's build
/** Self-test for walkthrough@1 cleaning and stepping (node --experimental-strip-types apps/console-web/plugins/molly-guide/test.mts). */
import { cleanWalkthrough, stepAt, targetSelector, voiceMove } from './web/walkthrough.ts';
let n = 0, bad = 0;
const eq = (a, b, what) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.error(`✗ ${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); } };
const w = cleanWalkthrough({ id: 'AI Setup!', title: 'Set up AI', steps: [{ say: 'Open settings.', do: 'settings.open:ai', target: 'ai' }, { say: 'x', do: 'javascript:alert(1)', target: '<b>' }, { say: 'y', do: 'https://evil', target: '' }, { nope: 1 }] });
eq(w.id, 'ai-setup', 'id cleaned');
eq(w.steps.length, 3, 'empty steps dropped');
eq([w.steps[1].do, w.steps[1].target, w.steps[2].do], ['', '', ''], 'script/link actions and markup targets dropped');
eq(cleanWalkthrough({ steps: [] }), null, 'no steps = nothing');
eq(cleanWalkthrough('x'), null, 'not an object = nothing');
eq([stepAt(w, -3).at, stepAt(w, 99).at, stepAt(w, 2).last, stepAt(w, 0).first], [0, 2, true, true], 'steps clamp');
eq(targetSelector('ai')[0], '[data-axf-id="ai"]', 'target: data-axf-id first');
eq(targetSelector(''), [], 'no target');
eq([voiceMove('Next!'), voiceMove('go back'), voiceMove('say again'), voiceMove('thank you'), voiceMove('banana')], ['next', 'prev', 'repeat', 'close', null], 'voice moves');
console.log(`${bad ? '✗' : '✓'} molly-guide: ${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
