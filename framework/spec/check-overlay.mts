/*
 * overlay@1 (core/engines/overlay.ts): replays spec/fixtures/overlay.json against the engine (the same file the Kotlin
 * OverlayConformanceTest replays), checks the starter assets, the type's place in the spec (chrome, hideable, optional,
 * interface@1 slot), the shared validator (core = CLI build engine) and a few live rules the fixture can't pin.
 * Run: npx -y tsx framework/spec/check-overlay.mts
 */
import { readFileSync, readdirSync } from 'node:fs';
import spec from '../schemas/asset-types.json';
import defaults from '../defaults.json';
import { ASSET_TYPES, OPTIONAL_TYPES } from '../core/types';
import { validateAsset } from '../core/validate';
import { hideable } from '../core/engines/hide';
import { interfaceErrors, normalizeInterface } from '../core/engines/interface';
import {
  CHIP_TONES, CHIP_TONE_TOKEN, OVERLAY_LIMITS, OVERLAY_SETTINGS, OVERLAY_TYPE, addLogLine, canDrag, chipToneToken, clampPosition, clampSize,
  confidenceText, logLine, logLineFade, logLineText, maxSize, miniSize, nextStripExpiry, normalizeOverlay, overlayErrors, overlayWithSettings,
  parsePosition, parseSize, resolveChips, serializePosition, serializeSize, setChip, stripLines, trimLog, type OverlayData,
} from '../core/engines/overlay';
// @ts-expect-error plain .mjs
import { overlayErrors as cliOverlayErrors } from '../core/engines/overlay-rules.mjs';

let n = 0;
const fails: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (name: string, c: unknown) => { n++; if (!c) fails.push(name); };

const root = new URL('.', import.meta.url);
const f = JSON.parse(readFileSync(new URL('fixtures/overlay.json', root), 'utf8'));
const starters = readdirSync(new URL('../assets/overlay/', root)).filter((x) => x.endsWith('.json')).map((x) => JSON.parse(readFileSync(new URL(`../assets/overlay/${x}`, root), 'utf8')));

/* the type in the spec */
const ts = (spec.types as Record<string, { group: string; hideable?: boolean; optional?: boolean; required: string[] }>)[OVERLAY_TYPE];
ok('overlay type declared', !!ts);
eq('chrome group', ts.group, 'Chrome');
ok('hideable', hideable(OVERLAY_TYPE) && ts.hideable === true);
ok('optional', ts.optional === true && OPTIONAL_TYPES.includes(OVERLAY_TYPE as never));
ok('in ASSET_TYPES', ASSET_TYPES.includes(OVERLAY_TYPE as never));
eq('required fields', ts.required, ['pill', 'log', 'strip', 'mini']);
eq('a default', (defaults as Record<string, string>).overlay, 'pill-compact');
ok('default exists', starters.some((a) => a.id === (defaults as Record<string, string>).overlay));
eq('fixture type', f.type, OVERLAY_TYPE);
eq('fixture settings', f.settings, OVERLAY_SETTINGS);
eq('fixture limits', f.limits, OVERLAY_LIMITS);
eq('fixture tones', f.tones, CHIP_TONES);
eq('fixture tone tokens', f.toneToken, CHIP_TONE_TOKEN);
for (const k of Object.keys(OVERLAY_SETTINGS)) ok(`setting ${k} namespaced`, (OVERLAY_SETTINGS as Record<string, string>)[k]!.startsWith('axf.overlay.'));

/* interface@1 takes it as a slot (open slot list) */
const iface = normalizeInterface({ design: 'fresh', slots: { overlay: 'pill-compact' } });
eq('interface slot kept', iface.slots.overlay, 'pill-compact');
eq('interface slot valid', interfaceErrors({ design: 'fresh', slots: { overlay: 'pill-compact' } }), []);

