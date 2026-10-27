/**
 * Look tokens (engines/looktokens.ts, look@1): registry shape, only-changed storage, compact down to no space, behaviour
 * fallbacks, theme-token-only CSS. `npx -y tsx framework/spec/check-looktokens.mts`. Kotlin twin deferred (PORTING.md).
 */
import { LOOK_CATEGORIES, LOOK_LEVELS, LOOK_TOKENS, lookChanged, lookCss, lookPrefs, lookTokensAt, lookValue, normalizeLook, setLookValue } from '../core/engines/looktokens';

let n = 0;
const fail: string[] = [];
const ok = (c: boolean, m: string) => { n++; if (!c) fail.push(m); };

// registry
const ids = new Set<string>();
for (const t of LOOK_TOKENS) {
  ok(!ids.has(t.id), `${t.id}: duplicate id`); ids.add(t.id);
  ok(LOOK_LEVELS.includes(t.level), `${t.id}: level`);
  ok(LOOK_CATEGORIES.some((c) => c.id === t.category), `${t.id}: category`);
  ok(t.scopes.length > 0, `${t.id}: scopes`);
  if (t.kind === 'slider') ok(typeof t.inherit === 'number' && t.min! <= (t.inherit as number) && (t.inherit as number) <= t.max!, `${t.id}: inherit inside range`);
  if (t.kind === 'choice') ok((t.options ?? []).some((o) => o.value === t.inherit), `${t.id}: inherit is an option`);
  if (t.kind === 'switch') ok(typeof t.inherit === 'boolean', `${t.id}: switch inherit`);
}
for (const l of LOOK_LEVELS) ok(lookTokensAt(l, 'banner').length > 0 && lookTokensAt(l, 'app').length > 0, `${l}: has tokens for both scopes`);
ok(lookTokensAt('simple', 'banner').every((t) => t.level === 'simple'), 'simple shows only simple');
ok(lookTokensAt('advanced', 'banner').length >= lookTokensAt('pro', 'banner').length, 'levels grow');
ok(lookTokensAt('simple', 'app').some((t) => t.id === 'compact' && t.min === 0), 'Simple has the Compact slider down to 0');
ok(lookTokensAt('simple', 'banner').some((t) => t.id === 'compact'), 'banners: Simple has Compact');

// only changed tokens are stored
ok(JSON.stringify(normalizeLook({ compact: 100, textSize: 120, nope: 1, tone: 'own', opacity: 5 })) === JSON.stringify({ textSize: 120, opacity: 30 }), 'inherit values and unknown ids dropped, out of range clamped');
ok(JSON.stringify(normalizeLook(null)) === '{}' && JSON.stringify(normalizeLook([1])) === '{}', 'junk = nothing');
let v = setLookValue({}, 'compact', 0);
ok(v.compact === 0 && lookChanged(v) === 1, 'set compact 0');
v = setLookValue(v, 'compact', 100);
ok(!('compact' in v), 'setting the inherited value clears it');
v = setLookValue({ compact: 40 }, 'compact', null);
ok(lookChanged(v) === 0 && lookValue(v, 'compact') === 100, 'reset one token = the theme value');
ok(lookValue({}, 'tone') === 'own' && lookValue({ tone: 'danger' }, 'tone') === 'danger', 'lookValue');

// CSS
ok(lookCss({}, { scope: 'body', base: 'html', p: 'fxa', for: 'app' }) === '', 'nothing changed = no CSS');
const z = lookCss({ compact: 0 }, { scope: 'body', base: 'html', p: 'fxa', for: 'app' });
ok(z.includes('html{--fxa-space:var(--fx-space)'), 'base captures the theme');
ok(z.includes('--fx-space:calc(var(--fxa-space) * 0)') && z.includes('--fx-card-pad:calc(var(--fxa-card-pad) * 0)'), 'compact 0 = no space at all');
ok(z.includes('--fx-row-h:max(1.2em'), 'rows keep a readable floor at 0');
const all = Object.fromEntries(LOOK_TOKENS.map((t) => [t.id, t.kind === 'slider' ? t.max! : t.kind === 'switch' ? !t.inherit : (t.options ?? []).find((o) => o.value !== t.inherit)!.value]));
for (const scope of ['app', 'banner'] as const) {
  const css = lookCss(all, { scope: scope === 'app' ? 'body' : '.fx-banner-frame', base: scope === 'app' ? 'html' : 'body', p: scope === 'app' ? 'fxa' : 'fxb', for: scope });
  ok(css.length > 0, `${scope}: every token changed compiles`);
  ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(css), `${scope}: theme tokens only, no literal colours`);
}
ok(!lookCss({ tone: 'danger', launch: 'minimized' }, { scope: '.fx-banner-frame', base: 'body', p: 'fxb', for: 'banner' }), 'behaviour tokens compile to nothing');
ok(JSON.stringify(lookPrefs({ tone: 'danger', launch: 'minimized', compact: 20 })) === JSON.stringify({ tone: 'danger', launch: 'minimized' }), 'behaviour fallbacks');
ok(!lookCss({ gap: 50 }, { scope: 'body', base: 'html', p: 'fxa', for: 'app' }), 'banner-only token never reaches the app');

if (fail.length) { for (const f of fail) console.error('FAIL:', f); process.exit(1); }
console.log(`check-looktokens: ${n} checks passed`);
