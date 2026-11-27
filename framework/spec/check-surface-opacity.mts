/**
 * Surface transparency tokens (build transparency-token-works-every-dialog, Nov 13 2026): every dialog, settings window,
 * panel, menu, toolbar and banner reads its own --fx-opacity-<kind>; default 1 = opaque; below 1 it frosts the backdrop.
 *   npx -y tsx framework/spec/check-surface-opacity.mts
 * Kotlin twin deferred (spec/PORTING.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACE_KINDS, SURFACE_OPACITY_DEFAULT, styleThemeVars, surfaceField, surfaceThemeVars, surfaceVars } from '../core/engines/theme';
import { defaultSettings } from '../core/engines/windows';
import { surfaceFindings } from '../cli/surface-rule.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let n = 0;
const fail: string[] = [];
const ok = (c: boolean, m: string) => { n++; if (!c) fail.push(m); };

// engine: defaults, clamping, the backdrop only below 1
ok(SURFACE_OPACITY_DEFAULT === 1, 'default is fully opaque');
ok(SURFACE_KINDS.join() === 'dialog,settings,panel,menu,toolbar,banner', 'the six surface kinds');
ok(surfaceField('settings') === 'opacitySettings' && surfaceField('dialog') === 'opacityDialog', 'style-theme field names');
const def = surfaceVars('dialog', undefined);
ok(def['--fx-opacity-dialog'] === '1' && def['--fx-backdrop-dialog'] === 'none', 'unset = 1, no backdrop filter');
const low = surfaceVars('settings', 0.6);
ok(low['--fx-opacity-settings'] === '0.6' && low['--fx-backdrop-settings'] === 'blur(var(--fx-blur))', 'below 1 = see-through + frosted');
ok(surfaceVars('menu', 3)['--fx-opacity-menu'] === '1' && surfaceVars('menu', -1)['--fx-opacity-menu'] === '0', 'clamped to 0..1');
ok(surfaceVars('panel', Number.NaN)['--fx-opacity-panel'] === '1', 'junk = default');
ok(Object.keys(surfaceThemeVars(null)).length === SURFACE_KINDS.length * 2, 'two variables per kind');

// every shipped style theme emits all of them
const style = JSON.parse(readFileSync(join(ROOT, 'framework/assets/style-theme/glass-pro.json'), 'utf8')).data;
const vars = styleThemeVars({ ...style, opacityDialog: 0.5 });
for (const k of SURFACE_KINDS) ok(`--fx-opacity-${k}` in vars && `--fx-backdrop-${k}` in vars, `style theme emits ${k}`);
ok(vars['--fx-opacity-dialog'] === '0.5' && vars['--fx-opacity-settings'] === '1', 'a theme value reaches its own surface only');

// stylesheet: every surface root reads its token, the root declares the defaults
const css = readFileSync(join(ROOT, 'framework/ui/axf.css'), 'utf8');
for (const k of SURFACE_KINDS) ok(css.includes(`--fx-opacity-${k}: 1;`) && css.includes(`--fx-backdrop-${k}: none;`), `axf.css declares ${k} defaults`);
for (const [sel, k] of [['.fx-dialog {', 'dialog'], ['.fx-window {', 'settings'], ['.fx-card {', 'panel'], ['.fx-popover {', 'menu'], ['.fx-toolbar {', 'toolbar'], ['.fx-menubar {', 'toolbar'], ['.fx-banner {', 'banner']] as const) {
  const at = css.indexOf(sel);
  const body = css.slice(at, css.indexOf('}', at));
  ok(at >= 0 && body.includes(`var(--fx-opacity-${k})`) && body.includes(`var(--fx-backdrop-${k})`), `${sel} reads opacity + backdrop of ${k}`);
}
ok(surfaceFindings(css).length === 0, 'axf.css passes the surface rule');

// s3 (Brett: "how come I can't see the transparency of a settings interface dialog?"): a settings interface is a tab
// group inside a floating window; the tab group must not paint an opaque layer over the window's own surface
ok(/\.fx-window \.fx-tabgroup \{ background: transparent; \}/.test(css), 'tab group inside a window draws no background of its own');
ok(/\.fx-window \.fx-tabgroup__bar \{[^}]*var\(--fx-opacity-settings\)/.test(css), 'window tab bar reads the settings token');
ok(surfaceFindings('.fx-tabgroup { background: var(--fx-surface) }').length === 1, 'an opaque tab group is caught');
const settingsLib = readFileSync(join(ROOT, 'framework/libs/settings/index.tsx'), 'utf8') + readFileSync(join(ROOT, 'framework/libs/settings/levels.tsx'), 'utf8');
for (const c of ['.axf-settings__levelbar{', '.axf-settings__navlist{', '.axf-settings__gbody{', '.axf-levels__col{']) {
  const line = settingsLib.split('\n').find((l) => l.trimStart().startsWith(c) && l.includes('background:')) ?? '';
  ok(line.includes('var(--fx-opacity-panel)'), `settings panel ${c.slice(0, -1)} reads the panel token`);
}

// the check itself
ok(surfaceFindings('.fx-dialog { background: var(--fx-surface); }').length === 1, 'opaque dialog background is caught');
ok(surfaceFindings('.a .fx-window:hover,\n.b { background-color: var(--fx-surface2) }').length === 1, 'any selector part, background-color too');
ok(surfaceFindings('.fx-card::before { background: var(--fx-accent) } .fx-card__head { background: var(--fx-surface) }').length === 0, 'pseudo-elements and child parts are not surfaces');
ok(surfaceFindings('[data-fx-card=\'outline\'] .fx-card { background: transparent }').length === 0, 'transparent is fine');
ok(surfaceFindings('/* .fx-dialog { background: red } */').length === 0, 'comments ignored');

// per instance: a window's own background (absent = follow the theme)
ok(!('surface' in defaultSettings()) || defaultSettings().surface == null, 'new windows follow the theme');

// Token Control: tokens.style lists every field
const control = JSON.parse(readFileSync(join(ROOT, 'framework/schemas/control.json'), 'utf8'));
const text = JSON.stringify(control);
for (const k of SURFACE_KINDS) ok(text.includes(`"${surfaceField(k)}"`), `control.json lists ${surfaceField(k)}`);

if (fail.length) { console.error(`✗ surface opacity: ${fail.length}/${n} failed\n  ${fail.join('\n  ')}`); process.exit(1); }
console.log(`✓ surface opacity: ${n} checks`);
