/**
 * check-terminal-nav — the Terminal's sessions nav (terminal-sessions-nav, Nov 3 2026): the rail's pure helpers
 * (apps/console-web/plugins/console-terminal/web/nav-core.ts): search, filter, sort, the running timer, what a tap
 * opens (a read-only mirror, Jump in = writable, a chat = its feed) and the chat link guard.
 *
 *   npx -y tsx framework/spec/check-terminal-nav.mts
 */
import { chatLink, dotOf, elapsed, matches, openFor, passes, sortItems, view, type NavItem, type NavModel } from '../../apps/console-web/plugins/console-terminal/web/nav-core.ts';

let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };

check(elapsed(3_000) === '3s' && elapsed(245_000) === '4m 05s' && elapsed(3_720_000) === '1h 02m' && elapsed(183_600_000) === '2d 3h' && elapsed(-5) === '0s', 'running timer: s, m ss, h mm, d h');

const mine: NavItem = { id: 'tmux:vps:claude-main', kind: 'tmux', name: 'claude-main', title: 'claude-main', where: 'vps', status: 'attached', startedAt: 1000 };
const tab: NavItem = { id: 'tmux:console:axt-console-ab', kind: 'tmux', name: 'axt-console-ab', title: 'axt-console-ab', where: 'console', status: 'detached', startedAt: 3000 };
const chat: NavItem = { id: 'chat:Amber', kind: 'chat', name: 'chat:Amber', title: 'Amber', session: 'Amber', status: 'working', startedAt: 2000, lastAt: 9000, url: 'https://claude.ai/chat/1', lastLine: 'checking builds' };
const run: NavItem = { id: 'tmux:vps:axf-x', kind: 'headless', name: 'axf-x', title: 'Earl the Ear', agent: 'Earl the Ear', model: 'claude-opus-5-5', where: 'vps', status: 'waiting', startedAt: 500, costUsd: 1.2 };
const done: NavItem = { ...mine, id: 'tmux:vps:old', name: 'old', status: 'ended', endedAt: 8000 };
const conn: NavItem = { id: 'conn:vps', kind: 'connection', name: 'vps', title: 'VPS host (root)', via: 'vps', ready: false, why: 'set up' };

check(matches(run, 'earl opus') && matches(chat, 'checking') && !matches(mine, 'earl'), 'search: every word, across title, agent, model and last line');
check(passes(mine, 'live') && !passes(done, 'live') && passes(run, 'waiting') && !passes(run, 'working') && passes(conn, 'working'), 'filter: live / working / waiting; connections always pass');
check(sortItems([mine, tab, chat], 'started').map((x) => x.name).join() === 'axt-console-ab,chat:Amber,claude-main', 'sort: newest started first');
check(sortItems([tab, mine, chat], 'name').map((x) => x.title).join() === 'Amber,axt-console-ab,claude-main', 'sort: by name');
check(sortItems([mine, tab, chat], 'activity')[0] === chat, 'sort: last activity first');
const m: NavModel = { $axf: 'terminal-nav@1', now: 0, vps: { ready: true, why: '' }, mine: [mine, tab, chat], agents: [run], connections: [conn], recent: [done] };
const v = view(m, '', 'all', 'started');
check(v.mine.length === 3 && v.agents[0] === run && v.connections[0] === conn && v.recent[0] === done, 'view: the four sections');
check(view(m, 'amber', 'all', 'started').mine.length === 1 && view(null, '', 'all', 'name').mine.length === 0, 'view: search narrows; no model = empty');

check(JSON.stringify(openFor(mine)) === JSON.stringify({ kind: 'vps', attach: 'claude-main', readOnly: true, title: 'claude-main' }), 'tap on My sessions = a read-only mirror on the VPS');
check(openFor(mine, true)?.readOnly === undefined && openFor(tab)?.kind === 'console', 'Jump in = writable; a console tmux opens in the console');
check(openFor(chat)?.kind === 'feed' && openFor(chat)?.feed === 'chat:Amber' && openFor(conn) === null, 'a chat opens its feed; a connection is not a session');
check(chatLink(chat) === 'https://claude.ai/chat/1' && chatLink({ ...chat, url: 'https://evil.example/x' }) === '' && chatLink({ ...chat, url: 'http://claude.ai/x' }) === '', 'Jump in on a chat only opens https://claude.ai links');
check(dotOf(mine) === 'working' && dotOf(tab) === 'waiting' && dotOf(done) === 'ended' && dotOf(conn) === 'failed' && dotOf(run) === 'waiting', 'status dots');

console.log(`✓ terminal sessions nav — ${ok} checks`);
