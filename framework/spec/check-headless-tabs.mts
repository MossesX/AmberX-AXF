/**
 * check-headless-tabs — the headless tabs build (Nov 3 2026): the live cost meter and context chain the launcher keeps
 * (deploy/claude-meter.mjs, deploy/claude-stream.mjs) and the terminal's pure web helpers
 * (apps/console-web/plugins/console-terminal/web/headless-core.ts).
 *
 *   npx -y tsx framework/spec/check-headless-tabs.mts
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs, no types
import { createMeter, importsOf, memoryChain, mentionsOf, rulesOf, startRule } from '../../deploy/claude-meter.mjs';
import { reorderIndex, tabPressIntent, TAB_HOLD_MS } from '../core/engines/windows.ts';
import { pinchSteps, resolveSize, stepSize } from '../../apps/console-web/plugins/console-terminal/web/textsize.ts';
import { advance, chainTree, modelName, money, persistable, replay, revealTick, shownOf, statusOf, steps, tmuxName, toOpen, treeOrder, REVEAL0, planNew, newSessionMode, type ChainItem } from '../../apps/console-web/plugins/console-terminal/web/headless-core.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
const pricing = { models: { opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } } };

console.log('headless tabs');
// ---- rules and imports
const md = '# Title\n\nSome text.\n- **Rule one** keep it\n  - nested `@not/an-import.md`\n```\n- not a rule\n@code/block.md\n```\n2. numbered\n## Sub\n@./x.md and @~/hub/CLAUDE.md';
const rules = rulesOf(md);
check(rules.map((r: { kind: string }) => r.kind).join(',') === 'heading,item,item,item,heading', 'rules = headings and list items, code blocks skipped');
check(rules[2].level === 1 && rules[0].level === 1 && rules[4].level === 2, 'nesting and heading levels kept');
const imps = importsOf(md, '/r/CLAUDE.md', '/home/b');
check(imps.length === 2 && imps[0] === '/r/x.md' && imps[1] === '/home/b/hub/CLAUDE.md', '@imports: relative to the file and ~/ = home; not in code spans or blocks');

// ---- memory chain in Claude Code's order
const root = mkdtempSync(join(tmpdir(), 'axf-ht-'));
const home = join(root, 'home'); const proj = join(root, 'proj'); const sub = join(proj, 'app');
for (const d of [join(home, '.claude'), join(home, 'hub'), join(proj, '_claude'), join(proj, '.claude', 'rules'), join(sub, 'deep')]) mkdirSync(d, { recursive: true });
writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# User\n@~/hub/CLAUDE.md\n');
writeFileSync(join(home, 'hub', 'CLAUDE.md'), '# Hub\n- keep data in the hub\n');
writeFileSync(join(proj, 'CLAUDE.md'), '# Project\n- one\n@_claude/RULES.md\n');
writeFileSync(join(proj, '_claude', 'RULES.md'), '# Rules\n- a\n- b\n- c\n@../CLAUDE.md\n');
writeFileSync(join(proj, '.claude', 'rules', 'style.md'), '- tokens only\n');
writeFileSync(join(sub, 'CLAUDE.md'), '# App\n- app rule\n');
writeFileSync(join(sub, 'deep', 'file.ts'), 'x');
const chainItems = memoryChain(sub, { home });
const rel = chainItems.map((c: { path: string; via: string }) => `${c.via}:${c.path.replace(root, '')}`);
check(rel.join(' | ') === 'user memory:/home/.claude/CLAUDE.md | import:/home/hub/CLAUDE.md | project memory:/proj/CLAUDE.md | import:/proj/_claude/RULES.md | project memory:/proj/app/CLAUDE.md | project rules:/proj/.claude/rules/style.md',
  'memory chain: user memory, imports depth-first, outermost folder first, .claude/rules; an import cycle is read once');

// ---- the meter: cost per message once, reconciled to the result, chain from Reads
let t = 1_000_000;
const m = createMeter({ session: 'axf-x', name: 'x', agent: 'Vinnie', model: 'opus', cwd: proj, home, pricing, now: () => t });
check(m.snapshot().chainCount === 5 && m.snapshot().status === 'starting', 'meter starts with the memory chain loaded, status starting');
m.add({ type: 'system', subtype: 'init', model: 'claude-opus-5-5' });
const usage = (o: number) => ({ input_tokens: 1000, output_tokens: o, cache_read_input_tokens: 100000, cache_creation_input_tokens: 2000 });
m.add({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(500), content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: join(sub, 'deep', 'file.ts') } }] } });
m.add({ type: 'assistant', message: { id: 'm1', model: 'claude-opus-5-5', usage: usage(600), content: [] } });
let s = m.snapshot();
const expect1 = (1000 * 4 + 600 * 20 + 100000 * 0.2 + 2000 * 5) / 1e6;
check(Math.abs(s.costUsd - expect1) < 1e-4 && s.costEstimated && s.priced, `streamed message counted once at its last usage ($${expect1.toFixed(4)})`);
check(s.status === 'working' && s.toolRunning && s.agent === 'Vinnie' && s.model === 'claude-opus-5-5', 'working, tool running, agent and the real model from init');
const ch = m.chain();
check(ch.items.some((i: ChainItem) => i.via === 'nested memory' && i.rel === 'app/CLAUDE.md') && ch.items.at(-1).rel === 'app/deep/file.ts' && ch.items.at(-1).via === 'read', 'a Read brings in its folder\'s CLAUDE.md first, then the file, in order');
check(ch.items[0].rules.length === 1 && ch.items.find((i: ChainItem) => i.rel === '_claude/RULES.md').rules.length === 4, 'each Markdown file carries its rules');
m.add({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
check(!m.snapshot().toolRunning, 'tool result clears the running tool');
m.add({ type: 'result', subtype: 'success', total_cost_usd: 0.25, num_turns: 2 });
s = m.snapshot();
check(s.costUsd === 0.25 && !s.costEstimated && s.status === 'done' && s.tokens.output === 600, 'result: cost = Claude Code\'s total_cost_usd, done, tokens kept');
const m2 = createMeter({ session: 'axf-x', model: 'opus', cwd: proj, home, pricing, prev: s, prevChain: ch, now: () => t });
m2.add({ type: 'assistant', message: { id: 'n1', model: 'claude-opus-5-5', usage: { input_tokens: 0, output_tokens: 1000 }, content: [] } });
check(Math.abs(m2.snapshot().costUsd - 0.27) < 1e-6 && m2.snapshot().runs === 2 && m2.chain().items.length === ch.items.length, 'a second run (account switch) adds to the first; chain carried over');
const m3 = createMeter({ session: 'axf-y', model: 'opus', cwd: proj, home, pricing });
m3.add({ type: 'assistant', message: { id: 'q', usage: usage(10), content: [] } }); m3.end();
check(m3.snapshot().status === 'failed' && m3.snapshot().ended, 'stream ended without a result = failed');
const m4 = createMeter({ session: 'axf-z', model: 'mystery-model', cwd: proj, home, pricing });
m4.add({ type: 'assistant', message: { id: 'q', model: 'mystery-model', usage: usage(10), content: [] } });
check(m4.snapshot().priced === false && m4.snapshot().costUsd === 0, 'a model without a price is flagged, never guessed');

// ---- the stream printer writes the meter files
const dir = mkdtempSync(join(tmpdir(), 'axf-ht-io-'));
const input = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: [] }),
  'plain line',
  JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 1.5, num_turns: 1 }),
].join('\n');
const run = spawnSync(process.execPath, [join(REPO, 'deploy/claude-stream.mjs'), '--meter', join(dir, 'm.json'), '--chain', join(dir, 'c.json'), '--session', 'axf-io', '--agent', 'Rosa'], { input, cwd: proj, encoding: 'utf8' });
const meter = JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8'));
check(run.status === 0 && run.stdout.includes('plain line') && run.stdout.includes('done'), 'stream printer still prints readable lines');
check(meter.$axf === 'headless-meter@1' && meter.costUsd === 1.5 && meter.agent === 'Rosa' && meter.status === 'done', 'meter file written when the stream ends');
check(JSON.parse(readFileSync(join(dir, 'c.json'), 'utf8')).$axf === 'context-chain@1', 'chain file written');
const plain = spawnSync(process.execPath, [join(REPO, 'deploy/claude-stream.mjs')], { input, encoding: 'utf8' });
check(plain.status === 0 && plain.stdout.includes('plain line'), 'without --meter it behaves as before');

// ---- web helpers
check(persistable({ kind: 'vps' }) && persistable({ kind: 'console' }) && persistable({ kind: 'claude', via: 'vps' }) && !persistable({ kind: 'container' }) && !persistable({ kind: 'claude', via: 'container' }) && !persistable({ kind: 'vps', attach: 'axf-a' }),
  'persistent tabs: VPS + console shells and Claude Code, never container TTYs or attached headless runs');
check(tmuxName({ kind: 'claude', via: 'vps' }, 'abc123') === 'axt-claude-vps-abc123' && /^axt-[A-Za-z0-9._-]+$/.test(tmuxName({ kind: 'vps' })), 'tab tmux names are axt-…');
const items = [{ name: 'axf-b', createdAt: 2 }, { name: 'axf-a', createdAt: 1 }, { name: 'axf-shown', createdAt: 0 }, { name: 'axf-closed', createdAt: 0 }, { name: 'axt-tab', createdAt: 0 }, { name: 'axf-;x', createdAt: 0 }];
check(toOpen(items, new Set(['axf-shown']), new Set(['axf-closed'])).map((h) => h.name).join() === 'axf-a,axf-b', 'auto-open: running headless sessions no tab shows, unless closed by Brett, oldest first');
// ---- no focus stealing (terminal-no-focus, Nov 4 2026): 'When a new session starts'
const fresh = toOpen(items, new Set(), new Set());
check(newSessionMode(undefined) === 'quiet' && newSessionMode('bogus') === 'quiet' && newSessionMode('front') === 'front', 'new session mode: quiet by default, unknown values fall back to quiet');
const q = planNew('quiet', fresh, true);
check(q.open.length === fresh.length && !q.raise && !q.wait.length, 'quiet + a terminal window open: background tabs, never raised');
const qn = planNew('quiet', fresh, false);
check(!qn.open.length && qn.wait.length === fresh.length && !qn.raise, 'quiet + no terminal window: no window pops, they only count on the badge');
const nn = planNew('nothing', fresh, true);
check(!nn.open.length && !nn.wait.length, 'do nothing: no tab, no count');
const ff = planNew('front', fresh, false);
check(ff.open.length === fresh.length && ff.raise, 'bring to front: the old open-and-raise');
const now = Date.parse('2026-11-03T12:00:00Z');
check(statusOf({ status: 'working', toolRunning: false, lastEventAt: '2026-11-03T11:58:00Z' }, now) === 'waiting'
  && statusOf({ status: 'working', toolRunning: true, lastEventAt: '2026-11-03T11:58:00Z' }, now) === 'working'
  && statusOf({ status: 'done', toolRunning: false, lastEventAt: '2026-11-03T11:00:00Z' }, now) === 'done', 'status dot: quiet a minute = waiting, a long tool = still working');
check(modelName('claude-opus-5-5') === 'Opus 5.5' && modelName('fable') === 'Fable' && modelName('') === '', 'model label');
check(money(3.4567) === '$3.46' && money(42.31) === '$42.3' && money(512.9) === '$513' && money(undefined) === '', 'cost label');
const chainItems2 = [{ i: 0, path: '/a', rel: 'a', via: 'read', depth: 0, parent: '', at: '', rules: [{ kind: 'item' as const, level: 0, text: 'abcdefghij' }, { kind: 'item' as const, level: 0, text: 'xyz' }] }];
const seq = steps(chainItems2);
check(seq.length === 3 && seq[0]!.rule === -1, 'reveal order: file header, then each rule');
let c = { step: 0, chars: 0, wait: 0 };
c = advance(c, seq, 100, 'normal');
check(c.step === 0 && c.wait > 0, 'a file header pauses before its rules');
c = advance(c, seq, 450 + 100, 'normal');
check(c.step === 1 && c.chars === 9, 'rules type out at the chosen pace (45 chars/s)');
c = advance(c, seq, 10_000, 'normal');
check(c.step === seq.length, 'and finish');
check(advance({ step: 0, chars: 0, wait: 0 }, seq, 1, 'instant').step === seq.length, 'All = everything at once');
check(advance({ step: 1, chars: 0, wait: 0 }, seq, 1000, 'slow').chars < advance({ step: 1, chars: 0, wait: 0 }, seq, 1000, 'fast').chars || advance({ step: 1, chars: 0, wait: 0 }, seq, 1000, 'fast').step > 1, 'slow is slower than fast');

// ---- the chain as a tree (terminal-drag-chain-tree, Nov 3 2026): parents from @imports, mentions and start rules
console.log('context chain tree');
check(mentionsOf('Read `_claude/THREADS.md` first; see [spec](docs/a.md), framework/cli/x.mjs and https://e.com/b.md').map((x: { path: string }) => x.path).join() === '_claude/THREADS.md,docs/a.md,framework/cli/x.mjs',
  'mentions: code spans, links and bare paths; never URLs');
check(startRule('Read `_claude/THREADS.md` first') && startRule('on every load, read it') && !startRule('see the report for details'), 'a "read it first / on load" line is a session-start rule');
const tp = join(root, 'tree'); for (const d of [join(tp, '_claude', 'rules'), join(tp, '_claude', 'shared', 'rules'), join(tp, '_claude', 'memory'), join(tp, 'src')]) mkdirSync(d, { recursive: true });
writeFileSync(join(tp, 'CLAUDE.md'), '# Project\n@_claude/rules/RULES.md\n- Read `_claude/THREADS.md` first, on every load.\n- Decisions live in `_claude/memory/decisions.md`.\n- Specs: `memory/spec.md`.\n');
writeFileSync(join(tp, '_claude', 'rules', 'RULES.md'), '# Rules\n@../shared/rules/RULES.md\n- r1\n');
writeFileSync(join(tp, '_claude', 'shared', 'rules', 'RULES.md'), '# Shared\n- s1\n- s2\n');
writeFileSync(join(tp, '_claude', 'THREADS.md'), '# Threads\n- see src/app.ts\n');
writeFileSync(join(tp, '_claude', 'memory', 'decisions.md'), '# Decisions\n- d1\n'); writeFileSync(join(tp, '_claude', 'memory', 'spec.md'), '# Spec\n');
writeFileSync(join(tp, 'src', 'app.ts'), 'x'); writeFileSync(join(tp, 'src', 'lone.ts'), 'y');
const home2 = join(root, 'home2'); mkdirSync(home2, { recursive: true });
const tm = createMeter({ session: 'axf-t', model: 'opus', cwd: tp, home: home2, pricing, now: () => t });
const readEv = (id: string, f: string) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id: `t-${id}`, name: 'Read', input: { file_path: join(tp, f) } }] } });
for (const [id, f] of [['a', '_claude/THREADS.md'], ['b', '_claude/memory/decisions.md'], ['c', 'src/app.ts'], ['d', 'src/lone.ts'], ['e', '_claude/memory/spec.md']] as const) tm.add(readEv(id, f));
const ti: ChainItem[] = tm.chain().items;
const by = (r: string) => ti.find((x) => x.rel === r)!;
check(by('CLAUDE.md').reason === 'session-start' && by('_claude/rules/RULES.md').reason === 'import' && by('_claude/rules/RULES.md').parentI === by('CLAUDE.md').i
  && by('_claude/shared/rules/RULES.md').parentI === by('_claude/rules/RULES.md').i, 'session-start file, @imports nested two levels under the file that imports them');
check(by('_claude/THREADS.md').reason === 'session-start rule' && by('_claude/THREADS.md').parentI === by('CLAUDE.md').i && /first/.test(by('_claude/THREADS.md').why ?? ''), 'a Read the CLAUDE.md says to do first: under it, as a session-start rule, with the line why');
check(by('_claude/memory/decisions.md').reason === 'reference' && by('_claude/memory/decisions.md').parentI === by('CLAUDE.md').i, 'a Read a loaded file mentions: a reference under it');
check(by('src/app.ts').parentI === by('_claude/THREADS.md').i && by('src/app.ts').depth === 2, 'chains keep going: a file THREADS.md mentions sits under THREADS.md');
check(by('src/lone.ts').reason === 'read' && by('src/lone.ts').parentI === -1, 'a Read nothing mentions is a root');
check(by('_claude/memory/spec.md').parentI === by('CLAUDE.md').i && by('_claude/memory/spec.md').reason === 'reference', 'a partial mention (memory/spec.md) still finds its file');
const tr = chainTree(ti);
check(tr.map((n) => n.rel).join() === 'CLAUDE.md,src/lone.ts' && tr[0]!.children.map((n) => n.rel).join() === '_claude/rules/RULES.md,_claude/THREADS.md,_claude/memory/decisions.md,_claude/memory/spec.md', 'chainTree nests every file under the file that pulled it in, load order kept');
check(treeOrder(tr).map((k) => ti[k]!.rel).join(' > ') === 'CLAUDE.md > _claude/rules/RULES.md > _claude/shared/rules/RULES.md > _claude/THREADS.md > src/app.ts > _claude/memory/decisions.md > _claude/memory/spec.md > src/lone.ts', 'the reveal walks the tree depth-first');
check(treeOrder(tr, new Set([by('CLAUDE.md').i])).length === 2, 'a folded file hides (and holds back) its children');
const legacy = [{ i: 0, path: '/a', rel: 'a', via: 'project memory', depth: 0, parent: '', at: '', rules: [] }, { i: 1, path: '/b', rel: 'b', via: 'import', depth: 1, parent: '', at: '', rules: [] }, { i: 2, path: '/c', rel: 'c', via: 'import', depth: 2, parent: 'nope', at: '', rules: [] }];
check(chainTree(legacy)[0]!.children[0]!.children[0]!.rel === 'c', 'older chain files (depth only) still nest');
let rv = REVEAL0; const ord = treeOrder(tr);
rv = revealTick(rv, ti, ord, 1, 'normal');
check(rv.cur?.item === by('CLAUDE.md').i && shownOf(rv, rv.cur.item, ti).rules === 0, 'reveal starts at the root file');
for (let k = 0; k < 400; k++) rv = revealTick(rv, ti, ord, 200, 'fast');
check(!rv.cur && ord.every((k) => rv.done.includes(k)), 'and walks every file');
rv = replay(rv, by('_claude/shared/rules/RULES.md').i);
check(rv.cur?.item === by('_claude/shared/rules/RULES.md').i && shownOf(rv, rv.cur.item, ti).rules === 0 && shownOf(rv, by('CLAUDE.md').i, ti).rules === by('CLAUDE.md').rules.length, 'picking a file replays its content from the start; the others stay shown');
check(revealTick(REVEAL0, ti, ord, 1, 'instant').done.length === ord.length, 'All = the whole tree at once');

// ---- drag the window by a tab (framework windows engine) and text size per pane (terminal-drag-chain-tree)
console.log('window grip gestures + text size');
check(tabPressIntent({ dx: 1, dy: 1, heldMs: 100, released: true }) === 'tap' && tabPressIntent({ dx: 0, dy: 0, heldMs: 100 }) === 'pending', 'a quick tap is a tap (the tab switches)');
check(tabPressIntent({ dx: 40, dy: 3, heldMs: 120 }) === 'reorder', 'a horizontal drag before the hold reorders');
check(tabPressIntent({ dx: 0, dy: 0, heldMs: TAB_HOLD_MS }) === 'armed' && tabPressIntent({ dx: 30, dy: 2, heldMs: TAB_HOLD_MS + 10 }) === 'window', 'press and hold, then move = drag the window, whichever way');
check(tabPressIntent({ dx: 2, dy: 30, heldMs: 50 }) === 'window', 'a vertical pull drags the window too');
check(tabPressIntent({ dx: 1, dy: 0, heldMs: TAB_HOLD_MS + 50, released: true }) === 'hold', 'a hold released without moving = long-press (the menu on a phone)');
const rects = [{ left: 0, right: 100 }, { left: 100, right: 200 }, { left: 200, right: 300 }];
check(reorderIndex(rects, 0, 260) === 2 && reorderIndex(rects, 2, 20) === 0 && reorderIndex(rects, 1, 140) === 1 && reorderIndex(rects, 0, 160) === 1, 'reorder lands where the pointer passes a tab\'s middle');
const memo0 = { tabs: {}, profiles: {} };
check(resolveSize('term', { phone: false, auto: 13, defaults: { fontSize: 14 }, memory: memo0 }) === 14 && resolveSize('term', { phone: true, auto: 11, defaults: { fontSize: 14, fontSizePhone: 0 }, memory: memo0 }) === 11,
  'default: the computer size; on a phone Auto = the theme token size (smaller)');
const memo1 = stepSize(memo0, 'term', -1, 14, { tab: 'axf-a', profile: 'default' });
check(resolveSize('term', { tab: 'axf-a', phone: false, auto: 13, defaults: { fontSize: 14 }, memory: memo1 }) === 13 && resolveSize('term', { tab: 'axf-b', profile: 'default', phone: false, auto: 13, defaults: { fontSize: 14 }, memory: memo1 }) === 13
  && resolveSize('term', { tab: 'axf-c', phone: false, auto: 13, defaults: { fontSize: 14 }, memory: memo1 }) === 14, 'A− is remembered for the tab and its profile, other tabs keep the default');
const memo2 = stepSize(memo1, 'term', 'reset', 13, { tab: 'axf-a', profile: 'default' });
check(resolveSize('term', { tab: 'axf-a', phone: false, auto: 13, defaults: { fontSize: 14 }, memory: memo2 }) === 14 && !Object.keys(memo2.tabs).length, 'reset goes back to the default');
check(resolveSize('chain', { tab: 'x', phone: false, auto: 0, defaults: { chainTextSize: 100 }, memory: stepSize(memo0, 'chain', 1, 100, { tab: 'x' }) }) === 110, 'the chain pane has its own size (10 % steps)');
check(resolveSize('term', { tab: 't', phone: false, auto: 0, defaults: {}, memory: stepSize(memo0, 'term', -1, 7, { tab: 't' }) }) === 7, 'sizes stay inside their limits');
check(pinchSteps(100, 100) === 0 && pinchSteps(100, 140) === 2 && pinchSteps(100, 70) === -2, 'pinch: every 15 % apart is one step');
console.log(`all ${ok} checks passed`);
