/**
 * Smart menus (smart-menu@1, core/engines/smartmenu.ts): ranking math, context keys, `when` conditions, reset,
 * destructive items never promoted, topics, section composition, the look compile, and that the engine never imports an
 * LLM client (learning is plain arithmetic, zero tokens). The cases' outputs are the golden fixture
 * spec/fixtures/smart-menu.json (the conformance contract a Kotlin twin will be held to).
 *
 *   npx -y tsx framework/spec/check-smart-menu.mts           check
 *   npx -y tsx framework/spec/check-smart-menu.mts --write   regenerate the fixture after an intended engine change
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeMenu, contextKey, filterWhen, hourBucket, isDestructive, liveTopics, menuCandidates, menuLookOverride, menuLookStyle, mergeTopics,
  normalizeSections, parseMenuState, prunePicks, resetPicks, scoreMenuItems, topicItems, whenMatches,
  type MenuOpen, type MenuPick, type MenuTopicTemplate,
} from '../core/engines/smartmenu';
import type { MenuItem } from '../core/types';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'smart-menu.json');
const ENGINE = join(here, '..', 'core', 'engines', 'smartmenu.ts');
const NOW = Date.UTC(2026, 10, 3, 15, 0, 0); // Nov 3 2026 15:00 UTC
const MIN = 60_000, DAY = 86_400_000;

let passed = 0;
const t = (name: string, fn: () => void) => { try { fn(); passed++; } catch (e) { console.error(`✗ ${name}\n  ${(e as Error).message}`); process.exitCode = 1; } };

/* ---------- inputs ---------- */
const open: MenuOpen = { kind: 'context', menu: 'ctx:build-card', target: 'build-card', payload: 'smart-menus', state: ['running', 'has-pr'], screen: 'builds', device: 'desktop' };
const items: MenuItem[] = [
  { id: 'open', label: 'Open', icon: 'external', action: 'builds.open' },
  { id: 'copy-id', label: 'Copy id', icon: 'copy', action: 'builds.copy-id' },
  { id: 'sep1', separator: true },
  { id: 'more', label: 'More', icon: 'dots', items: [{ id: 'log', label: 'Log', action: 'builds.log' }, { id: 'rename', label: 'Rename', action: 'builds.rename' }] },
  { id: 'open-pr', label: 'Open PR', icon: 'git-pull-request', action: 'builds.pr', when: { state: 'has-pr' } },
  { id: 'retry', label: 'Retry', icon: 'refresh', action: 'builds.retry', when: { state: 'failed' } },
  { id: 'phone-only', label: 'Share', icon: 'share', action: 'builds.share', when: { device: 'phone' } },
  { id: 'sep2', separator: true },
  { id: 'delete', label: 'Delete', icon: 'trash', action: 'builds.delete' },
  { id: 'stop', label: 'Stop', icon: 'square', action: 'builds.stop', when: { state: 'running' } },
];
const key = contextKey(open);
const picks: MenuPick[] = [
  // "log" picked a lot here, recently; "delete" picked the most but must never be promoted
  ...[1, 2, 3, 4, 5].map((h) => ({ key, item: 'log', at: NOW - h * 60 * MIN })),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((h) => ({ key, item: 'delete', at: NOW - h * 30 * MIN })),
  // "copy-id" picked often but long ago (decayed)
  ...[1, 2, 3, 4, 5, 6].map((d) => ({ key, item: 'copy-id', at: NOW - (20 + d) * DAY })),
  // "rename" picked elsewhere (another screen) only
  ...[1, 2, 3].map((h) => ({ key: contextKey({ ...open, screen: 'home' }), item: 'rename', at: NOW - h * 60 * MIN })),
  // sequence: after "open" comes "open-pr"
  { key, item: 'open', at: NOW - 3 * MIN }, { key, item: 'open-pr', at: NOW - 2 * MIN }, { key, item: 'open', at: NOW - 1 * MIN },
];
const templates: MenuTopicTemplate[] = [
  { kind: 'build', menus: ['app:builds', 'ctx:*'], items: [
    { id: 'topic.open-build', label: 'Open {label}', icon: 'hammer', action: 'builds.open:{id}' },
    { id: 'topic.stop-build', label: 'Stop {label}', icon: 'square', action: 'builds.stop:{id}' },
  ] },
  { kind: 'plugin', menus: ['app:plugins'], items: [{ id: 'topic.open-plugin', label: 'Open {label}', action: 'nav:{id}' }] },
];
const topics = mergeTopics([], [{ kind: 'build', id: 'toolbar-tap-confirm', label: 'Toolbar build' }, { kind: 'plugin', id: 'menus', label: 'Menus' }], NOW - 5 * MIN);

