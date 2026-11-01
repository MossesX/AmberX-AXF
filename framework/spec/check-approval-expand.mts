/**
 * Expandable approval rows (Brett, Nov 1 2026): every approval row opens in place with the real details.
 *
 *   cd framework && npm install && cd .. && npx -y tsx framework/spec/check-approval-expand.mts
 *
 * 1. details.ts: one model from a feed item and from the hub's API entry (who asked, tool + policy + risk, timeline,
 *    result), the open-row store.
 * 2. The shared row in a DOM (jsdom): collapsed by default with the caret on the far right; a tap on the row or the
 *    caret opens it in place; a live refresh (new details, a re-render, a remount) keeps it open in the same element;
 *    Deny / Approve inside work while it waits and are gone once decided; the job stream fills the output.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://console.example.test/', pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'matchMedia'] as const) {
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
const { interpretApprovals } = await import('../libs/approvals/core.ts');
const {
  ApprovalsOpenStore, approvalsOpenStore, argumentsOf, clientLine, collapsedLine, detailsOfHubEntry, detailsOfItem, exitLine, formatDuration, hasResult,
  isWaitingPhase, riskTags, sourceOf, tailLines, timelineOf,
} = await import('../libs/approvals/details.ts');
const { ApprovalRow } = await import('../libs/approvals/row.tsx');
const { readFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HUB = 'https://axhub.amberxai.com';
const T = Date.now();
const A1 = '11111111-1111-4111-8111-111111111111';
const H1 = '33333333-3333-4333-8333-333333333333';
const R1 = '55555555-5555-4555-8555-555555555555';
const src = { kind: 'headless', session: 'approval-expand', client: 'claude-code', clientVersion: '2.1.4', oauthClient: 'Claude' };
const approval = (id: string, over: Record<string, unknown> = {}) => ({
  id, tool: 'vps.run', summary: 'vps.run with arguments {"command":"docker restart axf-console"}', createdAt: new Date(T - 60_000).toISOString(),
  expiresAt: new Date(T + 900_000).toISOString(), url: `${HUB}/auth/admin/approvals/${id}`, reason: { title: 'Restart the console', description: 'It hangs after the deploy; a restart brings it back.' },
  source: src, effect: 'changes', ...over,
});
const held = (id: string, left: number) => ({ ...approval(id), status: 'held', veto: { runsAt: new Date(T + left * 1000).toISOString(), secondsLeft: left, countdownSeconds: 90, actions: ['deny', 'approve-now', 'shelve'] }, jobId: 'job-1' });

/* ---------------------------------------------------------------- 1. the model */
{
  check(sourceOf({ source: src })?.session === 'approval-expand', 'source read');
  check(sourceOf({ source: { kind: 'nope', session: 'bad name!' } })?.kind === 'unknown' && sourceOf({ source: { kind: 'nope', session: 'bad name!' } })?.session === undefined, 'unknown kind + bad session name dropped');
  check(sourceOf({}) === null, 'no source = null (older hub)');
  check(sourceOf({ caller: { source: { kind: 'console' } } })?.kind === 'console', 'caller.source read too');
  check(clientLine(sourceOf({ source: src })) === 'claude-code 2.1.4 · OAuth: Claude', 'client line');
  check(argumentsOf('vps.run with arguments {"command":"ls"}') === '{\n  "command": "ls"\n}', 'arguments pretty-printed');
  check(argumentsOf('odd') === 'odd', 'not JSON: as is');
  check(riskTags('destructive', 'sudo rm -rf /tmp/x').join() === 'destructive,deletes,root / permissions', 'risk words');
  check(riskTags('read-only', 'docker ps').join() === 'read-only,containers', 'read-only risk');
  check(riskTags(undefined, '', ['Network']).join() === 'network', "the hub's own risk list first");

  const st = interpretApprovals(HUB, 200, JSON.stringify({ signedIn: true, admin: true, count: 2, pending: [held(H1, 80), approval(A1, { actions: ['approve', 'decline'] })] }), T);
  const dh = detailsOfItem(st.items[0]!);
  const da = detailsOfItem(st.items[1]!);
  check(dh.kind === 'held' && dh.policy === 'veto' && dh.phase === 'held', 'held = veto policy');
  check(da.kind === 'approval' && da.policy === 'confirm' && da.phase === 'pending', 'approval = confirm policy');
  check(da.title === 'Restart the console' && da.description.startsWith('It hangs'), 'reason title + description');
  check(da.command === 'docker restart axf-console' && da.arguments.includes('"command"'), 'command + arguments');
  check(da.source?.kind === 'headless' && da.source.session === 'approval-expand', 'who asked from the feed entry');
  check(dh.source?.kind === 'headless', 'who asked on a held call too');
  check(da.risk.includes('changes things') && da.risk.includes('containers'), 'risk from effect + command');
  check(dh.decisions.join() === 'deny,approve' && da.decisions.join() === 'approve,decline', 'decisions');
  check(isWaitingPhase(dh.phase) && isWaitingPhase(da.phase), 'both wait');
  check(!hasResult(da), 'no result before it runs');
  const tl = timelineOf(dh, T).map((t) => t.id);
  check(tl.includes('requested') && tl.includes('countdown'), 'held timeline: requested + countdown');
  check(timelineOf(da, T).map((t) => t.id).join() === 'requested,expires', 'approval timeline: requested + expires');
  check(collapsedLine(dh, T).includes('approval-expand') && collapsedLine(dh, T).includes('runs in 1:20'), 'collapsed line: who + countdown');

  // An entry as the hub's approvals API shapes it (axHub web app grid), after it ran.
  const ran = detailsOfHubEntry(HUB, {
    id: R1, tool: 'vps.run', summary: 'vps.run with arguments {"command":"uptime"}', title: 'Check uptime', reasonGiven: true, description: 'Just looking.', effect: 'read-only',
    code: { service: 'vps', tool: 'run', qualified: 'vps.run', arguments: '{\n  "command": "uptime"\n}', command: 'uptime' }, status: 'used', actions: [], revision: 3,
    callerId: 'claude-code', createdAt: new Date(T - 300_000).toISOString(), expiresAt: new Date(T + 600_000).toISOString(), decidedBy: 'brett',
    veto: { state: 'ran', runsAt: new Date(T - 200_000).toISOString(), secondsLeft: 0, countdownSeconds: 90, startedAt: new Date(T - 200_000).toISOString(), finishedAt: new Date(T - 197_500).toISOString(), exitCode: 0, actions: [] },
    jobId: 'job-9', source: { kind: 'claude_ai', client: 'claude.ai' },
    history: [{ at: new Date(T - 200_000).toISOString(), from: 'held', to: 'approved', by: 'vinnie' }],
  }, T)!;
  check(ran.phase === 'ran' && ran.kind === 'approval' && ran.policy === 'veto', 'a veto call that ran');
  check(ran.exitCode === 0 && exitLine(ran) === 'Exit 0' && hasResult(ran), 'exit code');
  check(ran.decidedBy === 'brett' && !!ran.decidedAt, 'decided by + at (from history)');
  check(ran.streamUrl === `${HUB}/auth/api/jobs/job-9/stream`, 'stream url rebuilt from the job id');
  check(ran.decisions.length === 0 && !isWaitingPhase(ran.phase), 'nothing to decide once it ran');
  const rtl = timelineOf(ran, T);
  check(rtl.map((t) => t.id).join() === 'requested,decided,ran,finished,duration' && rtl.at(-1)!.text === '3 s', 'ran timeline with duration');
  check(detailsOfHubEntry(HUB, { id: 'not-an-id' }) === null, 'bad id refused');
  check(exitLine({ phase: 'failed', exitCode: 2 }) === 'Exit 2 (failed)' && exitLine({ phase: 'running', exitCode: undefined }) === 'Running…', 'exit words');
  check(formatDuration(65_000) === '1 min 5 s' && formatDuration(3_660_000) === '1 h 1 min', 'durations');
  check(tailLines('a\nb\nc\n\n', 2).join() === 'b,c', 'last lines, blank tail dropped');

  const s = new ApprovalsOpenStore(null);
  let told = 0;
  s.subscribe(() => { told++; });
  check(!s.isOpen('x', A1), 'closed by default');
  s.toggle('x', A1);
  check(s.isOpen('x', A1) && !s.isOpen('y', A1) && told === 1, 'open per surface');
  s.set('x', A1, true);
  check(told === 1, 'no change, no news');
}

