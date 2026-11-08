#!/usr/bin/env node
/**
 * account-health.test.mjs — the account health check and its shared store (build account-health-failover, Nov 8 2026).
 * No network, no claude binary, no real accounts: a temp folder for every path, fake probes and a fake fetch.
 *   node deploy/account-health.test.mjs
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'axf-health-'));
const A = join(tmp, 'accounts'); const W = join(tmp, 'workers'); const SH = join(tmp, 'shared'); const HD = join(tmp, 'headless');
for (const d of [A, W, SH, HD]) mkdirSync(d, { recursive: true });
const ALERTS = join(tmp, 'alerts.jsonl');
Object.assign(process.env, { AXF_CLAUDE_ACCOUNTS: A, AXF_CLAUDE_HOME: SH, AXF_CLAUDE_GLOBAL: join(tmp, 'g.json'), AXF_CLAUDE_SEEN: join(W, 'seen.json'),
  AXF_CLAUDE_WORKERS: W, AXF_HEADLESS_DIR: HD, AXF_ACCOUNT_ALERTS: `file:${ALERTS}`, AXF_WORKERS_ALIVE: '', AXF_PROBE_DIR: join(tmp, 'probe') });
const env = { ...process.env };

const H = await import('./account-status.mjs');
const P = await import('./claude-account-probe.mjs');
const X = await import('./claude-workers.mjs');
const R = await import('./worker-routing.mjs');

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`✗ ${m}`); } };
const login = (name, rt) => { mkdirSync(join(A, name), { recursive: true }); writeFileSync(join(A, name, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: `at-${rt}`, refreshToken: rt, expiresAt: Date.parse('2026-11-08T20:00:00Z') } })); };
const alerts = () => { try { return readFileSync(ALERTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const reset = () => { for (const f of ['account-status.json', 'worker-state.json']) rmSync(join(W, f), { force: true }); rmSync(ALERTS, { force: true }); };
const now = Date.parse('2026-11-08T12:00:00Z');

for (const n of ['w1', 'w2', 'console']) login(n, `rt-${n}`);
writeFileSync(join(A, '.active'), 'console');
writeFileSync(join(W, 'workers.json'), JSON.stringify({ $axf: R.SCHEMA, interactiveTakesJobs: true }));

console.log('store: account-status@1');
const e0 = H.put('w1', { status: 'ok', checkedAt: new Date(now).toISOString(), models: ['opus', 'fable', 'sonnet'], usage: { weekly: { used: 61.26, resetsAt: '2026-11-14T03:00:00Z' } } }, env, now);
ok(e0.models.join() === 'opus,fable', 'models are the policy ones only (Sonnet never runs here)');
ok(e0.usage.weekly.left === 38.7 && e0.usage.weekly.used === 61.3, 'used / left in percent, one decimal');
ok(H.read(env).$axf === 'account-status@1' && H.read(env).updatedAt, 'one file, schema and time');
ok(H.normStore({ accounts: { 'Bad Name': {}, ok: { status: 'weird' } } }).accounts.ok.status === 'unknown' && !H.normStore({ accounts: { 'Bad Name': {} } }).accounts['Bad Name'], 'bad names dropped, bad statuses unknown');
ok(JSON.stringify(H.read(env)).includes('rt-') === false, 'no credential in the store');
ok(H.policyModels(['claude-haiku-5-5', 'claude-opus-5-5', 'claude-fable-5-1']).join() === 'opus,fable', 'model ids → opus, fable');

console.log('ableFor: what routing may do');
const t = (o) => H.normEntry('x', { checkedAt: new Date(now).toISOString(), ...o });
ok(H.ableFor(null, { now }).ok, 'never checked = not blocked');
ok(!H.ableFor(t({ status: 'expired', login: { hash: 'aaaa' } }), { now, loginHash: 'aaaa' }).ok, 'expired = blocked');
ok(H.ableFor(t({ status: 'expired', login: { hash: 'aaaa' } }), { now, loginHash: 'bbbb' }).ok, 'expired, then signed in again (new login) = back');
ok(!H.ableFor(t({ status: 'limited', until: new Date(now + 3600e3).toISOString() }), { now }).ok, 'limited until later = blocked');
ok(H.ableFor(t({ status: 'limited', until: new Date(now - 1).toISOString() }), { now }).ok, 'past its reset = back');
ok(!H.ableFor(t({ status: 'no-credits' }), { now }).ok && H.ableFor(t({ status: 'no-credits' }), { now: now + 7 * 3600e3 }).ok, 'no credits without a time: blocked, then not after 6 h');
ok(!H.ableFor(t({ status: 'ok', models: ['opus'] }), { now, model: 'fable' }).ok, 'a model it can\'t use now = no');
ok(H.ableFor(t({ status: 'ok', models: ['opus'] }), { now, model: 'opus' }).ok, 'its own model = yes');
ok(H.ableFor(t({ status: 'ok', models: null }), { now, model: 'fable' }).ok, 'models not known = no filter');
ok(H.limitFor(t({ status: 'expired' }), { now })?.kind === 'auth', 'expired → an auth limit for routing');

console.log('routing reads the store');
reset();
ok(X.route({}, env, now) === 'w1', 'all fine: first worker');
H.put('w1', { status: 'expired', checkedAt: new Date(now).toISOString(), login: { hash: X.loginHashOf('w1', env).slice(0, 16) } }, env, now);
ok(X.route({}, env, now) === 'w2', 'the store says w1 expired: skipped');
const sw = X.status(env, now).accounts.find((a) => a.name === 'w1');
ok(sw.limited?.source === 'account-status' && sw.health?.status === 'expired', 'status shows the store limit and the health');
login('w1', 'rt-w1-new');
ok(X.route({}, env, now) === 'w1', 'signed in again (new login): back without waiting for a check');
H.put('w1', { status: 'ok', checkedAt: new Date(now).toISOString(), models: ['opus'] }, env, now);
ok(X.preview({ model: 'fable' }, {}, env, now).account === 'w2', 'a Fable job skips the account whose Fable cap is spent');
ok(X.preview({ model: 'opus' }, {}, env, now).account === 'w1', 'an Opus job still goes there');
H.put('w2', { status: 'ok', checkedAt: new Date(now).toISOString(), models: ['opus'] }, env, now);
H.put('console', { status: 'ok', checkedAt: new Date(now).toISOString(), models: ['opus'] }, env, now);
ok(X.preview({ model: 'fable' }, {}, env, now).state === 'none', 'no account can use Fable = none (the launcher waits / fails over)');
ok(R.decide({}, [{ name: 'a', kind: 'subscription', models: ['opus'] }], { model: 'fable' }).state === 'none', 'decide filters on models');
ok(R.decide({}, [{ name: 'a', kind: 'subscription', models: null }], { model: 'fable' }).account === 'a', 'decide: models not known = runs');

console.log('failover writes the store');
reset();
X.markLimit('w2', { kind: 'credits', text: 'Credit balance is too low' }, env, now);
ok(H.read(env).accounts.w2?.status === 'no-credits' && H.read(env).accounts.w2.source === 'failover', 'a build dying on credits = no-credits in the store at once');
X.markLimit('w1', { kind: 'auth', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }, env, now);
ok(H.read(env).accounts.w1?.status === 'expired', 'a dead login = expired');
X.clearLimit('w1', env);
ok(H.read(env).accounts.w1?.status === 'unknown' && H.read(env).accounts.w1.source === 'clear', 'brought back by hand = unknown until the next check');

console.log('classify + parsers');
const ses = P.parseSession([
  JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'OK' }] } }),
  JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.6, resetsAt: 1794625200 } }),
  JSON.stringify({ type: 'result', total_cost_usd: 0.0015, usage: { input_tokens: 361 }, is_error: false }),
].join('\n'), '', 0);
ok(ses.ok && ses.costUsd === 0.0015 && ses.inputTokens === 361 && ses.rate[0].used === 60, 'stream-json: answered, cost, tokens, the weekly window');
const dead = P.parseSession(JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'Failed to authenticate: OAuth session expired and could not be refreshed' }] } }) + '\n'
  + JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' }), '', 1);
ok(!dead.ok && (dead.errorText.match(/Failed to authenticate/g) || []).length === 1, 'a refused login, said once');
ok(P.classify({ session: dead, hit: X.hitOf(dead.errorText, 1) }).status === 'expired', 'refused login = expired');
ok(P.classify({ session: dead, hit: 'auth' }).why === 'login expired and could not be renewed', 'in plain words');
ok(P.classify({ session: { ok: false, errorText: 'Credit balance is too low', rate: [] }, hit: 'credits' }).status === 'no-credits', 'credits = no-credits');
const usage = P.parseUsage({ five_hour: { utilization: 100, resets_at: '2026-11-08T15:00:00Z' }, seven_day: { utilization: 61 }, limits: [{ kind: 'weekly_scoped', percent: 100, resets_at: '2026-11-14T03:00:00Z', scope: { model: { display_name: 'Fable' } } }], extra_usage: { is_enabled: false, used_credits: 0, monthly_limit: 4000, decimal_places: 2 } });
ok(usage.fiveHour.used === 100 && usage.perModel[0].model === 'fable' && usage.extra.limitUsd === 40, 'usage read: windows, per-model cap, extra credits in dollars');
const lim = P.classify({ session: ses, usage, modelIds: ['claude-opus-5-5', 'claude-fable-5-1'] });
ok(lim.status === 'limited' && lim.until === '2026-11-08T15:00:00Z' && lim.why === '5-hour limit used up', 'a full 5-hour window = limited until its reset');
ok(lim.models.join() === 'opus', 'a spent weekly Fable cap takes Fable off its models');
const fine = P.classify({ session: ses, usage: P.parseUsage({ seven_day: { utilization: 85 } }), modelIds: ['claude-opus-5-5'] });
ok(fine.status === 'ok' && fine.warn && /weekly 85%/.test(fine.why), 'ok, with a warning at 80 %+');
ok(P.classify({ session: { ok: false, errorText: 'no answer in 60 s', rate: [] } }).status === 'unknown', 'no answer = unknown (not blocked)');
ok(P.usageFromRate(ses.rate).weekly.used === 60, 'a setup token: usage from the session\'s rate-limit events');

console.log('API keys (fake network)');
mkdirSync(join(A, 'k1'), { recursive: true }); writeFileSync(join(A, 'k1', 'apikey'), 'sk-ant-test-key');
const fakeFetch = (answers) => async (url, o = {}) => {
  const a = answers.find(([re]) => re.test(url)) ?? [null, 404, {}];
  if (o.headers?.['x-api-key'] && !/^sk-ant-/.test(o.headers['x-api-key'])) throw new Error('bad header');
  return { status: a[1], json: async () => a[2] };
};
const cfg = R.normProbe({});
let ea = await P.probeApi({ name: 'k1', kind: 'api', spend: { day: 2, week: 10, dayCap: 10, weekCap: 50 } }, cfg, { env, now, fetchImpl: fakeFetch([[/models/, 200, { data: [{ id: 'claude-opus-5-5' }] }], [/messages/, 200, { usage: { input_tokens: 9, output_tokens: 1 } }]]) });
ok(ea.status === 'ok' && ea.models.join() === 'opus' && ea.api.left === 8 && ea.probe.costUsd < 0.001, 'a working key: ok, models, $8 left of today\'s cap, cost under a tenth of a cent');
ea = await P.probeApi({ name: 'k1', kind: 'api' }, cfg, { env, now, fetchImpl: fakeFetch([[/models/, 200, { data: [] }], [/messages/, 400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } }]]) });
ok(ea.status === 'no-credits', 'credit balance too low = no-credits');
ea = await P.probeApi({ name: 'k1', kind: 'api' }, cfg, { env, now, fetchImpl: fakeFetch([[/models/, 401, { error: { message: 'invalid x-api-key' } }]]) });
ok(ea.status === 'expired' && ea.why === 'API key refused', 'a refused key = expired');
ea = await P.probeApi({ name: 'nokey', kind: 'api' }, cfg, { env, now, fetchImpl: fakeFetch([]) });
ok(ea.status === 'unknown' && /no API key/.test(ea.why), 'no key saved = unknown, nothing sent');

console.log('a whole check: store, notifications, back / out');
reset();
X.markLimit('w2', { kind: 'usage', text: 'hit your limit' }, env, now);
rmSync(ALERTS, { force: true });
const fake = (status, extra = {}) => async (row) => ({ name: row.name, label: row.label, kind: 'subscription', email: '', status, why: status, until: '', warn: false, models: ['opus', 'fable'], source: 'probe', probe: { ms: 5, costUsd: 0.0015, inputTokens: 361, session: true }, ...extra });
const by = { w1: fake('expired', { why: 'login expired and could not be renewed' }), w2: fake('ok'), console: fake('ok') };
const deps = { now, probeSubscription: (row, c, o) => by[row.name](row, c, o), probeApi: fake('ok') };
let r = await P.run({ trigger: 'load' }, env, deps);
ok(!r.skipped && r.entries.length === 4 && r.run.state === 'done' && Math.abs(r.run.costUsd - 0.006) < 1e-9, 'every account checked, run recorded with its cost');
const st = H.read(env);
ok(st.accounts.w1.status === 'expired' && st.accounts.w2.status === 'ok' && st.accounts.w1.trigger === 'load', 'results in the one store');
ok(!X.status(env, now).accounts.find((a) => a.name === 'w2').limited, 'w2 came back ok: out of the limits');
const al = alerts();
const start = al.find((a) => a.payload.meta?.phase === 'start'); const res = al.find((a) => a.payload.meta?.phase === 'result');
ok(start && start.payload.meta.type === 'account-status' && /Checking 4 Claude accounts/.test(start.payload.title), 'phone: "checking 4 accounts" first');
ok(res && /1 login expired/.test(res.payload.title) && /Sign w1 in again/.test(res.payload.body) && res.payload.severity === 'warning', 'phone: the result per account, and what to do');
ok(al.findIndex((a) => a.payload.meta?.phase === 'start') < al.findIndex((a) => a.payload.meta?.phase === 'result'), 'in that order');
ok(al.some((a) => a.path === '/api/alerts/resolve' && a.payload.keys[0].endsWith(':start')), 'the "checking" one closes when the result goes');
ok(al.some((a) => a.payload.key === 'claude-accounts:account:w1:auth'), 'the dead login gets its own problem alert');
ok(al.some((a) => a.path === '/api/alerts/resolve' && a.payload.keys.includes('claude-accounts:account:w2:usage')), 'w2 was out before: its problem alert closes');
ok(!JSON.stringify(al).includes('rt-'), 'no credential in any alert');
r = await P.run({ trigger: 'load' }, env, { ...deps, now: now + 5 * 60e3 });
ok(/checked 5 min ago/.test(r.skipped || ''), 'a console opening 5 min later doesn\'t check again (15 min gap)');
rmSync(ALERTS, { force: true });
r = await P.run({ trigger: 'schedule' }, env, { ...deps, now: now + 61 * 60e3 });
ok(!r.skipped && !alerts().some((a) => a.payload.meta?.type === 'account-status'), 'a scheduled check sends no before/after notification (notifyRuns: load)');
ok(!alerts().some((a) => a.payload.key === 'claude-accounts:account:w1:auth'), 'and no second problem alert for the same dead login');
r = await P.run({ trigger: 'manual', names: ['w2'] }, env, { ...deps, now: now + 62 * 60e3 });
ok(r.entries.length === 1 && r.entries[0].name === 'w2', 'one account by name');
H.update((s) => { s.run = { ...s.run, state: 'running', startedAt: new Date(now + 63 * 60e3).toISOString() }; }, env);
r = await P.run({ trigger: 'manual' }, env, { ...deps, now: now + 63.5 * 60e3 });
ok(/already running/.test(r.skipped || ''), 'never two checks at once');

console.log('a check the console asked for');
writeFileSync(P.requestFile(env), JSON.stringify({ trigger: 'load', at: new Date(now).toISOString(), accounts: ['w1', 'BAD;rm'], by: 'Brett' }));
const q = P.takeRequest(env, now + 30e3);
ok(q && q.trigger === 'load' && q.names.join() === 'w1' && q.by === 'Brett', 'the sweep takes it: trigger, names (bad ones dropped), who');
ok(P.takeRequest(env, now) === null, 'taken once');
writeFileSync(P.requestFile(env), JSON.stringify({ trigger: 'rm -rf', at: new Date(now).toISOString() }));
ok(P.takeRequest(env, now).trigger === 'manual', 'an unknown trigger = manual');
writeFileSync(P.requestFile(env), JSON.stringify({ trigger: 'load', at: new Date(now - 3600e3).toISOString() }));
ok(P.takeRequest(env, now) === null, 'an hour-old request is dropped');

console.log('due + settings');
const c2 = R.normProbe({ intervalMin: 5, notifyRuns: 'loud', timeoutSec: 9999, onLoad: false });
ok(c2.intervalMin === 10 && c2.notifyRuns === 'load' && c2.timeoutSec === 300 && c2.onLoad === false, 'settings clamp to their ranges');
ok(R.normConfig({}).probe.intervalMin === 60, 'defaults: every 60 min');
ok(P.due(R.normProbe({}), { run: null }, now).due, 'never checked = due');
ok(!P.due(R.normProbe({}), { run: { state: 'done', startedAt: new Date(now - 30 * 60e3).toISOString() } }, now).due, 'checked 30 min ago = not due');
ok(!P.due(R.normProbe({ enabled: false }), { run: null }, now).due, 'scheduled checks off = never due');

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `✗ account-health: ${fail} of ${pass + fail} checks failed` : `✓ account-health: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