/* starters */
ok('three or more starters', starters.length >= 3);
for (const a of starters) {
  eq(`${a.id} validates`, validateAsset(a).errors, []);
  eq(`${a.id} engine errors`, overlayErrors(a.data), []);
  eq(`${a.id} normalises to the fixture`, normalizeOverlay(a.data), f.starters[a.id]);
  eq(`${a.id} normalising is stable`, normalizeOverlay(f.starters[a.id]), f.starters[a.id]);
  ok(`${a.id} chips ≤ ${OVERLAY_LIMITS.chipsMax}`, a.data.pill.chips.length <= OVERLAY_LIMITS.chipsMax);
  ok(`${a.id} no product name`, !/activex/i.test(JSON.stringify(a)));
}
eq('starter ids in fixture', Object.keys(f.starters).sort(), starters.map((a) => a.id).sort());

/* normalising (lenient) */
for (const [k, c] of Object.entries(f.normalize as Record<string, { raw: unknown; out: OverlayData }>)) {
  eq(`normalize ${k}`, normalizeOverlay(c.raw), c.out);
  eq(`normalize ${k} idempotent`, normalizeOverlay(c.out), c.out);
  eq(`normalized ${k} has no errors`, overlayErrors(c.out), []);
}
{
  const c = normalizeOverlay(f.normalize.clamped.raw);
  eq('clamped chips: dupes, bad ids dropped', c.pill.chips.map((x) => x.id), ['a', 'b']);
  eq('clamped chip label cut', c.pill.chips[0]!.label.length, OVERLAY_LIMITS.labelMax);
  eq('bad tone → success', c.pill.chips[0]!.tone, 'success');
  eq('title cut', c.pill.title.length, 40);
  eq('log lines capped', c.log.maxLines, OVERLAY_LIMITS.logLinesMax);
  eq('strip lines floor', c.strip.maxLines, OVERLAY_LIMITS.stripLinesMin);
  eq('strip ms ceiling', c.strip.lineMs, OVERLAY_LIMITS.stripMsMax);
  eq('opacity ceiling', c.opacity, 1);
  ok('size min ≤ max', c.size.minWidth <= c.size.maxWidth && c.size.minHeight <= c.size.maxHeight);
  ok('mini inside size', c.mini.width.min >= c.size.minWidth && c.mini.width.max <= c.size.maxWidth && c.mini.width.default >= c.mini.width.min && c.mini.width.default <= c.mini.width.max);
  eq('too many chips cut', normalizeOverlay(f.normalize['too-many-chips'].raw).pill.chips.length, OVERLAY_LIMITS.chipsMax);
  eq('opacity two decimals', normalizeOverlay(f.normalize['opacity-rounds'].raw).opacity, 0.57);
eq('opacity floor', normalizeOverlay({ opacity: 0.01 }).opacity, OVERLAY_LIMITS.opacityMin);
}

/* errors (strict): the TS export and the CLI's .mjs are the same function */
for (const [k, c] of Object.entries(f.errors as Record<string, { raw: unknown; errors: string[] }>)) {
  eq(`errors ${k}`, overlayErrors(c.raw), c.errors);
  eq(`errors ${k} (cli)`, cliOverlayErrors(c.raw), c.errors);
}
eq('starter has no errors', f.errors.starter.errors, []);
ok('bad-chips reports every field', f.errors['bad-chips'].errors.length >= 14);
{
  const raw = { pill: { chips: 'none' }, log: { show: true }, strip: { show: true }, mini: { defaultOpen: false } };
  eq('validateAsset carries the engine errors', validateAsset({ $axf: 'asset@1', type: 'overlay', id: 'xx', name: 'x', version: '1', data: raw }).errors, overlayErrors(raw));
  eq('validateAsset: envelope rules first', validateAsset({ $axf: 'asset@1', type: 'overlay', id: 'xx', name: 'x', version: '1', data: { pill: {}, log: {}, strip: {}, mini: {} } }).errors, ['data.pill.chips is required', 'data.log.show is required', 'data.strip.show is required', 'data.mini.defaultOpen is required', 'data.pill.chips must be a list']);
}

