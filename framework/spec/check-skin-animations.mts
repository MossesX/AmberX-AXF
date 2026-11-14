/**
 * Skin animations (build skin-animations-swatches-skin-switch, Nov 13 2026): behaviour-theme animation fields, this
 * app's picks over them, the colour maths, the runtime API (rt.animations / setAnimation / resetAnimations and the
 * animations.* actions), the CLI (framework/cli/animations.mjs), every shipped behaviour theme valid, and the stylesheet
 * reading only tokens with reduced motion respected. Replays framework/spec/fixtures/skin-animations.json.
 *
 *   npx -y tsx framework/spec/check-skin-animations.mts
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { animationState, behaviorErrors, behaviorStyle, setAnimationPref, withAnimationPrefs, ANIMATION_PREFS_KEY, SKIN_ANIMATIONS } from '../core/engines/behavior';
import { mixHex, shadesOf, skinSwatches, sweepOrigin } from '../core/engines/swatches';

const ROOT = join(import.meta.dirname, '../..');
let n = 0;
const fail = (m: string) => { console.error(`✗ ${m}`); process.exit(1); };
const ok = (c: unknown, m: string) => { n++; if (!c) fail(m); };
const eq = (a: unknown, b: unknown, m: string) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`); };

// fixture replay (the Kotlin twin, when ported, replays the same file)
const fx = JSON.parse(readFileSync(join(ROOT, 'framework/spec/fixtures/skin-animations.json'), 'utf8'));
const fluid = { motion: { speed: 'normal', easing: 'spring', reduced: 'system', entrance: 'scale' } };
const ripple = { motion: { swatches: 'ripple', skinSwitch: 'sweep', picker: 'pop', animSpeed: 200, animIntensity: 30 } };
eq(behaviorStyle({}), fx.style.default, 'fixture: default style');
eq(behaviorStyle(fluid), fx.style.fluid, 'fixture: fluid style');
eq(behaviorStyle(ripple), fx.style.ripple, 'fixture: ripple style');
eq(behaviorStyle(fluid, true), fx.style.reduced, 'fixture: reduced style');
eq(behaviorErrors({ motion: { swatches: 'spin', animSpeed: 9000, animIntensity: 'lots' } }), fx.errors.bad, 'fixture: errors');
eq(setAnimationPref({}, 'swatches', 'pop'), fx.prefs.set, 'fixture: set');
eq(setAnimationPref({}, 'picker', 'spin'), fx.prefs.bad, 'fixture: bad value');
eq(withAnimationPrefs(ripple, { swatches: 'wave', intensity: 80 }).motion, fx.prefs.overlay, 'fixture: overlay');
eq(animationState(ripple, { picker: 'off', speed: 50 }), fx.state.own, 'fixture: state');
eq(shadesOf('#3366CC', 5), fx.colours.shades5, 'fixture: shades');
eq(sweepOrigin({ x: 900, y: 100 }, { w: 1000, h: 800 }), fx.colours.sweepTap, 'fixture: sweep origin');

// rules
const red = behaviorStyle(fluid, true);
for (const a of SKIN_ANIMATIONS) eq(red.attrs[a.attr], 'off', `reduced motion stops ${a.key}`);
eq(behaviorStyle({ motion: { animIntensity: 0 } }).attrs['data-fx-anim-swatches'], 'off', 'intensity 0 = still');
ok(String(behaviorStyle({ motion: { animSpeed: 200 } }).vars['--fx-anim-dur']).includes('var(--fx-motion)'), 'durations scale the theme motion token');
ok(animationState(fluid, {}, true).animations.every((a) => !a.on), 'state: nothing plays under reduced motion');
eq(setAnimationPref({ swatches: 'pop' }, 'swatches', 'skin'), {}, "'skin' drops a pick");
eq(setAnimationPref({}, 'glow', 'on'), null, 'unknown key refused');
eq(mixHex('#000000', 1), '#ffffff', 'mix to white');
eq(shadesOf('#3366cc', 5)[2], '#3366cc', 'the picked colour sits in the middle of its shades');
eq(skinSwatches({ bg: '#111111', surface: '#111111', accent: '#ff0000' }), ['#111111', '#ff0000'], 'swatches skip repeats');

// every shipped behaviour theme is valid and the skins pick different animation sets
const dir = join(ROOT, 'framework/assets/behavior-theme');
const sets = new Set<string>();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const a = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  eq(behaviorErrors(a.data), [], `behaviour theme ${f} is valid`);
  const m = a.data.motion ?? {};
  sets.add(`${m.swatches}/${m.skinSwitch}/${m.picker}`);
}
ok(sets.size >= 5, 'behaviour themes carry their own animation sets');

// runtime API: state, set, reset, actions
const { AxfRuntime } = await import('../core/runtime');
const assetsDir = join(ROOT, 'framework/assets');
const assets: unknown[] = [];
for (const t of readdirSync(assetsDir)) {
  try { for (const f of readdirSync(join(assetsDir, t)).filter((x) => x.endsWith('.json'))) assets.push(JSON.parse(readFileSync(join(assetsDir, t, f), 'utf8'))); } catch { /* not a folder */ }
}
const defaults = JSON.parse(readFileSync(join(ROOT, 'framework/defaults.json'), 'utf8'));
const manifest = { $axf: 'manifest@1', app: { id: 'anim-app', name: 'anim-app', version: '0' }, framework: { version: '0.2.0', template: 'react-ts' }, targets: ['web'], defaults };
const rt = new AxfRuntime({ manifest: manifest as never, assets: assets as never, storageKey: 'anim-app' }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
eq(rt.animations().animations.map((a: { key: string }) => a.key), ['swatches', 'skinSwitch', 'picker'], 'rt.animations lists the three');
ok(rt.setAnimation('swatches', 'pop'), 'rt.setAnimation');
eq(rt.animations().animations[0].value, 'pop', 'the pick is read back');
eq(rt.settings.get(ANIMATION_PREFS_KEY), { swatches: 'pop' }, 'stored under the appearance key');
ok(!rt.setAnimation('picker', 'spin'), 'a bad value is refused');
rt.dispatch('animations.set:speed:150');
eq(rt.animations().speed, 150, 'animations.set action');
rt.dispatch('animations.off');
ok(rt.animations().animations.every((a: { on: boolean }) => !a.on), 'animations.off turns all three off');
rt.dispatch('animations.reset');
eq(rt.settings.get(ANIMATION_PREFS_KEY) ?? null, null, 'animations.reset drops every pick');
for (const id of ['animations.set', 'animations.off', 'animations.reset', 'animations.state', 'animations.open']) ok(rt.actions.get(id), `action ${id} registered`);

// CLI against a temporary hub folder
const tmp = mkdtempSync(join(tmpdir(), 'axf-anim-'));
writeFileSync(join(tmp, 'appearance.json'), '{}');
const env = { ...process.env, AXF_LOOKS_DIR: tmp, AXF_APPEARANCE_FILE: join(tmp, 'appearance.json') };
const cli = (...a: string[]) => {
  try { return JSON.parse(execFileSync('node', [join(ROOT, 'framework/cli/animations.mjs'), ...a, '--json'], { env, encoding: 'utf8' })); }
  catch (e) { return JSON.parse(String((e as { stdout?: string }).stdout ?? '{}')); } // a refused value exits 1 with its JSON answer
};
execFileSync('node', [join(ROOT, 'framework/cli/skins.mjs'), 'snapshot', 'console'], { env });
execFileSync('node', [join(ROOT, 'framework/cli/skins.mjs'), 'use', 'console', 'atelier'], { env });
eq(cli('state', 'console').result.skin, 'atelier', 'CLI state reads the skin in force');
eq(cli('set', 'console', 'skinSwitch', 'sweep').result.animations[1].value, 'sweep', 'CLI set');
eq(JSON.parse(readFileSync(join(tmp, 'axf-console.json'), 'utf8')).own.settings[ANIMATION_PREFS_KEY], { skinSwitch: 'sweep' }, 'CLI writes the look document');
eq(cli('set', 'console', 'picker', 'spin').ok, false, 'CLI refuses a bad value');
eq(cli('reset', 'console').result.prefs, {}, 'CLI reset');

// stylesheet: tokens only, reduced motion respected
const css = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');
const block = css.slice(css.indexOf('/* Skin animations'));
ok(block.includes('prefers-reduced-motion') && block.includes("[data-fx-motion='reduced']"), 'reduced motion stops the animations');
for (const m of block.matchAll(/animation:[^;]*;/g)) ok(!/\d+m?s\b/.test(m[0].replace(/var\([^)]*\)/g, '')), `animation reads duration tokens: ${m[0]}`);

console.log(`check-skin-animations: ${n} checks passed`);