/* ---------------------------------------------------------------- 2. the row in a DOM */
const assetsDir = new URL('../assets/', import.meta.url).pathname;
const assets = readdirSync(assetsDir).flatMap((t) => readdirSync(join(assetsDir, t)).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(join(assetsDir, t, x), 'utf8'))));
const defaults = JSON.parse(readFileSync(new URL('../defaults.json', import.meta.url), 'utf8'));
const rt = new AxfRuntime({ manifest: { app: { id: 'expand-test', name: 'Test' }, defaults } as never, assets, storageKey: 'test:expand' });

// The job stream: a fake fetch answering SSE (the hub replays output to late watchers).
const sse = 'event: output\ndata: {"stream":"stdout","text":"line 1\\nline 2\\n"}\n\nevent: done\ndata: {"state":"ran","exitCode":0}\n\n';
g.fetch = async (u: string) => {
  if (String(u).endsWith('/stream')) return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  return new Response('{}', { status: 404 });
};

const host = document.createElement('div');
document.body.appendChild(host);
const root = createRoot(host);
const decided: string[] = [];
const scope = 'test';
const st0 = interpretApprovals(HUB, 200, JSON.stringify({ signedIn: true, admin: true, count: 2, pending: [held(H1, 80), approval(A1)] }), T);
const rows = (st: typeof st0, extra: Record<string, unknown> = {}) => h(AxfProvider, { runtime: rt },
  h('div', null, st.items.map((it) => h(ApprovalRow, { key: it.id, scope, details: detailsOfItem(it), hub: HUB, onDecide: (d: string) => decided.push(`${it.id}:${d}`), ...extra }))));
