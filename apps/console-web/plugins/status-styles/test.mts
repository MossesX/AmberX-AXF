/** Status styles: the pure part. `npx -y tsx apps/console-web/plugins/status-styles/test.mts` */
import * as C from './web/core.ts';

let n = 0;
const ok = (v: unknown, what: string) => { n += 1; if (!v) throw new Error(`FAILED: ${what}`); };

/* the shipped library */
ok(C.BUILT_IN.length >= 60, 'a big library of presets');
ok(new Set(C.BUILT_IN.map((p) => p.id)).size === C.BUILT_IN.length, 'preset ids are unique');
ok(new Set(C.BUILT_IN.map((p) => p.name)).size === C.BUILT_IN.length, 'preset names are unique (they are what the lists show)');
ok(C.BUILT_IN.every((p) => C.EFFECTS.includes(p.effect) && C.TONES.includes(p.tone) && C.TARGETS.includes(p.target)), 'every preset uses known picks');
ok(C.BUILT_IN.filter((p) => p.target === 'text').every((p) => C.TEXT_EFFECTS.includes(p.effect)), 'text presets use text effects');
for (const want of ['blink', 'sweep', 'pulse', 'shimmer']) ok(C.BUILT_IN.some((p) => p.effect === want && p.target === 'row'), `the library has a whole-row ${want}`);
ok(C.BUILT_IN.some((p) => p.target === 'text' && p.effect !== 'none'), 'and text-only animations');
ok(C.EFFECTS.every((e) => C.EFFECT_LABEL[e]) && C.TONES.every((t) => C.TONE_LABEL[t]) && C.DIRECTIONS.every((d) => C.DIRECTION_LABEL[d]), 'every pick has a label');
ok(C.EFFECTS.every((e) => e === 'none' || C.BUILT_IN.some((p) => p.effect === e)), 'every effect is used by a preset');

/* the shipped map */
const base = C.resolveConfig(null);
const PIPELINE = ['pending', 'splitting', 'split', 'pulling-main', 'assigning-models', 'ready', 'sending', 'building', 'build-complete', 'merging-pr', 'pr-pulling-main', 'running-ci', 'merging-main', 'landed', 'failed', 'completed', 'in-pr'];
const COMING = ['scoring-risk', 'fast-merge', 'post-merge-ci', 'rolling-back', 'rolled-back'];
for (const s of [...PIPELINE, ...COMING]) ok(base.statuses[s], `${s} has a style`);
ok(Object.values(base.statuses).every((s) => C.isBuiltIn(s.preset) && C.isBuiltIn(s.badgePreset)), 'every default points at a shipped preset');
const byId = new Map(C.BUILT_IN.map((p) => [p.id, p]));
ok(['building', 'sending', 'running-ci', 'rolling-back'].every((s) => base.statuses[s]!.animated && byId.get(base.statuses[s]!.preset)!.effect !== 'none'), 'moving statuses move, row and badge');
ok(['landed', 'failed', 'pending', 'rolled-back'].every((s) => !base.statuses[s]!.animated && byId.get(base.statuses[s]!.preset)!.effect === 'none'), 'resting statuses rest');
ok(JSON.stringify(C.savedFrom(base)) === '{}', 'nothing changed = nothing saved');