/* geometry */
for (const g of f.geometry as { name: string; data: string; screen: { width: number; height: number }; wanted: { width: number; height: number } | null; positionIn: { x: number; y: number } | null; max: unknown; size: unknown; mini: unknown; position: unknown }[]) {
  const d = f.starters[g.data] as OverlayData;
  eq(`max ${g.name}`, maxSize(d, g.screen), g.max);
  eq(`size ${g.name}`, clampSize(d, g.wanted, g.screen), g.size);
  eq(`mini ${g.name}`, miniSize(d, g.wanted, g.screen), g.mini);
  eq(`position ${g.name}`, clampPosition(g.positionIn, g.size as { width: number; height: number }, g.screen), g.position);
  const s = g.size as { width: number; height: number };
  const p = g.position as { x: number; y: number };
  ok(`${g.name} fits the screen`, s.width <= g.screen.width && s.height <= g.screen.height && p.x + s.width <= g.screen.width && p.y + s.height <= g.screen.height && p.x >= 0 && p.y >= 0);
  const m = g.mini as { width: number; height: number };
  ok(`${g.name} mini within size`, m.width <= s.width || m.width <= (g.max as { width: number }).width);
}
for (const c of f.canDrag as { data: string; setting: string | null; out: boolean }[]) eq(`canDrag ${c.data} ${c.setting}`, canDrag(f.starters[c.data], c.setting), c.out);
eq('canDrag boolean setting', canDrag(f.starters['quiet-strip'], false), true);

/* log */
const lines = (f.log.lines as { text: string; confidence: number | null; tag: string; at: number; ref: string }[]);
eq('log line text cut', lines[3]!.text.length, OVERLAY_LIMITS.lineTextMax);
eq('log tag cut', lines[3]!.tag.length, OVERLAY_LIMITS.tagMax);
eq('confidence clamped high', lines[3]!.confidence, 1);
eq('confidence clamped low', lines[4]!.confidence, 0);
eq('confidence rounded', lines[0]!.confidence, 0.9123);
eq('no confidence stays null', lines[2]!.confidence, null);
eq('logLine rebuilds the same', logLine(lines[0]!.text, lines[0]!.confidence, lines[0]!.tag, lines[0]!.at, lines[0]!.ref), lines[0]);
for (const [i, t] of (f.log.texts as { shown: string; hidden: string; confidence: string }[]).entries()) {
  eq(`text ${i}`, logLineText(lines[i]!, true), t.shown);
  eq(`text hidden ${i}`, logLineText(lines[i]!, false), t.hidden);
  eq(`confidence text ${i}`, confidenceText(lines[i]!.confidence), t.confidence);
}
eq('text 0', f.log.texts[0].shown, 'swipe up · 91.2% · fired');
eq('text 2 (no confidence, no tag)', f.log.texts[2].shown, 'wave');
for (const c of f.log.trim as { maxLines: number; out: string[] }[]) eq(`trim ${c.maxLines}`, trimLog(lines, c.maxLines).map((l) => l.text.slice(0, 8)), c.out);
eq('trim 0 keeps one', f.log.trim.find((c: { maxLines: number }) => c.maxLines === 0).out.length, 1);
eq('trim 999 keeps all', f.log.trim.find((c: { maxLines: number }) => c.maxLines === 999).out.length, lines.length);
eq('add keeps newest', lines.reduce<ReturnType<typeof addLogLine>>((acc, l) => addLogLine(acc, l, f.log.add.maxLines), []).map((l) => l.at), f.log.add.out);
eq('add kept the last five', f.log.add.out, lines.slice(1).map((l) => l.at));
for (const c of f.log.fade as { count: number; out: number[] }[]) eq(`fade ${c.count}`, Array.from({ length: c.count }, (_, i) => logLineFade(i, c.count)), c.out);
eq('newest line full', logLineFade(4, 5), 1);
eq('old lines never vanish', logLineFade(0, 50), 0.35);

/* strip */
const strip = { maxLines: 3, lineMs: 3000 };
for (const c of f.strip as { now: number; out: number[]; next: number | null }[]) {
  eq(`strip ${c.now}`, stripLines(lines, c.now, strip).map((l) => l.at), c.out);
  eq(`strip next ${c.now}`, nextStripExpiry(lines, c.now, strip), c.next);
}
const t0 = lines[0]!.at;
eq('strip before the first line', stripLines(lines, t0 - 1, strip), []);
eq('strip at t0 shows one', stripLines(lines, t0, strip).length, 1);
eq('strip keeps the newest three', stripLines(lines, t0 + 3500, strip).map((l) => l.at), [t0 + 2000, t0 + 3100, t0 + 3200]);
eq('strip expires', stripLines(lines, t0 + 6200, strip), []);
eq('next null when empty', nextStripExpiry(lines, t0 + 9000, strip), null);
eq('next ≥ 16', nextStripExpiry(lines, t0 + 1199, { maxLines: 6, lineMs: 1200 }), 16);
eq('next is the oldest shown line', nextStripExpiry(lines, t0 + 2999, strip), 501);
eq('stripOne', stripLines(lines, f.stripOne.now, f.stripOne.strip).map((l) => l.at), f.stripOne.out);
eq('stripOne next', nextStripExpiry(lines, f.stripOne.now, f.stripOne.strip), f.stripOne.next);

