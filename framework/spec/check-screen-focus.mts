/**
 * Screen focus (focus-on-every-screen, Nov 12 2026): the check's list / marker / own-focus detection, the focus
 * helpers' pure parts, and the repo itself passing (every screen with items can be focused).
 *
 *   npx -y tsx framework/spec/check-screen-focus.mts
 */
import { JSDOM } from 'jsdom';
import { drawsList, marksItems, ownFocus, hasViews, run } from '../cli/check-screen-focus.mjs';
import { focusActionId, focusKeyOf, wantedScreenFocus, askScreenFocus, settleScreenFocus, focusOnPage, isFoldToggle, FOCUS_HIT_CLASS } from '../core/screen-focus';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const G = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'HTMLElement', 'HTMLDetailsElement', 'Element', 'Node', 'Event', 'CustomEvent']) Object.defineProperty(G, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
G.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);

let n = 0; const failures: string[] = [];
const ok = (c: unknown, what: string) => { if (c) n += 1; else failures.push(what); };

ok(drawsList('{rows.map((r) => <li key={r.id}>{r.title}</li>)}'), 'a keyed map is a list');
ok(drawsList('{rows.map((r) => (\n  <Row key={r.id} r={r} />\n))}'), 'a keyed component map is a list');
ok(!drawsList('<div className="x">{title}</div>'), 'plain markup is not a list');
ok(marksItems('<li data-fx-focus-key={r.id}>'), 'data-fx-focus-key marks items');
ok(marksItems('<Container focusKey={g.id}>'), 'Container focusKey marks a group');
ok(!marksItems('<li key={r.id}>'), 'a React key alone is not a marker');
ok(ownFocus("rt.actions.register('plan-studio.focus', ([a]) => {})"), 'a literal <view>.focus registration counts');
ok(ownFocus('rt.actions.register(`${view}.focus`, ([a]) => {})'), 'a templated <view>.focus registration counts');
ok(hasViews('  views: { x: { title: "X" } },'), 'views: is a screen');
ok(focusActionId('ui-review') === 'ui-review.focus', 'focus action id');
ok(focusKeyOf('r-20261112-4ec56890') === 'r-20261112-4ec56890', 'plain key');
ok(focusKeyOf(encodeURIComponent('Pending builds ')) === 'Pending builds', 'encoded key decodes and trims');
ok(focusKeyOf('%E0%A4%A') === '%E0%A4%A', 'a broken encoding is kept as typed');
askScreenFocus('ui-review', 'r-1');
ok(wantedScreenFocus('ui-review') === 'r-1', 'the ask is kept for the screen');
ok(wantedScreenFocus('plan-studio') === '', 'another screen sees no ask');
ok(wantedScreenFocus('ui-review', Date.now() + 60_000) === '', 'an old ask expires');
settleScreenFocus('ui-review');
ok(wantedScreenFocus('ui-review') === '', 'a settled ask is gone');
// the generic focus on a drawn page (jsdom)
const doc = dom.window.document;
doc.body.innerHTML = `<main class="fx-main">
  <div role="tablist"><button role="tab" data-value="review" aria-selected="true">Review 3</button><button role="tab" data-value="shots" aria-selected="false">Screenshots (12)</button></div>
  <ul>
    <li data-fx-focus-key="r-20261112-4ec56890"><button class="x__hit" aria-expanded="false" data-fx-row>Toolbar pass</button><button class="fx-iconbtn" aria-haspopup="menu" aria-expanded="false">More</button></li>
    <li><span>Plan: Gizmo voice fix</span></li>
    <details data-fx-focus-key="g-1"><summary>Group</summary></details>
  </ul>
</main>`;
let clicked = '';
for (const b of Array.from(doc.querySelectorAll('button'))) b.addEventListener('click', () => { clicked += `${b.textContent};`; if (b.getAttribute('aria-expanded') === 'false') b.setAttribute('aria-expanded', 'true'); });
const item = await focusOnPage('r-20261112-4ec56890', { waitMs: 200 });
const row = doc.querySelector('[data-fx-focus-key="r-20261112-4ec56890"]')!;
ok(item === 'item', `a marked item is found (${item})`);
ok(row.classList.contains(FOCUS_HIT_CLASS), 'the item is highlighted');
ok(clicked === 'Toolbar pass;', `the fold toggle opened, the menu button didn't (${clicked})`);
const tab = await focusOnPage('Screenshots', { waitMs: 200 });
ok(tab === 'tab' && clicked.endsWith('Screenshots (12);'), `a tab by label (count dropped) is clicked (${tab})`);
ok(!row.classList.contains(FOCUS_HIT_CLASS), 'the previous highlight goes');
ok((await focusOnPage('g-1', { waitMs: 200 })) === 'item' && (doc.querySelector('details') as HTMLDetailsElement).open, 'a folded <details> opens');
ok((await focusOnPage('gizmo voice', { waitMs: 1_700 })) === 'text', 'a text match is the fallback');
ok((await focusOnPage('nothing-here', { waitMs: 300 })) === 'none', 'nothing found says so');
ok(!isFoldToggle(Object.assign(doc.createElement('button'), {})) , 'a bare button is not a fold toggle');

const repo = run();
ok(repo.findings.length === 0, `repo: ${repo.findings.map((f: { unit: string }) => f.unit).join(', ')}`);

if (failures.length) { console.error(`check-screen-focus.mts: ${failures.length} failed:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log(`check-screen-focus.mts: ${n} checks passed`);