/* saved changes over the defaults */
const mine = C.resolveConfig({ rows: false, statuses: { building: { preset: 'row-blink-slow' }, 'waiting-review': { label: 'Waiting review', preset: 'row-pulse-info', animated: true }, 'BAD ID': { preset: 'x' }, landed: { preset: '<script>' } } });
ok(mine.rows === false && mine.enabled && mine.badges, 'switches');
ok(mine.statuses.building!.preset === 'row-blink-slow' && mine.statuses.building!.badgePreset === base.statuses.building!.badgePreset, 'one pick changed, the rest kept');
ok(mine.statuses['waiting-review']!.custom && mine.statuses['waiting-review']!.group === C.OWN_GROUP && mine.statuses['waiting-review']!.label === 'Waiting review', 'a status of his own');
ok(!mine.statuses['BAD ID'] && mine.statuses.landed!.preset === base.statuses.landed!.preset, 'a bad id or preset is dropped');
const back = C.savedFrom(mine);
ok(back.rows === false && back.enabled === undefined && back.statuses!.building!.preset === 'row-blink-slow' && !('badgePreset' in back.statuses!.building!) && back.statuses!['waiting-review']!.label === 'Waiting review', 'only the differences are saved');
ok(JSON.stringify(C.resolveConfig(back)) === JSON.stringify(mine), 'saved and read back is the same');
ok(C.statusGroups(mine).map((g) => g.group).join() === 'Builds,Steps,Coming statuses,Plans,Your statuses', 'groups in order');
ok(C.animatedStatuses(mine).includes('waiting-review') && !C.animatedStatuses(mine).includes('landed'), 'which badges move');
ok(C.animatedStatuses({ ...mine, badges: false }).length === 0 && C.animatedStatuses({ ...mine, enabled: false }).length === 0, 'none when badges or the plugin are off');

/* presets: cleaning */
ok(C.cleanPreset(null) === null && C.cleanPreset({ id: 'Bad Id' }) === null, 'no id, no preset');
const wild = C.cleanPreset({ id: 'my-x', name: 'a\u0000b', target: 'text', effect: 'stripes', tone: 'red; } body { display: none', speed: 99999, strength: -5, direction: 'up', tint: 'lots', dim: 500, edge: 'yes' })!;
ok(wild.effect === 'none' && wild.tone === 'accent' && wild.speed === 400 && wild.strength === 0 && wild.direction === 'normal' && wild.tint === 0 && wild.dim === 80 && wild.edge === false && wild.name === 'a b', 'anything odd is brought back to a known pick');
const own = C.allPresets([{ id: 'my-calm', name: 'Calm', target: 'row', effect: 'sweep', tone: 'success' }, { id: 'plain', name: 'Hijack' }, { id: 'my-calm', name: 'Twice' }, 'junk']);
ok(own.length === C.BUILT_IN.length + 1 && own.at(-1)!.own && own.at(-1)!.name === 'Calm' && own.find((p) => p.id === 'plain')!.name !== 'Hijack', 'own presets are added once and never replace a built-in');
ok(C.slug('  My Slow Blink!! ') === 'my-slow-blink' && C.slug('---') === '' && C.isStatusId('post-merge-ci') && !C.isStatusId('Post merge'), 'ids');