/* chips */
const detector = f.starters['detector-panel'] as OverlayData;
for (const [k, c] of Object.entries(f.chips as Record<string, { states: Record<string, boolean>; out: unknown }>)) eq(`chips ${k}`, resolveChips(detector.pill.chips, c.states), c.out);
eq('chip off text', f.chips.none.out[0].text, 'Idle');
eq('chip on text', f.chips['armed-on'].out[0].text, 'Armed');
eq('chip on tone', f.chips['armed-on'].out[0].tone, 'success');
eq('chip off tone', f.chips.none.out[1].tone, 'muted');
eq('unknown chip state ignored', f.chips['mic-off-armed-on'].out.length, 2);
for (const c of f.setChip as { states: Record<string, boolean | undefined>; id: string; on: boolean; out: unknown }[]) eq(`setChip ${c.id} ${c.on}`, setChip(c.states, c.id, c.on), c.out);
eq('setChip drops undefined', f.setChip[1].out, { armed: false });
for (const t of CHIP_TONES) ok(`tone token ${t}`, chipToneToken(t) === CHIP_TONE_TOKEN[t]);
eq('unknown tone → text', chipToneToken('pink'), 'text');

/* settings over the asset */
for (const [k, c] of Object.entries(f.withSettings as Record<string, { data: string; values: Record<string, string>; out: OverlayData }>)) {
  eq(`withSettings ${k}`, overlayWithSettings(f.starters[c.data], c.values), c.out);
  eq(`withSettings ${k} still valid`, overlayErrors(c.out), []);
}
eq('no settings = the asset', f.withSettings.none.out, f.starters['pill-compact']);
eq('settings all: opacity', f.withSettings.all.out.opacity, 0.5);
eq('settings all: lock', f.withSettings.all.out.positionLock, true);
eq('settings all: log on', f.withSettings.all.out.log.show, true);
eq('settings all: strip off', f.withSettings.all.out.strip.show, false);
eq('settings all: mini size', [f.withSettings.all.out.mini.width.default, f.withSettings.all.out.mini.height.default], [300, 200]);
eq('settings junk = the asset', f.withSettings.junk.out, f.starters['pill-compact']);
eq('settings clamped size', [f.withSettings.clamped.out.mini.width.default, f.withSettings.clamped.out.mini.height.default], [f.starters['pill-compact'].mini.width.max, f.starters['pill-compact'].mini.height.min]);
eq('settings clamped opacity', f.withSettings.clamped.out.opacity, 1);

/* parsing */
for (const c of f.parse.size as { raw: string; out: unknown }[]) eq(`parseSize ${JSON.stringify(c.raw)}`, parseSize(c.raw), c.out);
for (const c of f.parse.position as { raw: string; out: unknown }[]) eq(`parsePosition ${JSON.stringify(c.raw)}`, parsePosition(c.raw), c.out);
eq('serializeSize', serializeSize({ width: 10.4, height: 20.6 }), f.parse.serialize.size);
eq('serializePosition', serializePosition({ x: -3.5, y: 2.49 }), f.parse.serialize.position);
eq('size round trip', parseSize(serializeSize({ width: 300, height: 200 })), { width: 300, height: 200 });
eq('zero size is junk', parseSize('0,10'), null);
eq('negative position parses', parsePosition('-10,5'), { x: -10, y: 5 });

if (fails.length) { console.error(`check-overlay: ${fails.length} of ${n} checks failed\n - ${fails.join('\n - ')}`); process.exit(1); }
console.log(`check-overlay: ${n} checks passed`);
