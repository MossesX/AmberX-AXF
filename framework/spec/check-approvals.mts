/**
 * lib-approvals self-test: one list from the approvals feed (approvals + held calls), words and times, deciding rules,
 * the watcher. No network: every reply is hand-written.
 *
 *   npx -y tsx framework/spec/check-approvals.mts
 */
import { ApprovalsWatcher, clampPoll, fetchApprovals } from '../libs/approvals/index.ts';
import {
  allowed, badgeLabel, badgeText, canDecideHere, countdownOf, decideOnHub, decisionUrl, decisionsOf,
  formatAge, freshIds, goneIds, goneMessage, interpretApprovals, isUrgent, itemLine, ageSeconds, commandOfSummary,
} from '../libs/approvals/core.ts';

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const HUB = 'https://axhub.amberxai.com';
const T = Date.parse('2026-10-28T23:30:00.000Z');
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const H1 = '33333333-3333-4333-8333-333333333333';
const url = (id: string) => `${HUB}/auth/admin/approvals/${id}`;
const approval = (id: string, over: Record<string, unknown> = {}) => ({ id, tool: 'vps.run', summary: 'vps.run with arguments {"command":"docker ps"}', createdAt: '2026-10-28T23:27:00.000Z', expiresAt: '2026-10-28T23:45:00.000Z', url: url(id), ...over });
const held = (id: string, left = 150) => ({ ...approval(id), status: 'held', title: 'Restart the console', veto: { runsAt: new Date(T + left * 1000).toISOString(), secondsLeft: left, countdownSeconds: 180 }, jobId: 'job-1' });
const body = (pending: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ signedIn: true, admin: true, count: pending.length, pending, ...extra });

// status mapping (lib-hub's)
check(interpretApprovals(HUB, 401, '', T).status === 'signed-out', '401 = signed out');
check(interpretApprovals(HUB, 403, '', T).status === 'not-admin', '403 = not admin');
check(interpretApprovals(HUB, 500, '', T).status === 'unreachable', '500 = unreachable');
check(interpretApprovals(HUB, 200, 'nope', T).status === 'unreachable', 'bad JSON = unreachable');
check(interpretApprovals(HUB, 401, '', T).checkedAt === T, 'an answer is timed even when it is an error');
check(badgeText(interpretApprovals(HUB, 401, '', T), T) === '', 'signed out draws nothing');

// one list: held first, then approvals
const st = interpretApprovals(HUB, 200, body([approval(A1, { reason: { title: 'List containers', description: 'Checks what runs.' }, actions: ['approve', 'decline', 'postpone'], revision: 4 }), approval(A2), held(H1)]), T);
check(st.status === 'ok', 'ok');
check(st.items.length === 3 && st.count === 3, 'three items, count 3');
check(st.items[0]!.kind === 'held' && st.items[0]!.id === H1, 'held calls come first');
check(st.items[0]!.decisions.join() === 'deny', 'a held call can only be denied');
check(!allowed(st.items[0]!, 'approve'), 'a held call never offers Approve');
check(st.items[1]!.title === 'List containers' && st.items[1]!.description === 'Checks what runs.', "the caller's reason is the title and description");
check(st.items[1]!.revision === 4, 'the revision is kept');
check(st.items[1]!.decisions.join() === 'approve,decline', 'approve/decline from the hub actions (postpone left to the hub page)');
check(st.items[2]!.title === 'Run vps.run', 'no reason: "Run <tool>"');
check(st.items[2]!.decisions.join() === 'approve,decline', 'no actions list: approve + decline');
check(st.items[2]!.command === 'docker ps', 'the command comes out of the summary');
check(st.items.every((i) => i.url.startsWith(`${HUB}/auth/admin/approvals/`)), 'links are rebuilt on the hub');
check(decisionsOf(['decline']).join() === 'decline', 'only what the hub lists');
check(commandOfSummary('x {"command":"echo \\"hi\\""}') === 'echo "hi"', 'escaped quotes in the command');