/* ---------- golden outputs ---------- */
const scores = scoreMenuItems(menuCandidates(filterWhen(items, open)), picks, open, NOW);
const composed = composeMenu({ items, open, now: NOW, picks, pins: ['copy-id', 'delete'], topics, templates });
const plain = composeMenu({ items, open, now: NOW, picks: [], sections: [{ kind: 'static' }] });
const actual = {
  $axf: 'smart-menu-fixture@1',
  contextKey: key,
  parseState: parseMenuState(' Running, has-PR  running '),
  when: {
    hasPr: whenMatches({ state: 'has-pr' }, open), failed: whenMatches({ state: 'failed' }, open), notRunning: whenMatches({ notState: 'running' }, open),
    anyState: whenMatches({ anyState: ['failed', 'running'] }, open), screen: whenMatches({ screen: ['builds', 'home'] }, open), phone: whenMatches({ device: 'phone' }, open),
    topicBuild: whenMatches({ topic: 'build' }, open, topics), topicNote: whenMatches({ topic: 'note' }, open, topics),
  },
  scores,
  composed,
  plain: plain.items.map((i) => i.id),
  topics: liveTopics(topics, NOW).map((x) => `${x.kind}:${x.id}`),
  topicItems: topicItems(liveTopics(topics, NOW), templates, { ...open, menu: 'app:builds', kind: 'app' }).map((i) => [i.id, i.label, i.action]),
  look: menuLookStyle({ colors: { suggested: 'warning', talking: 'not-a-token' }, fontScale: 9, animation: 'drop', opacity: 0.8 }),
  lookReduced: menuLookStyle({ animation: 'scale', stagger: 30 }, true).attrs,
  lookOverride: menuLookOverride({ fontScale: 1, perMenu: { 'app:builds': { fontScale: 1.2 } } }, 'app:builds'),
};

