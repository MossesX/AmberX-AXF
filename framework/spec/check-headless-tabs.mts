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
import { createMeter, importsOf, memoryChain, rulesOf } from '../../deploy/claude-meter.mjs';
import { advance, modelName, money, persistable, statusOf, steps, tmuxName, toOpen, type ChainItem } from '../../apps/console-web/plugins/console-terminal/web/headless-core.ts';

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
console.log(`all ${ok} checks passed`);