// what is thrown away
check(interpretApprovals(HUB, 200, body([approval(A1, { url: 'https://evil.example/x' })]), T).items.length === 0, 'a link off the hub is dropped');
check(interpretApprovals(HUB, 200, body([approval('not-an-id')]), T).items.length === 0, 'a bad id is dropped');
check(interpretApprovals(HUB, 200, body([approval(A1, { reason: { title: 'a\nb\u0007c' } })]), T).items[0]!.title === 'a b c', 'control characters leave the title');
check(interpretApprovals(HUB, 200, body([approval(A1, { title: 'x'.repeat(500) })]), T).items[0]!.title.length === 200, 'titles are capped');

// count from the hub
check(interpretApprovals(HUB, 200, JSON.stringify({ count: 30, pending: [approval(A1)] }), T).count === 30, "the hub's count when bigger");

// words and times
check(formatAge(12) === '12 s' && formatAge(180) === '3 min' && formatAge(7300) === '2 h' && formatAge(200_000) === '2 d', 'ages');
check(ageSeconds('2026-10-28T23:27:00.000Z', T) === 180, 'age from createdAt');
check(ageSeconds('', T) === 0 && ageSeconds('2030-01-01T00:00:00Z', T) === 0, 'missing or future = 0');
check(itemLine(st.items[2]!, T) === 'vps.run · 3 min ago', 'approval line');
check(itemLine(st.items[0]!, T) === 'Runs in 2:30', 'held line counts down');
check(itemLine(st.items[0]!, T + 200_000) === 'Running', 'held line at zero');
check(countdownOf(st.items[0]!, T + 10_000) === 140, 'countdown on the local clock');
check(countdownOf(st.items[1]!, T) === null, 'approvals have no countdown');
check(badgeText(st, T) === '3 waiting', 'badge words');
check(badgeText(interpretApprovals(HUB, 200, body([held(H1)]), T), T) === '1 held · 2:30', 'only held: countdown in the badge words');
check(badgeText(interpretApprovals(HUB, 200, body([]), T), T) === '', 'nothing waiting draws nothing');
check(badgeLabel(st) === '2 approvals waiting, 1 held command counting down on axHub', 'badge label');
check(!isUrgent(st, T) && isUrgent(st, T + 125_000), 'urgent at 30 s or less');

// new and gone
check(freshIds([A1], st.items).sort().join() === [A2, H1].sort().join(), 'fresh ids');
check(goneIds([A1, 'old'], st.items).join() === 'old', 'gone ids');
check(goneMessage({ kind: 'held', title: 'X' }).includes('no longer held') && goneMessage({ kind: 'approval', title: 'X' }).includes('decided'), 'gone toasts');

// deciding rules
check(canDecideHere(HUB, HUB) && canDecideHere(HUB, `${HUB}/x`), 'the hub origin can decide');
check(!canDecideHere(HUB, 'https://console.amberxai.com') && !canDecideHere(HUB, undefined), 'other origins cannot');
check(decisionUrl(HUB, A1) === `${HUB}/auth/api/approvals/${A1}` && decisionUrl(HUB, '../x') === null, 'decide route');
check(clampPoll(10) === 2000 && clampPoll(1e9) === 300_000 && clampPoll(undefined) === 5000, 'poll period clamped');