if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n');
  console.log(`wrote ${FIXTURE}`);
}
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/* ---------- checks ---------- */
t('fixture matches the engine', () => assert.deepEqual(JSON.parse(JSON.stringify(actual)), fixture));
t('context key = menu | target | sorted state | screen (no payload)', () => assert.equal(key, 'ctx:build-card|build-card|has-pr,running|builds'));
t('when conditions', () => assert.deepEqual(actual.when, { hasPr: true, failed: false, notRunning: false, anyState: true, screen: true, phone: false, topicBuild: true, topicNote: false }));
t('conditional items that do not apply are dropped (static menu, no plugin)', () => {
  const ids = filterWhen(items, open).map((i) => i.id);
  assert.ok(ids.includes('open-pr') && ids.includes('stop'));
  assert.ok(!ids.includes('retry') && !ids.includes('phone-only'));
});
t('frecency: recent picks outrank many old ones', () => {
  const s = Object.fromEntries(scores.map((x) => [x.id, x.score]));
  assert.ok(s.log! > s['copy-id']!, `log ${s.log} vs copy-id ${s['copy-id']}`);
  const old = scores.find((x) => x.id === 'copy-id')!;
  assert.ok(old.frecency > 0 && old.frecency < 1, String(old.frecency));
});
t('picks elsewhere count a quarter', () => { const r = scores.find((x) => x.id === 'rename')!; assert.equal(r.frecency, 0); assert.ok(r.elsewhere > 0.7 && r.elsewhere < 0.76, String(r.elsewhere)); });
t('sequence (Markov): after "open" comes "open-pr"', () => { const r = scores.find((x) => x.id === 'open-pr')!; assert.ok(r.sequence > 0.9); assert.equal(r.why, 'Often next'); });
t('time-of-day bucket', () => { assert.equal(hourBucket(NOW), 3); assert.equal(hourBucket(NOW, 300), 2); });
t('destructive items are recognised', () => {
  assert.ok(isDestructive({ id: 'delete', action: 'builds.delete' }) && isDestructive({ id: 'x', action: 'builds.stop' }) && isDestructive({ id: 'reset-all' }));
  assert.ok(!isDestructive({ id: 'open', action: 'builds.open' }) && !isDestructive({ id: 'stop', action: 'x', destructive: false }));
});
t('destructive never promoted (Suggested, Pinned, Talking about)', () => {
  for (const s of composed.sections) assert.ok(!s.ids.some((id) => ['delete', 'stop', 'topic.stop-build'].includes(id)), `${s.kind}: ${s.ids}`);
  assert.ok(composed.items.some((i) => i.id === 'delete' && !i.section), 'delete stays in the static part');
});
t('sections in order: talking, pinned, suggested, context, then static in its own order', () => {
  // open-pr (the only matching conditional item) was already suggested, so the context section has nothing left
  assert.deepEqual(composed.sections.map((s) => s.kind), ['talking', 'pinned', 'suggested']);
  const cold = composeMenu({ items, open, now: NOW, picks: [] });
  assert.deepEqual(cold.sections, [{ kind: 'context', ids: ['open-pr'] }]);
  assert.deepEqual(cold.items.slice(0, 2).map((i) => i.id), ['smart:context', 'open-pr']);
  const stat = composed.items.slice(composed.items.findIndex((i) => i.id === 'smart-sep:static') + 1).map((i) => i.id);
  assert.deepEqual(stat, ['open', 'copy-id', 'sep1', 'more', 'sep2', 'delete', 'stop']);
});
t('Suggested holds the learned items, top first, no duplicates of Pinned', () => {
  const sug = composed.sections.find((s) => s.kind === 'suggested')!.ids;
  assert.ok(sug.length >= 1 && sug.length <= 4);
  assert.ok(!sug.includes('copy-id'));
  assert.equal(sug[0], 'log');
});
t('a cold menu shows no Suggested section', () => { const c = composeMenu({ items, open, now: NOW, picks: [] }); assert.ok(!c.sections.some((s) => s.kind === 'suggested')); });
t('learning off = no Suggested', () => { const c = composeMenu({ items, open, now: NOW, picks, options: { learning: false } }); assert.ok(!c.sections.some((s) => s.kind === 'suggested')); });
t('context section off keeps matching conditional items in place', () => {
  const c = composeMenu({ items, open, now: NOW, sections: [{ kind: 'static' }] });
  assert.deepEqual(c.items.map((i) => i.id), ['open', 'copy-id', 'sep1', 'more', 'open-pr', 'sep2', 'delete', 'stop']);
});
t('topics: Talking-about items filled from the topic, only in menus they fit', () => {
  assert.deepEqual(actual.topicItems, [['topic.open-build@build:toolbar-tap-confirm', 'Open Toolbar build', 'builds.open:toolbar-tap-confirm']]);
  const talk = composed.items.filter((i) => i.section === 'talking' && !i.heading);
  assert.equal(talk.length, 1, JSON.stringify(talk)); assert.equal(talk[0]!.source, 'topic.open-build');
});
t('topics decay after their lifetime and a repeat refreshes them', () => {
  assert.deepEqual(liveTopics(topics, NOW + 40 * MIN), []);
  const again = mergeTopics(topics, [{ kind: 'build', id: 'toolbar-tap-confirm' }], NOW);
  assert.equal(liveTopics(again, NOW + 28 * MIN).length, 1);
  assert.equal(mergeTopics(topics, [{ kind: 'note', id: 'n1' }], NOW, true).length, 1);
});
t('reset: all, one menu, one context', () => {
  assert.equal(resetPicks(picks).length, 0);
  assert.equal(resetPicks(picks, { menu: 'ctx:build-card' }).length, 0);
  assert.equal(resetPicks(picks, { menu: 'app:builds' }).length, picks.length);
  assert.equal(resetPicks(picks, { key }).length, 3);
});
t('prune keeps the log bounded', () => { const many = Array.from({ length: 50 }, (_, i) => ({ key, item: 'open', at: NOW - i * MIN })); assert.equal(prunePicks(many, NOW, 7, 10).length, 10); });
t('sections normalise (unknown dropped, static forced on, max clamped)', () => {
  const n = normalizeSections([{ kind: 'suggested', max: 99 }, { kind: 'bogus' as never }, { kind: 'static', on: false }]);
  assert.deepEqual(n.map((s) => [s.kind, s.on, s.max]), [['suggested', true, 12], ['static', true, undefined]]);
});
t('look: colours are theme tokens only, values clamped, reduced motion = no animation', () => {
  assert.equal(actual.look.vars['--fx-menu-suggested'], 'var(--fx-warning)');
  assert.equal(actual.look.vars['--fx-menu-talking'], 'var(--fx-info)');
  assert.ok(actual.look.vars['--fx-menu-font-size'].includes('1.6'));
  assert.ok(!Object.values(actual.look.vars).some((v) => /#[0-9a-f]{3,8}\b|rgb\(/i.test(v)), 'no literal colours');
  assert.equal(actual.lookReduced['data-fx-menu-anim'], 'none');
  assert.deepEqual(Object.keys(actual.lookOverride).sort(), ['--fx-menu-font-size', '--fx-menu-heading-size']);
});
t('zero tokens: the engine imports no LLM client and calls no network', () => {
  const src = readFileSync(ENGINE, 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports.filter((m) => !m!.startsWith('.')), [], `external imports: ${imports}`);
  assert.ok(!/anthropic|openai|@ai-sdk|langchain|axf\.llm|fetch\(|XMLHttpRequest/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'LLM client or network call in the engine');
});

console.log(process.exitCode ? `smart menus: failures (${passed} passed)` : `✓ smart menus — ${passed} checks`);
