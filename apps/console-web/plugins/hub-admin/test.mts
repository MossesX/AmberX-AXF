// @ts-nocheck: a Node test, not part of the console's build
/**
 * The Hub plugin's pure parts: `axf hub …` planning (every word becomes the same REST request the screens, MCP and voice
 * use; person actions have no command line), and the manifest's command declarations against the route table.
 *   node --experimental-strip-types apps/console-web/plugins/hub-admin/test.mts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as cli from './hub.mjs';
import * as hc from '../../../../framework/core/hub-console.mjs';

let n = 0;
const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ID = '0123abcd-0123-4abc-8def-0123456789ab';

t('words: every screen and the table', () => {
  assert.deepEqual(cli.cliWords, [...hc.screenWords(cli.table), 'table']);
  assert.ok(cli.cliWords.includes('approval-log'), 'the log screen answers to approval-log too');
});
t('reads', () => {
  assert.deepEqual(cli.plan(['approvals']), { method: 'GET', path: '/approvals', query: {}, json: false });
  assert.deepEqual(cli.plan(['approvals', '--status', 'pending', '--page', '2', '--json']), { method: 'GET', path: '/approvals', query: { status: 'pending', page: '2' }, json: true });
  assert.deepEqual(cli.plan(['approvals', ID]), { method: 'GET', path: `/approvals/${ID}`, query: {}, json: false });
  assert.deepEqual(cli.plan(['connectors', 'vps']), { method: 'GET', path: '/connectors/vps', query: {}, json: false });
  assert.deepEqual(cli.plan(['table']), { method: 'GET', path: '/table', json: false });
  assert.deepEqual(cli.plan(['approval-log', '--status', 'approved']), { method: 'GET', path: '/log', query: { status: 'approved' }, json: false });
  assert.deepEqual(cli.plan(['approval-log', 'download']), { method: 'POST', path: '/log/download', body: {}, json: false, confirm: false });
});
t('commands and confirms become POST / DELETE with the flags as the body', () => {
  assert.deepEqual(cli.plan(['approvals', 'auto-stop']), { method: 'POST', path: '/approvals/auto-stop', body: {}, json: false, confirm: false });
  assert.deepEqual(cli.plan(['passes', 'revoke', 'p1', '--reason', 'done']), { method: 'POST', path: '/passes/p1/revoke', body: { reason: 'done' }, json: false, confirm: true });
  assert.deepEqual(cli.plan(['passes', 'extend', 'p1', '--minutes', '30']), { method: 'POST', path: '/passes/p1/extend', body: { minutes: 30 }, json: false, confirm: false });
  assert.deepEqual(cli.plan(['users', 'delete', 'u1']), { method: 'DELETE', path: '/users/u1', body: {}, json: false, confirm: true });
  assert.deepEqual(cli.plan(['passes', 'request', '--service', 'vps', '--minutes', '30']), { method: 'POST', path: '/passes/request', body: { service: 'vps', minutes: 30 }, json: false, confirm: false });
});
t('refusals say why', () => {
  assert.match(cli.plan([]).error!, /axf hub </);
  assert.match(cli.plan(['nowhere']).error!, /no hub screen/);
  assert.match(cli.plan(['approvals', 'approve', ID]).error!, /own tap/);
  assert.match(cli.plan(['passes', 'grant']).error!, /own tap/);
  assert.match(cli.plan(['passes', 'revoke']).error!, /needs a row id/);
  assert.match(cli.plan(['approvals', 'not-a-row']).error!, /neither an action/);
  assert.match(cli.plan(['approvals', 'postpone', 'bad id']).error!, /own tap/);
});
t('send: the console URL, the bearer token, JSON in and out', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200 }); }) as unknown as typeof fetch;
  const r = await cli.send(cli.plan(['approvals', '--status', 'pending']), { base: 'https://c.test/', token: 'tok', fetch: f });
  assert.equal(r.status, 200); assert.equal(calls[0]!.url, 'https://c.test/api/plugins/hub-admin/approvals?status=pending');
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'Bearer tok');
  await cli.send(cli.plan(['passes', 'extend', 'p1', '--minutes', '30']), { base: 'https://c.test', token: '', fetch: f });
  assert.equal(calls[1]!.init.method, 'POST'); assert.equal(calls[1]!.init.body, JSON.stringify({ minutes: 30 }));
  assert.ok(!('authorization' in (calls[1]!.init.headers as Record<string, string>)), 'no token, no header');
});
t('describe: unavailable states read as one line, lists as counts', () => {
  assert.match(cli.describe({ ok: false, code: 'hub_missing', message: 'no route', proposed: 'POST /x' }), /hub_missing.*POST \/x/);
  assert.match(cli.describe({ ok: true, items: [{ id: 'a', tool: 'vps.run' }], total: 1 }), /items: 1 item/);
});
t('the manifest declares every read with the table\'s tool and skips every person route', () => {
  const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
  const items: { route?: string; tool?: string; skip?: string }[] = manifest.commands.items;
  for (const s of hc.screensOf(cli.table)) {
    assert.equal(items.find((i) => i.route === `GET /${s.id}`)?.tool, s.state.tool, `GET /${s.id}`);
    if (s.rows?.read) assert.equal(items.find((i) => i.route === `GET /${s.id}/{row}`)?.tool, s.rows.read.tool, `GET /${s.id}/{row}`);
  }
  for (const sid of ['approvals', 'passes', 'log', 'users']) for (const a of hc.screensOf(cli.table).find((s) => s.id === sid)!.actions) {
    const it = items.find((i) => i.route === (a.method === 'DELETE' ? `DELETE /${sid}/{row}` : a.row ? `POST /${sid}/{row}/${a.id}` : `POST /${sid}/${a.id}`));
    assert.ok(it, `${sid}/${a.id} declared`);
    if (a.who === 'person') assert.ok(it!.skip && !it!.tool, `${sid}/${a.id} is skipped (person)`);
    else assert.equal(it!.tool, hc.toolOf(cli.table, sid, a.id), `${sid}/${a.id} tool`);
    if (a.who === 'confirm') assert.ok((it as { confirm?: boolean }).confirm === true, `${sid}/${a.id} declares confirm`);
  }
  assert.equal(manifest.cli.hub, 'hub.mjs');
});

console.log(`hub-admin pure parts ok (${n} checks)`);