type Call = { url: string; init: RequestInit };
const fake = (replies: Record<string, { status: number; json?: unknown; text?: string }>) => {
  const calls: Call[] = [];
  const f = async (u: string, init: RequestInit) => {
    calls.push({ url: u, init });
    const key = Object.keys(replies).find((k) => u.endsWith(k));
    const r = key ? replies[key]! : { status: 404, json: {} };
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { f, calls };
};

{
  const { f, calls } = fake({ '/auth/api/session': { status: 200, json: { csrf: 'tok' } }, [`/auth/api/approvals/${A1}`]: { status: 200, json: { message: 'Approved.' } } });
  const r = await decideOnHub(HUB, st.items[1]!, 'approve', { fetch: f, origin: HUB });
  check(r.ok && r.message === 'Approved.', 'approve from the hub origin');
  const post = calls.find((c) => c.init.method === 'POST')!;
  check(post && JSON.parse(String(post.init.body)).action === 'approve' && JSON.parse(String(post.init.body)).rev === 4, 'POST {action, rev}');
  check((post.init.headers as Record<string, string>)['X-AxHub-CSRF'] === 'tok', 'with the CSRF value');
  check(post.init.redirect === 'error' && post.init.credentials === 'include', 'own session, no redirects');
}
{
  const { f, calls } = fake({});
  const r = await decideOnHub(HUB, st.items[1]!, 'approve', { fetch: f, origin: 'https://console.amberxai.com' });
  check(!r.ok && calls.length === 0, 'another origin sends nothing');
  const h = await decideOnHub(HUB, st.items[0]!, 'approve', { fetch: f, origin: HUB });
  check(!h.ok && h.message.includes('only be denied') && calls.length === 0, 'Approve on a held call is refused before any call');
}
{
  const { f } = fake({ '/auth/api/session': { status: 200, json: { csrf: 'tok' } }, [`/auth/api/approvals/${H1}/deny`]: { status: 200, json: { state: 'denied' } } });
  const r = await decideOnHub(HUB, st.items[0]!, 'deny', { fetch: f, origin: HUB });
  check(r.ok && r.message.startsWith('Denied'), 'deny a held call (veto@1)');
}
{
  const { f } = fake({ '/auth/api/session': { status: 200, json: {} } });
  check(!(await decideOnHub(HUB, st.items[1]!, 'decline', { fetch: f, origin: HUB })).ok, 'no CSRF = sign in');
  const { f: f2 } = fake({ '/auth/api/session': { status: 200, json: { csrf: 't' } }, [`/auth/api/approvals/${A1}`]: { status: 409, json: { error: { message: 'Changed, reload.' } } } });
  check((await decideOnHub(HUB, st.items[1]!, 'decline', { fetch: f2, origin: HUB })).message === 'Changed, reload.', "the hub's error words");
}

// the feed read + the watcher
{
  const { f, calls } = fake({ '/auth/admin/approvals.json': { status: 200, text: body([approval(A1)]) } });
  const s1 = await fetchApprovals(HUB, { fetch: f, now: () => T });
  check(s1.status === 'ok' && s1.items.length === 1, 'fetchApprovals reads the feed');
  check(calls[0]!.init.redirect === 'error' && calls[0]!.init.credentials === 'include' && calls[0]!.init.cache === 'no-store', 'read rules');
  check((await fetchApprovals('http://bad', { fetch: f, now: () => T })).status === 'unreachable', 'a bad hub address is unreachable');
  const w = new ApprovalsWatcher({ hub: HUB, fetch: f, now: () => T, everyMs: 60_000, visible: () => true });
  let told = 0;
  w.subscribe(() => { told++; });
  const [a, b] = [w.check(), w.check()];
  check(a === b, 'one read at a time');
  await a;
  check(told === 1 && w.state.items.length === 1, 'subscribers told');
  const pushed = w.push({ type: 'veto', phase: 'held', id: H1, jobId: 'job-1', title: 'X', runsAt: new Date(T + 60_000).toISOString(), secondsLeft: 60 });
  check(pushed === H1, 'a veto push names its call and reads now');
  check(w.push({ type: 'other' }) === null, 'other pushes just read');
}
{
  const { f } = fake({ '/auth/admin/approvals.json': { status: 302, text: '' } });
  check((await fetchApprovals(HUB, { fetch: f, now: () => T })).status !== 'ok', 'a redirect is never ok');
}

console.log(`lib-approvals: ${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
