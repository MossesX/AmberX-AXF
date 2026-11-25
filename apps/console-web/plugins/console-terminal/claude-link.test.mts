// @ts-nocheck: a Node test, not part of the console's build
/**
 * The Terminal's Claude link: its settings and the pure helpers behind them (web/claude-link-core.ts), the levels its
 * settings asset carries, and the design note (docs/claude-link.md).
 *
 *   npx -y tsx apps/console-web/plugins/console-terminal/claude-link.test.mts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUFFER, DEFAULTS, KEYS, KIND_LABELS, KINDS, LEVELS, cleanBuffer, cleanKinds, kindShown, readPrefs, trimTo } from './web/claude-link-core.ts';

const PLUGIN = fileURLToPath(new URL('./', import.meta.url));
let ok = 0;
const check = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check(same([...KINDS], ['launch', 'exit', 'account', 'mcp', 'axhub', 'connect', 'disconnect', 'error']), 'the eight kinds, in order');
check(KINDS.every((k) => KIND_LABELS[k]), 'every kind has a label');

check(cleanBuffer(undefined) === BUFFER.default && cleanBuffer('abc') === BUFFER.default && cleanBuffer(NaN) === BUFFER.default, 'no or broken buffer size = the default');
check(cleanBuffer(5) === BUFFER.min && cleanBuffer(1e9) === BUFFER.max && cleanBuffer('2500') === 2500 && cleanBuffer(1234.6) === 1235, 'buffer size stays a whole number inside its range');

check(same(cleanKinds(['error', 'launch', 'error', 'nope']), ['launch', 'error']), 'kinds: known ones, canonical order, no repeats');
check(same(cleanKinds([]), [...KINDS]) && same(cleanKinds(null), [...KINDS]) && same(cleanKinds(['nope']), [...KINDS]), 'no valid kind picked = every kind');
check(same(cleanKinds('mcp, axhub'), ['mcp', 'axhub']), 'kinds also read from a comma list (voice, CLI)');

check(same(readPrefs(() => null), DEFAULTS), 'nothing saved = the defaults');
const saved: Record<string, unknown> = { [KEYS.buffer]: 300, [KEYS.kinds]: ['mcp'], [KEYS.autoScroll]: false, [KEYS.showDetail]: true };
check(same(readPrefs((k) => saved[k]), { buffer: 300, kinds: ['mcp'], autoScroll: false, showDetail: true }), 'saved values are read back');
check(same(readPrefs((k) => ({ [KEYS.autoScroll]: 'yes', [KEYS.buffer]: -1 } as Record<string, unknown>)[k]), { ...DEFAULTS, buffer: BUFFER.min }), 'broken saved values fall back safely');

check(kindShown({ kinds: ['mcp'] }, 'mcp') && !kindShown({ kinds: ['mcp'] }, 'exit'), 'the filter lets its kinds through, nothing else');
check(same(trimTo([1, 2, 3, 4, 5], 0).length, 5) && trimTo(Array.from({ length: 250 }, (_, i) => i), 100).length === 100 && trimTo(Array.from({ length: 250 }, (_, i) => i), 100)[0] === 150, 'the buffer keeps the newest lines');

// every setting has a level, and the settings asset (what the level toolbar reads) says the same
const asset = JSON.parse(readFileSync(`${PLUGIN}assets/settings/default-console-terminal.json`, 'utf8')) as { data: { levelOf: Record<string, string> } };
check(Object.values(KEYS).every((k) => LEVELS[k]), 'every Claude link setting has a level');
check(Object.values(KEYS).every((k) => asset.data.levelOf[k] === LEVELS[k]), 'the settings asset carries the same level for each setting');
check(!!asset.data.levelOf['terminal.claude-link'], 'the Claude link group has a level');

// the registry group names exactly these keys, with defaults inside their ranges
const src = readFileSync(`${PLUGIN}web/claude-link.ts`, 'utf8');
check(['KEYS.buffer', 'KEYS.kinds', 'KEYS.autoScroll', 'KEYS.showDetail'].every((k) => src.includes(`key: ${k}`)), 'the settings group declares all four settings');
check(readFileSync(`${PLUGIN}web/index.tsx`, 'utf8').includes('settings: [claudeLinkSettings]'), 'the plugin contributes the group to the settings registry');
check(DEFAULTS.buffer >= BUFFER.min && DEFAULTS.buffer <= BUFFER.max && DEFAULTS.buffer % BUFFER.step === 0, 'the default buffer size is on the slider');

// the design note lists every field and kind
const note = readFileSync(`${PLUGIN}docs/claude-link.md`, 'utf8');
check(['ts', 'kind', 'source', 'session', 'account', 'model', 'summary', 'detail', 'level'].every((f) => note.includes(`| \`${f}\` |`)), 'the design note lists every event field');
check(KINDS.every((k) => note.includes(`\`${k}\``)), 'the design note names every kind');

console.log(`all ${ok} checks passed`);
