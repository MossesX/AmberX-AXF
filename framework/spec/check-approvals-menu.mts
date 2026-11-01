/**
 * Approve / Deny in the application menu's "Waiting for approval" list (Brett, Nov 1 2026).
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-approvals-menu.mts
 *
 * 1. lib-approvals' rows (`approvalMenuRows`): held calls first with a countdown deadline, every waiting item with
 *    Deny (red) then Approve (green), status rows without buttons.
 * 2. `installApprovalsMenu` on a real runtime: the app-menu engine passes the buttons through (gated), Approve on a
 *    held call = approve-now → `Running`, Deny → `Denied`, an opened page keeps the row, a refusal says why.
 * 3. The real AppMenu renderer in a DOM (jsdom): the buttons are on each row, a tap flips only that row in place
 *    (same element, other rows untouched, the list isn't reloaded), then the row drops off.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'matchMedia'] as const) {
  const v = (dom.window as unknown as Record<string, unknown>)[k];
  if (v !== undefined) Object.defineProperty(g, k, { value: typeof v === 'function' && !/^[A-Z]/.test(k) ? (v as (...a: unknown[]) => unknown).bind(dom.window) : v, configurable: true, writable: true });
}
(dom.window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
g.matchMedia = (dom.window as unknown as { matchMedia: unknown }).matchMedia;
g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
g.React = React; // tsx compiles the framework's .tsx with the classic JSX runtime here
const { createElement: h, act } = React;
const { createRoot } = await import('react-dom/client');
const { AxfRuntime } = await import('../core/runtime.ts');
const { AxfProvider } = await import('../react/AxfProvider.tsx');
const { AppMenuList, LIVE_ROW_DROP_MS } = await import('../react/components/AppMenu.tsx');
const { interpretApprovals } = await import('../libs/approvals/core.ts');
const { approvalMenuRows, decisionButtons, installApprovalsMenu, rowResult } = await import('../libs/approvals/menu.ts');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** How long the fake hub takes to answer (long enough to see the busy state). */
const DECIDE_MS = 150;