/* the stylesheet */
const css = C.buildCss(base, C.BUILT_IN);
ok(css.includes(C.rowSelector('building')) && css.includes('@keyframes axp-status-styles-row-building'), 'a moving row gets its animation');
ok(css.includes('@keyframes axp-status-styles-badge-building') && !css.includes('@keyframes axp-status-styles-badge-landed') && !css.includes('@keyframes axp-status-styles-row-landed'), 'moving badges animate, resting ones and resting rows never do');
ok(C.rowSelector('building').includes(':has([data-status="building"])') && C.rowSelector('building').includes(':not(:has('), 'the innermost row around the status');
const literals = css.replace(/\/\*.*?\*\//g, '').match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b\d+(\.\d+)?(px|rem|em|ms|s)\b/gi) ?? [];
ok(literals.length === 0, `no colour, size or time literals (${literals.slice(0, 3).join(' ')})`);
ok(!/var\([^)]*,/.test(css), 'no var() fallbacks');
ok((css.match(/animation: axp-/g) ?? []).every(() => true) && css.split('\n').filter((l) => l.includes('animation: axp-')).length > 0, 'animations are written');
{
  // every animation sits inside a reduced-motion guard, and is switched off under the framework's own mark
  let depth = 0; let guarded = true;
  for (const line of css.split('\n')) {
    if (line.startsWith('@media (prefers-reduced-motion: no-preference)')) depth = 1;
    else if (line === '}') depth = 0;
    else if (line.includes('animation: axp-') && !depth) guarded = false;
  }
  ok(guarded, 'no animation outside prefers-reduced-motion: no-preference');
  ok(css.includes(`[data-fx-motion='reduced'] ${C.rowSelector('building')} { animation: none`), 'and the framework reduced-motion mark stops it');
  ok(css.includes('@media (prefers-reduced-motion: reduce)') && css.includes('var(--fx-accent) 10%'), 'a moving row keeps a still tint under reduced motion');
}
ok(css.includes('[data-status] [data-badge-animated] { display: none; }') && /:is\(.*\[data-status="building"\].*\) \[data-badge-static\] \{ display: none; \}/.test(css), 'badge packs: animated picture for moving statuses, still one otherwise');
ok(C.buildCss({ ...base, enabled: false }, C.BUILT_IN) === '', 'off = no stylesheet');
const rowsOff = C.buildCss({ ...base, rows: false }, C.BUILT_IN);
ok(!rowsOff.includes('-row-building') && rowsOff.includes('-badge-building'), 'rows off keeps badges');
const badgesOff = C.buildCss({ ...base, badges: false }, C.BUILT_IN);
ok(badgesOff.includes('-row-building') && !badgesOff.includes('-badge-building') && !badgesOff.includes('data-badge-animated'), 'badges off keeps rows');
ok(!C.buildCss(C.resolveConfig({ statuses: { building: { preset: 'gone-preset' } } }), C.BUILT_IN).includes('-row-building'), 'a status whose preset is gone is left plain');

/* one preset */
const one = (p: Partial<C.Preset>) => C.presetCss(C.cleanPreset({ id: 'my-t', ...p })!, '.x', 'k');
ok(one({ effect: 'sweep', speed: 50 }).includes('calc(var(--fx-anim-sweep-dur) * 10)') && one({ effect: 'sweep', speed: 200 }).includes('calc(var(--fx-anim-sweep-dur) * 2.5)'), 'speed scales the duration token');
ok(one({ effect: 'sweep', direction: 'alternate' }).includes('infinite alternate') && one({ effect: 'sweep', direction: 'reverse' }).includes('infinite reverse'), 'direction');
ok(one({ effect: 'pulse', tone: 'danger', edge: true }).split('50%')[1]!.includes('inset calc(var(--fx-border-w) * 3) 0 0 var(--fx-danger)'), 'the still edge bar stays while the row pulses');
ok(one({ target: 'text', effect: 'pulse', tone: 'success' }).includes('color: color-mix(in srgb, var(--fx-success)') && !one({ target: 'text', effect: 'pulse' }).includes('box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--fx-accent) 0'), 'text only: the colour moves, not the row');
ok(one({ effect: 'none', tint: 20, bold: true, italic: true, dim: 30 }) === '.x { box-shadow: inset 0 0 0 100vmax color-mix(in srgb, var(--fx-accent) 20%, transparent); font-weight: bolder; font-style: italic; opacity: 0.7; }', 'a still preset is one plain rule');
ok(one({ effect: 'none' }) === '', 'plain = nothing written');
ok(!C.presetCss(C.cleanPreset({ id: 'my-t', effect: 'pulse' })!, '.x', 'k', false).includes('@keyframes'), 'a resting badge takes only the still look');
for (const e of C.EFFECTS) for (const t of C.TARGETS) {
  const p = C.cleanPreset({ id: 'my-t', target: t, effect: e })!;
  const d = C.draw(p);
  ok(p.effect === 'none' ? !Object.keys(d.frames).length : Object.keys(d.frames).length > 0, `${t} ${e}: ${p.effect === 'none' ? 'still' : 'has keyframes'}`);
}
const prev = C.previewCss(C.BUILT_IN);
ok(C.BUILT_IN.filter((p) => p.effect !== 'none').every((p) => prev.includes(`@keyframes axp-status-styles-preview-${p.id} `)), 'every moving preset plays in the library');

console.log(`status-styles: ${n} checks passed`);
