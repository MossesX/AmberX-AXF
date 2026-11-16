#!/usr/bin/env node
/**
 * Skin animations (core/engines/animation-rules.mjs): read and change an app's animation picks over its skin, without
 * the UI. The picks live in the app's look document on the hub (`own.settings["axf.appearance.animations"]`), so open
 * apps follow through the hub's change feed, the same as Settings → Appearance → Animations.
 *
 *   node framework/cli/animations.mjs state <app> [--json]          each animation (value, the skin's, on/off), speed, intensity
 *   node framework/cli/animations.mjs set <app> <key> <value>       key: swatches | skinSwitch | picker | speed | intensity;
 *                                                                   value: an option (wave, ripple, pop, sweep, fade, fan, off),
 *                                                                   a number for speed (25-400) / intensity (0-100), or `skin`
 *   node framework/cli/animations.mjs off <app> [key]               turn one animation off (all three when none named)
 *   node framework/cli/animations.mjs reset <app>                   every animation back to the skin's
 *   node framework/cli/animations.mjs options                       the keys and the values each one takes
 *
 * In the open console the same picks are the actions animations.set:<key>:<value>, animations.off[:<key>],
 * animations.reset and animations.open (console.actions run: REST POST /api/control, MCP control, `axf control`, voice).
 * An app is its id (axf-console) or its folder (console-web), or `console`, `axhub`, `amberx`, `molly`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANIMATION_ENUMS, ANIMATION_PREFS_KEY, ANIMATION_RANGES, SKIN_ANIMATIONS, animationStateOf, setAnimationPref } from '../core/engines/animation-rules.mjs';
import { at, readLook, writeLook } from './skins.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES = { console: 'axf-console', 'console-web': 'axf-console', axhub: 'axhub-web', amberx: 'amberx-droid' };
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The motion group of the behaviour theme the skin in force carries ({} = the framework defaults). */
export function skinMotion(skinId) {
  if (!skinId || !ID.test(skinId)) return {};
  const skin = readJson(join(ROOT, 'framework/assets/skin', `${skinId}.json`));
  const behavior = skin?.data?.behaviorTheme ?? skin?.data?.assets?.['behavior-theme'];
  if (!behavior || !ID.test(behavior)) return {};
  const f = join(ROOT, 'framework/assets/behavior-theme', `${behavior}.json`);
  return existsSync(f) ? readJson(f)?.data?.motion ?? {} : {};
}

const lookOf = (app) => {
  const look = readLook(app);
  if (!look) throw new Error(`${app} has no look document on the hub yet: open it once or run skins.mjs snapshot ${app}`);
  return look;
};

const appOf = (name) => {
  const id = ALIASES[name] ?? name;
  if (!id || !ID.test(id)) throw new Error('name an app: animations.mjs state <app>');
  return id;
};

/** The animation state of one app: the skin in force, its animations and this app's picks. */
export function state(name) {
  const app = appOf(name);
  const look = readLook(app);
  const skin = look ? at(app).id ?? '' : '';
  return { app, skin, ...animationStateOf(skinMotion(skin), look?.own?.settings?.[ANIMATION_PREFS_KEY]) };
}

/** One pick for one app; `skin` drops it. Throws on a value the key does not take. */
export function set(name, key, value, by = 'animations-cli') {
  const app = appOf(name);
  const look = lookOf(app);
  const next = setAnimationPref(look.own?.settings?.[ANIMATION_PREFS_KEY], key, value);
  if (!next) throw new Error(`"${value}" isn't a value for ${key}: ${options()[key] ?? `keys are ${Object.keys(options()).join(', ')}`}`);
  const settings = { ...(look.own?.settings ?? {}) };
  if (Object.keys(next).length) settings[ANIMATION_PREFS_KEY] = next; else delete settings[ANIMATION_PREFS_KEY];
  writeLook({ ...look, app, own: { ...look.own, settings } }, by);
  return state(app);
}

export function reset(name, by = 'animations-cli') {
  const app = appOf(name);
  const look = lookOf(app);
  const settings = { ...(look.own?.settings ?? {}) };
  delete settings[ANIMATION_PREFS_KEY];
  writeLook({ ...look, app, own: { ...look.own, settings } }, by);
  return state(app);
}

export function options() {
  return {
    ...Object.fromEntries(SKIN_ANIMATIONS.map((a) => [a.key, `${ANIMATION_ENUMS[a.key].join(' | ')} | skin`])),
    speed: `${ANIMATION_RANGES.animSpeed.join('-')} (percent) | skin`,
    intensity: `${ANIMATION_RANGES.animIntensity.join('-')} | skin`,
  };
}

function print(s) {
  console.log(`${s.app}: skin ${s.skin || '(none)'} · speed ${s.speed}% · intensity ${s.intensity}${s.reduced ? ' · reduced motion' : ''}`);
  for (const a of s.animations) console.log(`  ${a.on ? '●' : '○'} ${a.label.padEnd(16)} ${a.value.padEnd(7)} ${a.own ? 'this app\'s pick' : 'the skin\'s'}${a.own ? ` (skin: ${a.skin})` : ''}`);
}

function main(argv) {
  const json = argv.includes('--json');
  const [cmd, app, key, value] = argv.filter((a) => a !== '--json');
  let out;
  if (cmd === 'state') out = state(app);
  else if (cmd === 'set') { if (!key || value === undefined) throw new Error('usage: animations.mjs set <app> <key> <value>'); out = set(app, key, value); }
  else if (cmd === 'off') { for (const k of key ? [key] : SKIN_ANIMATIONS.map((a) => a.key)) out = set(app, k, 'off'); }
  else if (cmd === 'reset') out = reset(app);
  else if (cmd === 'options') out = options();
  else { console.log('usage: animations.mjs state|set|off|reset <app> … | options  (see the header)'); process.exitCode = 2; return; }
  if (json) console.log(JSON.stringify({ ok: true, result: out }));
  else if (cmd === 'options') for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(11)} ${v}`);
  else print(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) {
    console.log(process.argv.includes('--json') ? JSON.stringify({ ok: false, error: e.message }) : e.message);
    process.exitCode = 1;
  }
}
