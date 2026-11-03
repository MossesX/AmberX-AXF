/**
 * check-claude-session — the shared Claude session library (framework/libs/claude-session, build gizmo-companion,
 * Nov 3 2026): the parts harvested from the console Terminal stay the same objects the Terminal exports, and the
 * companion helpers (conversations, models, budget, speech, interrupts, tool cards, the Molly → Gizmo rename) hold.
 *
 *   npx -y tsx framework/spec/check-claude-session.mts
 */
import { readFileSync } from 'node:fs';
import * as lib from '../libs/claude-session/core.ts';
import * as baked from '../../apps/console-web/src/axf/libs/claude-session/core.ts';
import * as term from '../../apps/console-web/plugins/console-terminal/web/headless-core.ts';

let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };

console.log('claude-session');
// ---- the Terminal reads the library's copy (one implementation, no behaviour change)
for (const k of ['modelName', 'money', 'statusOf', 'steps', 'advance', 'PACE'] as const) check((term as Record<string, unknown>)[k] === (baked as Record<string, unknown>)[k], `Terminal's ${k} is the library's`);
for (const app of ['console-web', 'amberx-droid']) {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  check(src(`../../apps/${app}/src/axf/libs/claude-session/core.ts`) === src('../libs/claude-session/core.ts'), `${app} bakes the current library`);
}
check(lib.modelName('claude-opus-5-5') === 'Opus 5.5' && lib.modelName('fable') === 'Fable', 'model names');
check(lib.money(1.234) === '$1.23' && lib.money(12.34) === '$12.3' && lib.money(123.4) === '$123', 'money');

// ---- the companion
check(lib.COMPANION.name === 'Gizmo' && lib.COMPANION.agentId === 'gizmo', 'the companion is Gizmo');
check(lib.renameAssistant('Ask Molly. MOLLY said molly’s thing; Mollyx stays.') === 'Ask Gizmo. GIZMO said gizmo’s thing; Mollyx stays.', 'Molly → Gizmo, whole words, case kept');

// ---- conversations
const now = new Date('2026-11-03T15:00:00').getTime();
const day = 86_400_000;
const c = (id: string, updatedAt: number, pinned = false, title = id, preview = '', tags: string[] = []) => ({ id, title, pinned, archived: false, tags, updatedAt, messages: 1, agentId: 'gizmo', preview });
const items = [c('old', now - 30 * day), c('today', now - 1000), c('pin', now - 40 * day, true), c('yday', now - day), c('week', now - 3 * day, false, 'Deploy notes', 'coolify redeploy', ['ops'])];
check(lib.orderConversations(items).map((x) => x.id).join() === 'pin,today,yday,week,old', 'pinned first, then newest');
check(lib.groupConversations(items, '', now).map((g) => g.group).join() === 'Pinned,Today,Yesterday,This week,Earlier', 'day groups in list order');
check(lib.filterConversations(items, 'coolify ops').map((x) => x.id).join() === 'week', 'search: every word, title + preview + tags');
check(lib.filterConversations(items, '  ').length === items.length, 'empty search = all');

// ---- models (model-policy@1: Opus or Fable only)
const ms = lib.chatModels();
check(ms[0]?.key === 'opus' && ms.map((m) => m.key).join() === 'opus,fable', 'pick list = policy allowed, default first');
check(lib.chatModelId('sonnet') === 'claude-opus-5-5' && lib.chatModelId('claude-haiku-5-5') === 'claude-opus-5-5', 'Sonnet / Haiku run as Opus');
check(lib.chatModelId('fable') === 'claude-fable-5-1' && lib.chatModelId('') === '', 'Fable kept; empty = default');

// ---- budget
check(lib.budgetState(1, 0).level === 'off', 'no cap = off');
check(lib.budgetState(7, 10).level === 'ok' && lib.budgetState(8, 10).level === 'warn' && lib.budgetState(10.5, 10).level === 'over', 'ok / warn at 80 % / over');
check(lib.budgetState(7, 10).left === '$3.00', 'left to spend');

// ---- speech
const md = '# Heads up\n\nThe **build** is `green`. See [the PR](https://github.com/x/y/pull/1).\n\n```ts\nconst x = 1;\n```\n- one\n- two\n| a | b |\n|---|---|';
const said = lib.speakable(md);
check(!/[#*`|]/.test(said) && said.includes('The build is green.') && said.includes('See the PR.') && said.includes('(code in the chat)') && !said.includes('const x'), 'speakable: no markdown, code left out, link text kept');
check(lib.sentences('One. Two! Three?').join('|') === 'One.|Two!|Three?', 'sentences');
check(lib.sentences('word '.repeat(100).trim(), 50).every((s) => s.length <= 50), 'long sentences cut at a space');
let r = lib.readyToSpeak('Hello there. How are', 0, false);
check(r.chunk === 'Hello there. ' && r.upTo === 13, 'streaming: complete sentences only');
r = lib.readyToSpeak('Hello there. How are you', r.upTo, true);
check(r.chunk === 'How are you', 'streaming: the rest when the reply is done');
r = lib.readyToSpeak('Look: ```ts\nconst a. b. c', 0, false);
check(!r.chunk.includes('const'), 'streaming: nothing inside an open code block');

// ---- interrupts
for (const w of ['stop', 'Stop!', 'wait wait', 'hold on', 'okay okay', 'Gizmo stop', 'no no']) check(lib.isInterrupt(w), `"${w}" stops it`);
for (const w of ['', 'stop the build on the console now please', 'what time is it', 'bus stop near me later today ok']) check(!lib.isInterrupt(w), `"${w}" does not`);

// ---- tool cards
const tc = lib.toolCard({ id: '1', name: 'axhub_call', input: '{"tool":"github.pulls/list"}', done: false });
check(tc.state === 'running' && tc.title.startsWith('axHub') && tc.detail === 'github.pulls/list', 'tool card: running axHub call with its tool');
check(lib.toolCard({ id: '2', name: 'repo_read', input: 'a.ts', done: true, ok: false }).state === 'failed', 'tool card: failed');

console.log(`all ${ok} checks passed`);