const HUB = 'https://axhub.amberxai.com';
const T = Date.now();
const A1 = '11111111-1111-4111-8111-111111111111';
const H1 = '33333333-3333-4333-8333-333333333333';
const H2 = '44444444-4444-4444-8444-444444444444';
const approval = (id: string, over: Record<string, unknown> = {}) => ({ id, tool: 'vps.run', summary: 'vps.run with arguments {"command":"docker ps"}', createdAt: new Date(T - 60_000).toISOString(), expiresAt: new Date(T + 900_000).toISOString(), url: `${HUB}/auth/admin/approvals/${id}`, title: 'List the containers', ...over });
const held = (id: string, left: number, over: Record<string, unknown> = {}) => ({ ...approval(id), status: 'held', title: 'Restart the console with a very long title that has to be cut before the buttons ever are', veto: { runsAt: new Date(T + left * 1000).toISOString(), secondsLeft: left, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'], ...over }, jobId: 'job-1' });
const body = JSON.stringify({ signedIn: true, admin: true, count: 1, pending: [held(H1, 80), held(H2, 40), approval(A1)] });
const st = interpretApprovals(HUB, 200, body, T);

/* ---------------------------------------------------------------- 1. rows */
{
  const rows = approvalMenuRows(st);
  check(rows.map((r) => r.id).join(',') === `approval-${H2},approval-${H1},approval-${A1}`, 'held calls first (soonest), then approvals');
  const [h2, , a1] = rows;
  check(h2!.buttons?.map((b) => `${b.id}:${b.tone}`).join(',') === 'deny:danger,approve:success', 'held row: red Deny then green Approve');
  check(a1!.buttons?.map((b) => `${b.id}:${b.tone}`).join(',') === 'decline:danger,approve:success', 'approval row: red Deny (decline) then green Approve');
  check(a1!.buttons?.[0]?.label === 'Deny' && a1!.buttons?.[1]?.label === 'Approve', 'both read Deny / Approve');
  check(typeof h2!.deadline === 'number' && Math.abs(h2!.deadline! - (T + 40_000)) < 1500, 'held row counts down to its run time');
  check(a1!.deadline === undefined, 'an approval has no countdown');
  check(h2!.action === `hub.review:${H2}` && h2!.detail === 'docker ps', 'row tap reviews it; command under the title');
  const shelved = approvalMenuRows(interpretApprovals(HUB, 200, JSON.stringify({ pending: [held(H1, 50, { state: 'shelved' })] }), T))[0]!;
  check(shelved.paused === 'Shelved' && shelved.icon === 'pause', 'a shelved call reads Shelved, no countdown');
  const denyOnly = decisionButtons({ kind: 'held', decisions: ['deny'] });
  check(denyOnly.length === 1 && denyOnly[0]!.id === 'deny', 'a hub without approve-now: Deny only');
  check(approvalMenuRows({ ...st, status: 'signed-out' })[0]!.buttons === undefined, 'status rows carry no buttons');
  check(approvalMenuRows({ ...st, items: [] })[0]!.label === 'Nothing waiting', 'nothing waiting');
  check(rowResult(st.items[0]!, 'approve', { ok: true, message: '' }).state === 'Running', 'approve on a held call → Running');
  check(rowResult(st.items[2]!, 'approve', { ok: true, message: '' }).state === 'Approved', 'approve on an approval → Approved');
  check(rowResult(st.items[2]!, 'decline', { ok: true, message: '' }).state === 'Denied', 'deny → Denied');
  check(rowResult(st.items[2]!, 'approve', { ok: true, opened: true, message: '' }).keep === true, 'opened on the hub: the row stays');
  check(rowResult(st.items[2]!, 'approve', { ok: false, message: 'Changed, reload.' }).message === 'Changed, reload.', "a refusal says the hub's words");
}

/* ---------------------------------------------------------------- 2. provider + engine + runtime */
const root = new URL('../', import.meta.url).pathname;
const assets = readdirSync(join(root, 'assets')).flatMap((t) => readdirSync(join(root, 'assets', t)).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(root, 'assets', t, n), 'utf8'))));
const defaults = JSON.parse(readFileSync(join(root, 'defaults.json'), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:approvals-menu' });
const decided: string[] = [];
let answer: (d: string) => { ok: boolean; message: string; opened?: boolean } = () => ({ ok: true, message: '' });
let reads = 0;
installApprovalsMenu(rt, {
  hub: HUB,
  read: async () => { reads++; return st; },
  decide: async (item, d) => { decided.push(`${item.id}:${d}`); await sleep(DECIDE_MS); return answer(d); },
});
{
  const items = await rt.loadAppMenuProvider('hub.approvals');
  check(items.length === 3 && items.every((i) => i.buttons?.length === 2 && i.buttons.every((b) => !b.locked)), 'compiled rows keep their two buttons');
  check(items[0]!.origin === 'provider:hub.approvals' && typeof items[0]!.deadline === 'number' && !!items[0]!.detail, 'origin, deadline and detail pass through');
  const approveNow = await rt.runAppMenuButton('hub.approvals', `approval-${H2}`, { id: 'approve' });
  check(approveNow.ok && approveNow.state === 'Running' && decided.at(-1) === `${H2}:approve`, 'Approve on a held call: approve (run now) → Running');
  const deny = await rt.runAppMenuButton('hub.approvals', `approval-${H1}`, { id: 'deny' });
  check(deny.ok && deny.state === 'Denied' && decided.at(-1) === `${H1}:deny`, 'Deny on a held call → Denied');
  const again = await rt.runAppMenuButton('hub.approvals', `approval-${H1}`, { id: 'deny' });
  check(!again.ok && decided.length === 2, 'a decided row is not sent twice');
  const wrong = await rt.runAppMenuButton('hub.approvals', `approval-${A1}`, { id: 'deny' });
  check(!wrong.ok && /doesn't offer/.test(wrong.message ?? ''), 'a decision the hub does not offer is refused here');
  answer = () => ({ ok: true, opened: true, message: '' });
  const opened = await rt.runAppMenuButton('hub.approvals', `approval-${A1}`, { id: 'approve' });
  check(opened.ok && opened.keep === true, 'opened on the hub: the row stays');
  answer = () => ({ ok: false, message: 'Sign in to axHub to decide.' });
  const refused = await rt.runAppMenuButton('hub.approvals', `approval-${A1}`, { id: 'decline' });
  check(!refused.ok && refused.message === 'Sign in to axHub to decide.', 'a refusal comes back with its words');
  // gating: a hidden button is dropped, a disabled one locked
  rt.registerAppMenuProvider('gated', { items: () => [{ id: 'r', label: 'R', buttons: [{ id: 'a', label: 'A', requires: 'nobody.has.this' }, { id: 'b', label: 'B' }] }] });
  const gated = (await rt.loadAppMenuProvider('gated'))[0]!;
  check(gated.buttons?.length === 2 ? gated.buttons[0]!.locked : gated.buttons?.length === 1, 'gated buttons follow UAC (hide drops, disable locks)');
  // a provider without act: the button's action is dispatched
  let ran = '';
  rt.actions.register('t.run', ([x]) => { ran = x ?? ''; }, { label: 't', params: true });
  rt.registerAppMenuProvider('plain', { items: () => [{ id: 'p', label: 'P', buttons: [{ id: 'go', label: 'Go', action: 't.run:yes' }] }] });
  check((await rt.runAppMenuButton('plain', 'p', { id: 'go', action: 't.run:yes' })).ok && ran === 'yes', 'no act: the button action runs');
}

/* ---------------------------------------------------------------- 3. the real renderer, in a DOM */
{
  decided.length = 0;
  answer = () => ({ ok: true, message: '' });
  reads = 0;
  const items = await rt.loadAppMenuProvider('hub.approvals');
  check(reads === 1, 'one read to fill the list');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  let done = 0;
  await act(async () => { r.render(h(AxfProvider, { runtime: rt }, h(AppMenuList, { items, depth: 2, onDone: () => { done++; } }))); });
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-axf-live-row="approval-${id}"]`);
  const btn = (id: string, b: string) => row(id)?.querySelector<HTMLButtonElement>(`[data-axf-row-button="${b}"]`) ?? null;
  check(!!row(H1) && !!row(H2) && !!row(A1), 'every waiting item is a row');
  for (const id of [H1, H2, A1]) {
    const deny = btn(id, id === A1 ? 'decline' : 'deny');
    const approve = btn(id, 'approve');
    check(deny?.classList.contains('fx-btn--danger') && deny.textContent === 'Deny', `row ${id.slice(0, 4)}: red Deny (framework Button)`);
    check(approve?.classList.contains('fx-btn--success') && approve.textContent === 'Approve', `row ${id.slice(0, 4)}: green Approve (framework Button)`);
    check(deny!.compareDocumentPosition(approve!) & 4, `row ${id.slice(0, 4)}: Deny left of Approve`);
  }
  const timer = row(H2)?.querySelector('[role="timer"]');
  check(timer && /^0:(39|40)$/.test(timer.textContent ?? ''), 'held row shows its live countdown');
  check(!row(A1)?.querySelector('[role="timer"]'), 'approval row has no countdown');
  check(row(H1)?.querySelector('.fx-menu__live-label') && row(H1)?.querySelector('.fx-menu__acts'), 'label (cuts first) and the buttons in their own box');

  // Approve on H2: busy, then Running in place; same element; others untouched; menu stays open; no reload.
  const h2Before = row(H2);
  const h1Before = row(H1);
  const h1Html = h1Before!.outerHTML;
  await act(async () => { btn(H2, 'approve')!.click(); });
  check(btn(H2, 'approve')?.getAttribute('aria-busy') === 'true' && btn(H2, 'deny')?.disabled, 'Approve: busy, the other button waits');
  await act(async () => { await sleep(DECIDE_MS + 50); });
  check(decided.join() === `${H2}:approve`, 'Approve sent the approve (run now) decision');
  check(row(H2) === h2Before, 'the row flipped in place (same element, not re-rendered)');
  check(row(H2)?.dataset.axfRowState === 'Running' && row(H2)?.querySelector('[role="status"]')?.textContent === 'Running', 'held row reads Running');
  check(row(H1) === h1Before && row(H1)!.outerHTML.replace(/0:\d\d/g, '') === h1Html.replace(/0:\d\d/g, ''), 'the other rows are untouched');
  check(done === 0 && reads === 1, 'the menu stays open and the list is not reloaded');

  // Deny on A1 (an approval: decline) while H2 still shows Running.
  await act(async () => { btn(A1, 'decline')!.click(); await sleep(DECIDE_MS + 50); });
  check(decided.at(-1) === `${A1}:decline`, 'Deny sent the decline decision');
  check(row(A1)?.dataset.axfRowState === 'Denied', 'approval row reads Denied in place');

  // Then each drops off; H1 stays with its buttons.
  await act(async () => { await sleep(LIVE_ROW_DROP_MS + 60); });
  check(!row(H2) && !row(A1), 'decided rows drop off');
  check(row(H1) === h1Before && !!btn(H1, 'deny') && !!btn(H1, 'approve'), 'the waiting row stays, same element, buttons ready');

  // A failure: buttons come back, no flip.
  answer = () => ({ ok: false, message: 'The hub refused.' });
  await act(async () => { btn(H1, 'deny')!.click(); await sleep(DECIDE_MS + 50); });
  check(!row(H1)?.dataset.axfRowState && !!btn(H1, 'deny') && !btn(H1, 'deny')!.disabled, 'a refusal puts the buttons back');
  check(rt.getState().toasts.some((t) => t.message === 'The hub refused.' && t.kind === 'danger'), 'and says why (a toast)');

  // Last one decided → the list says Nothing waiting.
  answer = () => ({ ok: true, message: '' });
  await act(async () => { btn(H1, 'deny')!.click(); await sleep(DECIDE_MS + 50); });
  await act(async () => { await sleep(LIVE_ROW_DROP_MS + 60); });
  check(!row(H1) && /Nothing waiting/.test(host.textContent ?? ''), 'all decided: Nothing waiting');
  await act(async () => { r.unmount(); });
}

console.log(`approvals menu: ${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
process.exit(0);