await act(async () => { root.render(rows(st0)); });

const rowEl = (id: string) => host.querySelector(`[data-approval-id="${id}"]`) as HTMLElement | null;
const click = async (el: Element | null | undefined) => { await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
{
  const r = rowEl(A1)!;
  check(!!r && !r.querySelector('.axf-apx__body'), 'collapsed by default');
  const head = r.querySelector('.axf-apx__head')!;
  check(head.lastElementChild?.classList.contains('axf-apx__caret'), 'caret is the last thing on the row (far right)');
  check(r.querySelector('.axf-apx__src')?.textContent === 'Headless', 'source badge on the collapsed row');
  check(r.querySelector('.axf-apx__title')?.textContent === 'Restart the console', 'reason title first');

  await click(r.querySelector('.axf-apx__sum'));
  check(!!rowEl(A1)!.querySelector('.axf-apx__body'), 'a tap on the row opens it');
  check(rowEl(A1) === r, 'in place: the same element (no navigation, no remount)');
  const body = r.querySelector('.axf-apx__body')!;
  check(body.textContent!.includes('It hangs after the deploy'), 'full description inside');
  check(body.querySelector('pre[aria-label="Command"]')?.textContent === 'docker restart axf-console', 'exact command, monospace');
  check(!!body.querySelector('pre[aria-label="Arguments"]'), 'arguments');
  check([...body.querySelectorAll('button')].some((b) => b.textContent === 'Copy command'), 'copy button');
  check(body.textContent!.includes('approval-expand') && body.textContent!.includes('claude-code 2.1.4'), 'who asked: name + client');
  check(body.textContent!.includes('Confirm (waits for approval)'), 'policy');
  check(body.textContent!.includes('Requested') && body.textContent!.includes('Expires'), 'timeline');
  check(!!body.querySelector('a.axf-apx__link[href="' + `${HUB}/auth/admin/approvals/${A1}` + '"]'), 'link to the full approval page');
  check(!rowEl(H1)!.querySelector('.axf-apx__body'), 'other rows stay folded');

  // Buttons inside: Deny (red) first, Approve (green).
  const btns = [...body.querySelectorAll('.axf-apx__decide button')] as HTMLButtonElement[];
  check(btns.map((b) => `${b.textContent}:${b.className.includes('fx-btn--danger') ? 'red' : b.className.includes('fx-btn--success') ? 'green' : '?'}`).join() === 'Deny:red,Approve:green', 'Deny red + Approve green inside');
  await click(btns[1]);
  await click(btns[0]);
  check(decided.join() === `${A1}:approve,${A1}:decline`, 'the buttons inside decide');

  // A live refresh: a new read (new objects, a later clock) keeps it open, in the same element.
  const bodyEl = r.querySelector('.axf-apx__body');
  const st1 = interpretApprovals(HUB, 200, JSON.stringify({ signedIn: true, admin: true, count: 2, pending: [held(H1, 70), approval(A1, { reason: { title: 'Restart the console now', description: 'Still hanging.' } })] }), T + 10_000);
  await act(async () => { root.render(rows(st1)); });
  check(rowEl(A1) === r && r.querySelector('.axf-apx__body') === bodyEl, 'refresh: stays open, same elements (no flicker)');
  check(r.querySelector('.axf-apx__title')?.textContent === 'Restart the console now' && bodyEl!.textContent!.includes('Still hanging.'), 'refresh: updated in place');

  // Even a remount of the whole list (a surface that re-mounts on refresh) keeps it open.
  await act(async () => { root.render(h('div', null)); });
  await act(async () => { root.render(rows(st1)); });
  check(!!rowEl(A1)!.querySelector('.axf-apx__body'), 'remount: still open');
  check(approvalsOpenStore.isOpen(scope, A1), 'kept in the open-row store');

  // Decided: the buttons inside go, the details stay.
  const decidedEntry = detailsOfHubEntry(HUB, { ...approval(A1), status: 'approved', actions: [], decidedBy: 'brett' }, T)!;
  await act(async () => { root.render(h(AxfProvider, { runtime: rt }, h('div', null, h(ApprovalRow, { key: A1, scope, details: decidedEntry, onDecide: () => decided.push('late') })))); });
  check(!rowEl(A1)!.querySelector('.axf-apx__decide') && !!rowEl(A1)!.querySelector('.axf-apx__body'), 'decided: no buttons inside, still open');

  // The caret folds it again.
  await click(rowEl(A1)!.querySelector('.axf-apx__caret'));
  check(!rowEl(A1)!.querySelector('.axf-apx__body') && rowEl(A1)!.querySelector('.axf-apx__caret')?.getAttribute('aria-expanded') === 'false', 'the caret folds it');
  await click(rowEl(A1)!.querySelector('.axf-apx__caret'));
  check(!!rowEl(A1)!.querySelector('.axf-apx__body'), 'the caret opens it');
}
{
  // A call that ran: exit code + the last lines from the job stream, while open.
  const ran = detailsOfHubEntry(HUB, { ...approval(R1), status: 'used', actions: [], veto: { state: 'ran', runsAt: new Date(T - 5_000).toISOString(), secondsLeft: 0, startedAt: new Date(T - 5_000).toISOString(), finishedAt: new Date(T - 4_000).toISOString(), exitCode: 0 }, jobId: 'job-9' }, T)!;
  approvalsOpenStore.set(scope, R1, true);
  await act(async () => { root.render(h(AxfProvider, { runtime: rt }, h(ApprovalRow, { key: R1, scope, details: ran, hub: HUB }))); });
  await act(async () => { await sleep(50); });
  const r = rowEl(R1)!;
  check(r.querySelector('.axf-apx__exit')?.textContent === 'Exit 0', 'result: exit code');
  check(r.querySelector('pre[aria-label="Last lines of output"]')?.textContent === 'line 1\nline 2', 'result: last lines of output');
}

await act(async () => { root.unmount(); });
console.log(`approval rows: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
