// @ts-nocheck: a Node test (node --experimental-strip-types), not part of the console's build
/** Self-test for walkthrough@1 cleaning and stepping (node --experimental-strip-types apps/console-web/plugins/molly-guide/test.mts). */
import { cleanWalkthrough, pollDecision, stepAt, targetSelector, voiceMove } from './web/walkthrough.ts';
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
// never pops up on load (Nov 13 2026): first read learns, auto is opt-in, old walkthroughs never open
const LOAD = 1_000_000;
const wk = (seq, at) => ({ $axf: 'walkthrough@1', id: `w${seq}`, title: 't', app: 'console', steps: [{ say: 's', do: '', target: '' }], seq, at });
eq(pollDecision([wk(3, LOAD + 5), wk(2, LOAD)], -1, true, LOAD), { lastSeq: 3, open: null }, 'first read after a load only learns, even with auto on');
eq(pollDecision([wk(4, LOAD + 5)], 3, undefined, LOAD).open, null, 'auto unset (default) never opens');
eq(pollDecision([wk(4, LOAD + 5)], 3, false, LOAD), { lastSeq: 4, open: null }, 'auto off only learns');
eq(pollDecision([wk(4, LOAD + 5)], 3, 'true', LOAD).open, null, 'auto must be exactly true');
eq(pollDecision([wk(4, LOAD - 120_000)], 3, true, LOAD).open, null, 'made before this page loaded: never opens');
eq(pollDecision([{ ...wk(4, 0), at: undefined }], 3, true, LOAD).open, null, 'no time: never opens');
eq(pollDecision([wk(5, LOAD + 9), wk(4, LOAD + 5)], 3, true, LOAD).open?.seq, 5, 'auto on, new since load: the newest opens');
eq(pollDecision([wk(3, LOAD + 9)], 3, true, LOAD), { lastSeq: 3, open: null }, 'nothing newer: nothing');
eq(pollDecision([], -1, true, LOAD), { lastSeq: -1, open: null }, 'empty: nothing');
console.log(`${bad ? '✗' : '✓'} molly-guide: ${n - bad}/${n}`);
process.exit(bad ? 1 : 0);
