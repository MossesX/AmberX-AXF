/**
 * UI-library porter — "Import" on a third-party UI library in the console.
 *
 *   importUiLibrary({ name, kitId, source, covers, dir, log })
 *
 *   1. clone     the library's sources into framework/vendor/<kitId>/ (git / local path; a maven|npm source
 *                is recorded as a coordinate and the kit wraps it as a dependency instead of a copy)
 *   2. refactor  codemod the cloned Compose/React sources to AXF tokens: hardcoded Color(0x…) literals,
 *                MaterialTheme.colorScheme.* / typography.* references, hardcoded dp radii → Axf.* tokens,
 *                writing the ported copies into the new kit module and a `tokens.map.json` you can tune
 *   3. save      a new AXF UI library: framework/android/kit-<kitId>/ (AxfUiKit + DefaultComponents
 *                overrides per covered kind, token bridge, library.json so it is installable),
 *                the ui-kit asset in framework/android/assets/ui-kit/<kitId>.json, settings.gradle.kts include
 *   4. apply     to the project open in the console (`dir`): install the kit library (manifest, gradle, App.kt,
 *                generated <Name>KitSetup.kt) and make it the app's default `ui-kit`
 *
 * Everything is deterministic and re-runnable; the report (port-report.json) lists every replacement.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLibrary } from './libraries.mjs';

const FRAMEWORK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = join(FRAMEWORK_DIR, 'android');
const VENDOR_DIR = join(FRAMEWORK_DIR, 'vendor');
const FRAMEWORK_VERSION = JSON.parse(readFileSync(join(FRAMEWORK_DIR, 'schemas/asset-types.json'), 'utf8')).frameworkVersion ?? '0.2.0';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, o) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pascal = (s) => slug(s).split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');

export const COMPONENT_KINDS = ['BUTTON', 'ICON_BUTTON', 'FAB', 'TEXT_FIELD', 'SEARCH_FIELD', 'PASSWORD_FIELD', 'SWITCH', 'CHECKBOX', 'RADIO', 'CHIP', 'SEGMENTED', 'SLIDER', 'STEPPER', 'PROGRESS', 'CARD', 'PANEL', 'LIST_ITEM', 'SECTION_HEADER', 'BADGE', 'DIVIDER', 'AVATAR', 'TOOLTIP', 'TOP_BAR', 'MENUBAR', 'TOOLBAR', 'NAV_LIST', 'NAV_RAIL', 'NAV_BOTTOM', 'NAV_TABS', 'DRAWER', 'STATUS_BAR', 'BREADCRUMBS', 'DIALOG', 'BOTTOM_SHEET', 'SIDE_SHEET', 'POPUP', 'TOAST', 'SNACKBAR', 'BANNER', 'CONTEXT_MENU', 'DROPDOWN_MENU', 'EMPTY_STATE', 'LOADING_STATE', 'ERROR_STATE', 'DATE_PICKER', 'TIME_PICKER', 'COLOR_PICKER', 'TABLE', 'CHART', 'MARKDOWN', 'CODE_EDITOR', 'RICH_TEXT', 'MEDIA_PLAYER', 'MAP'];
/** Kinds the AxfComponents table has a slot for today (the rest fall back to the default kit). */
const OVERRIDABLE = { BUTTON: 'Button', ICON_BUTTON: 'IconButton', TEXT_FIELD: 'TextField', SWITCH: 'Switch', CHECKBOX: 'Checkbox', CHIP: 'Chip', BADGE: 'Badge', SLIDER: 'Slider', CARD: 'Container', LIST_ITEM: 'ListItem', SECTION_HEADER: 'SectionHeader', DIVIDER: 'Divider' };

/* ------------------------------------------------------------------ */
/* token mapping                                                        */
/* ------------------------------------------------------------------ */

/** Material/MUI/shadcn role names → AXF color tokens. */
export const ROLE_MAP = {
  primary: 'accent', onPrimary: 'accentText', primaryContainer: 'accentSoft', onPrimaryContainer: 'text', inversePrimary: 'accent2',
  secondary: 'accent2', onSecondary: 'accent2Text', secondaryContainer: 'surface2', onSecondaryContainer: 'text',
  tertiary: 'info', onTertiary: 'onInfo', tertiaryContainer: 'infoSoft', onTertiaryContainer: 'text',
  background: 'bg', onBackground: 'text', surface: 'surface', onSurface: 'text', surfaceVariant: 'surface2', onSurfaceVariant: 'muted',
  surfaceContainer: 'surface2', surfaceContainerHigh: 'surface3', surfaceContainerLow: 'surface', surfaceContainerLowest: 'bg', surfaceContainerHighest: 'surface3', surfaceTint: 'accent',
  inverseSurface: 'inverseSurface', inverseOnSurface: 'inverseText', error: 'danger', onError: 'onDanger', errorContainer: 'dangerSoft', onErrorContainer: 'danger',
  outline: 'outline', outlineVariant: 'outlineVariant', scrim: 'scrim',
  // MUI / shadcn / Chakra names
  'primary.main': 'accent', 'primary.contrastText': 'accentText', 'secondary.main': 'accent2', 'error.main': 'danger', 'warning.main': 'warning', 'info.main': 'info', 'success.main': 'success',
  'background.default': 'bg', 'background.paper': 'surface', 'text.primary': 'text', 'text.secondary': 'muted', 'text.disabled': 'disabledText', divider: 'divider',
  foreground: 'text', card: 'surface', 'card-foreground': 'text', popover: 'surface2', 'popover-foreground': 'text', muted: 'surface2', 'muted-foreground': 'muted', destructive: 'danger', 'destructive-foreground': 'onDanger', ring: 'focus', input: 'surface2', border: 'border',
};
export const TYPE_MAP = { displayLarge: 'displayLarge', displayMedium: 'displayMedium', displaySmall: 'displaySmall', headlineLarge: 'headlineLarge', headlineMedium: 'headlineMedium', headlineSmall: 'headlineSmall', titleLarge: 'titleLarge', titleMedium: 'titleMedium', titleSmall: 'titleSmall', bodyLarge: 'bodyLarge', bodyMedium: 'bodyMedium', bodySmall: 'bodySmall', labelLarge: 'labelLarge', labelMedium: 'labelMedium', labelSmall: 'labelSmall', h1: 'displaySmall', h2: 'headlineLarge', h3: 'headlineMedium', h4: 'headlineSmall', h5: 'titleLarge', h6: 'titleMedium', body1: 'bodyLarge', body2: 'bodyMedium', subtitle1: 'titleMedium', subtitle2: 'titleSmall', caption: 'bodySmall', overline: 'labelSmall', button: 'labelLarge' };

/** Guess the AXF token a hardcoded color plays, from its HSL: used for the editable tokens.map.json. */
export function guessToken(hex) {
  const h = hex.replace(/^#|^0x/i, '').padStart(8, 'F');
  const a = parseInt(h.slice(0, 2), 16) / 255, r = parseInt(h.slice(2, 4), 16) / 255, g = parseInt(h.slice(4, 6), 16) / 255, b = parseInt(h.slice(6, 8), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d) { hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; hue = (hue * 60 + 360) % 360; }
  if (a < 0.2) return 'overlay';
  if (a < 0.7) return l > 0.5 ? 'glassTint' : 'scrim';
  if (s < 0.12) return l > 0.97 ? 'bg' : l > 0.9 ? 'surface' : l > 0.8 ? 'surface2' : l > 0.6 ? 'border' : l > 0.35 ? 'muted' : l > 0.15 ? 'surface3' : 'text';
  if (hue < 20 || hue >= 345) return s > 0.5 ? 'danger' : 'dangerSoft';
  if (hue < 65) return s > 0.5 ? 'warning' : 'warningSoft';
  if (hue < 170) return s > 0.5 ? 'success' : 'successSoft';
  if (hue < 260) return s > 0.5 ? (l > 0.6 ? 'link' : 'info') : 'infoSoft';
  return s > 0.5 ? 'accent' : 'accentSoft';
}

/* ------------------------------------------------------------------ */
/* codemod                                                              */
/* ------------------------------------------------------------------ */

const SRC = /\.(kt|kts|java|tsx?|jsx?|css|scss|py)$/;
const SKIP = /(^|\/)(\.git|build|node_modules|dist|out|\.gradle|\.idea|__pycache__)(\/|$)/;
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (SKIP.test(f)) continue;
    if (e.isDirectory()) walk(f, out); else if (SRC.test(e.name)) out.push(f);
  }
  return out;
}

/**
 * Rewrites one source file to AXF tokens. Returns { text, changes:[{kind, from, to, count}] }.
 * Kotlin/Compose: Color(0xAARRGGBB) → AxfPorted.color("…"); MaterialTheme.colorScheme.x → Axf.colors.y;
 *                 MaterialTheme.typography.x → Axf.type.y; MaterialTheme.shapes.small/medium/large → AxfPorted.shape(...);
 *                 RoundedCornerShape(N.dp) → AxfPorted.radius(N)
 * Web (ts/tsx/css): theme.palette.a.b → axf.colors.y; var(--x) & #hex in CSS → var(--axf-y)
 */
export function portSource(text, file, map) {
  const changes = [];
  const bump = (kind, from, to) => { const c = changes.find((x) => x.kind === kind && x.from === from); if (c) c.count++; else changes.push({ kind, from, to, count: 1 }); };
  const ext = extname(file);
  let out = text;
  if (/\.(kt|kts|java)$/.test(ext)) {
    out = out.replace(/Color\((0x[0-9A-Fa-f]{6,8})\)/g, (_, hex) => { const tok = map.colors[hex] ??= guessToken(hex); bump('color-literal', hex, tok); return `AxfPorted.color("${hex}", "${tok}")`; });
    out = out.replace(/MaterialTheme\.colorScheme\.(\w+)/g, (m, role) => { const tok = ROLE_MAP[role]; if (!tok) { bump('color-role-unmapped', role, role); return m; } bump('color-role', role, tok); return `Axf.colors.${tok}`; });
    out = out.replace(/MaterialTheme\.typography\.(\w+)/g, (m, st) => { const t = TYPE_MAP[st]; if (!t) return m; bump('type-role', st, t); return `Axf.type.${t}`; });
    out = out.replace(/MaterialTheme\.shapes\.(extraSmall|small|medium|large|extraLarge)/g, (_, s) => { bump('shape-role', s, s); return `AxfPorted.shape("${s}")`; });
    out = out.replace(/RoundedCornerShape\((\d+(?:\.\d+)?)\.dp\)/g, (_, n) => { bump('radius-literal', `${n}.dp`, 'radius'); return `AxfPorted.radius(${n}f)`; });
    if (changes.length && !/import ai\.amberx\.axf\.ui\.theme\.Axf\b/.test(out)) out = out.replace(/^(package [^\n]+\n)/, `$1\nimport ai.amberx.axf.ui.theme.Axf\nimport ai.amberx.axf.kit.ported.AxfPorted\n`);
  } else if (/\.(tsx?|jsx?)$/.test(ext)) {
    out = out.replace(/theme\.palette\.(\w+)\.(\w+)/g, (m, a, b) => { const tok = ROLE_MAP[`${a}.${b}`]; if (!tok) { bump('color-role-unmapped', `${a}.${b}`, `${a}.${b}`); return m; } bump('color-role', `${a}.${b}`, tok); return `axf.colors.${tok}`; });
    out = out.replace(/theme\.typography\.(\w+)/g, (m, st) => { const t = TYPE_MAP[st]; if (!t) return m; bump('type-role', st, t); return `axf.type.${t}`; });
    out = out.replace(/(['"`])#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8}|[0-9A-Fa-f]{3})\1/g, (_, q, hex) => { const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex; const tok = map.colors[`#${h}`] ??= guessToken(h.length === 8 ? h.slice(6) + h.slice(0, 6) : h); bump('color-literal', `#${hex}`, tok); return `${q}var(--axf-${tok})${q}`; });
  } else if (/\.(css|scss)$/.test(ext)) {
    out = out.replace(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/g, (_, hex) => { const h = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex; const tok = map.colors[`#${h}`] ??= guessToken(h); bump('color-literal', `#${hex}`, tok); return `var(--axf-${tok})`; });
    out = out.replace(/var\(--(?!axf-)([\w-]+)\)/g, (m, v) => { const tok = ROLE_MAP[v]; if (!tok) return m; bump('css-var', v, tok); return `var(--axf-${tok})`; });
  }
  return { text: out, changes };
}

/* ------------------------------------------------------------------ */
/* generators                                                           */
/* ------------------------------------------------------------------ */

function kitModuleFiles({ name, kitId, pkg, cls, library, version, covers, source, ported }) {
  const overrides = covers.filter((k) => OVERRIDABLE[k]).map((k) => `        // ${k}: replace the default with the ported ${library} widget (see ported/ and tokens.map.json)\n        // @Composable override fun ${OVERRIDABLE[k]}(…) = …`).join('\n');
  const dep = source.kind === 'maven' ? `    implementation("${source.coordinate}")\n` : source.kind === 'npm' ? `    // web-port library "${source.coordinate}" — add it to the React kit's package.json\n` : '';
  return {
    'build.gradle.kts': `plugins { id("axf.android.compose.library") }\ndescription = "AXF UI kit \\"${name}\\" ported from ${library}${version ? ` ${version}` : ''}"\ndependencies {\n    api(project(":axf-kernel"))\n    implementation(project(":axf-ui"))\n${dep}}\n`,
    'src/main/AndroidManifest.xml': '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n',
    [`src/main/kotlin/${pkg.replace(/\./g, '/')}/${cls}Kit.kt`]: `package ${pkg}

import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.contract.UiKitSpec
import ai.amberx.axf.ui.kit.AxfComponents
import ai.amberx.axf.ui.kit.AxfUiKit
import ai.amberx.axf.ui.kit.DefaultComponents

/**
 * ${name} — AXF UI kit ported from ${library}${version ? ` ${version}` : ''} by the console's import wizard.
 * Select it by swapping the \`ui-kit\` asset to "${kitId}". Every kind it does not cover falls back to the default kit.
 * ${ported ? `Ported sources (refactored to AXF tokens) live in ported/; the mapping is in tokens.map.json.` : `Wraps the library as a dependency; implement the overrides below with its widgets.`}
 */
public object ${cls}Kit : AxfUiKit {
    override val spec: UiKitSpec = UiKitSpec(
        "${kitId}", "${name}", "${library}", "${version}",
        covers = setOf(${covers.map((k) => `ComponentKind.${k}`).join(', ')}),
        module = "kit-${kitId}",
    )
    override val components: AxfComponents = object : DefaultComponents() {
${overrides || '        // no overridable kinds selected yet'}
    }
}
`,
    [`src/main/kotlin/${pkg.replace(/\./g, '/')}/${cls}KitModule.kt`]: `package ${pkg}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext

/** Registers [${cls}Kit] at the \`axf.ui-kits\` extension point; added to an app by \`axf install kit-${kitId}\`. */
public class ${cls}KitModule : BaseModule(ID, "${name} kit") {
    override val provides: List<Capability> = listOf(Capability("axf.ui-kit.${kitId}", "${name} UI kit"))
    override fun register(ctx: ModuleContext) { ctx.extensions.contribute(ExtensionPoints.UI_KITS, id, ${cls}Kit) }
    public companion object { public const val ID: String = "${pkg}" }
}
`,
    'src/main/kotlin/ai/amberx/axf/kit/ported/AxfPorted.kt': `package ai.amberx.axf.kit.ported

import ai.amberx.axf.ui.theme.Axf
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape

/**
 * Token bridge the codemod points ported sources at: a hardcoded literal becomes a lookup of the AXF token it was
 * mapped to (tokens.map.json), so the ported widgets follow the active theme and style pack instead of their own palette.
 */
public object AxfPorted {
    /** \`Color(0xFF…)\` → the mapped token; the literal stays as the fallback so the port renders before the map is tuned. */
    @Composable public fun color(literal: String, token: String): Color = Axf.colors.tokens[token] ?: Color(literal.removePrefix("0x").toULong(16).toLong())
    /** \`RoundedCornerShape(N.dp)\` → the nearest rung of the style pack's radius ladder. */
    @Composable public fun radius(dp: Float): Shape = when { dp <= 4f -> Axf.shapes.xsShape; dp <= 8f -> Axf.shapes.smShape; dp <= 14f -> Axf.shapes.mdShape; dp <= 22f -> Axf.shapes.lgShape; dp >= 50f -> Axf.shapes.full; else -> Axf.shapes.xlShape }
    @Composable public fun shape(role: String): Shape = when (role) { "extraSmall" -> Axf.shapes.xsShape; "small" -> Axf.shapes.smShape; "large" -> Axf.shapes.lgShape; "extraLarge" -> Axf.shapes.xlShape; else -> Axf.shapes.mdShape }
}
`,
  };
}

/* ------------------------------------------------------------------ */
/* the import                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param source {kind:'git'|'local'|'maven'|'npm', url?|path?|coordinate?, ref?}
 * @param covers ComponentKind names the kit will cover (default: every overridable kind)
 * @param dir    the project open in the console; when given, the kit is installed into it and set as default ui-kit
 */
export function importUiLibrary({ name, kitId, library, version = '', source, covers, dir, overwrite = false, log = () => {} }) {
  if (!name) throw new Error('name is required');
  kitId = slug(kitId ?? name);
  if (!kitId) throw new Error('kitId is required');
  if (!source?.kind) throw new Error('source.kind is required (git | local | maven | npm)');
  library ??= source.coordinate ?? source.url ?? source.path ?? name;
  covers = (covers?.length ? covers : Object.keys(OVERRIDABLE)).map((k) => String(k).toUpperCase()).filter((k) => COMPONENT_KINDS.includes(k));
  const cls = pascal(name);
  const pkg = `ai.amberx.axf.kit.${kitId.replace(/-/g, '')}`;
  const moduleName = `kit-${kitId}`;
  const moduleDir = join(ANDROID_DIR, moduleName);
  if (existsSync(moduleDir) && !overwrite) throw new Error(`${moduleName} already exists (pass overwrite to re-import)`);
  const report = { $axf: 'ui-port@1', name, kitId, library, version, source, covers, startedAt: new Date().toISOString(), steps: [] };

  // 1. clone
  const vendorDir = join(VENDOR_DIR, kitId);
  let ported = false;
  if (source.kind === 'git' || source.kind === 'local') {
    rmSync(vendorDir, { recursive: true, force: true });
    mkdirSync(VENDOR_DIR, { recursive: true });
    if (source.kind === 'git') {
      log(`• cloning ${source.url}`);
      execFileSync('git', ['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), source.url, vendorDir], { stdio: 'pipe' });
      rmSync(join(vendorDir, '.git'), { recursive: true, force: true });
    } else {
      const src = resolve(source.path);
      if (!existsSync(src)) throw new Error(`No such path: ${src}`);
      log(`• copying ${src}`);
      cpSync(src, vendorDir, { recursive: true, filter: (f) => !SKIP.test(f) });
    }
    ported = true;
    report.steps.push({ step: 'clone', vendorDir: relative(FRAMEWORK_DIR, vendorDir), files: walk(vendorDir).length });
  } else {
    log(`• recording ${source.kind} dependency ${source.coordinate}`);
    report.steps.push({ step: 'clone', skipped: `${source.kind} dependency, nothing to clone` });
  }

  // 2. refactor
  const map = { $axf: 'token-map@1', kit: kitId, colors: {}, roles: ROLE_MAP, typography: TYPE_MAP };
  const portedDir = join(moduleDir, 'ported');
  rmSync(moduleDir, { recursive: true, force: true });
  const totals = {};
  const files = [];
  if (ported) {
    log('• refactoring sources to AXF tokens');
    for (const f of walk(vendorDir)) {
      const { text, changes } = portSource(readFileSync(f, 'utf8'), f, map);
      const rel = relative(vendorDir, f);
      const target = join(portedDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
      if (changes.length) { files.push({ file: rel, changes }); for (const c of changes) totals[c.kind] = (totals[c.kind] ?? 0) + c.count; }
    }
    report.steps.push({ step: 'refactor', filesChanged: files.length, totals, unmapped: files.flatMap((f) => f.changes.filter((c) => c.kind.endsWith('unmapped')).map((c) => c.from)).filter((v, i, a) => a.indexOf(v) === i) });
    log(`  ${files.length} file(s) changed: ${Object.entries(totals).map(([k, v]) => `${k} ×${v}`).join(', ') || 'nothing to map'}`);
  }

  // 3. save the new AXF UI library
  log(`• saving ${moduleName}`);
  for (const [rel, text] of Object.entries(kitModuleFiles({ name, kitId, pkg, cls, library, version, covers, source, ported }))) {
    const f = join(moduleDir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text);
  }
  writeJson(join(moduleDir, 'tokens.map.json'), map);
  writeJson(join(moduleDir, 'library.json'), {
    $axf: 'library@1', id: pkg, module: moduleName, name: `${name} (UI kit)`,
    description: `UI kit ported from ${library}. Installing registers ${cls}Kit; the app selects it through the ui-kit asset.`,
    features: ['ui.kits'], dependsOn: [], manifestKey: `libraries.kit-${kitId}`,
    params: [
      { key: 'makeDefault', label: 'Make it the app\'s default UI kit', type: 'bool', default: true },
      { key: 'overrides', label: 'Kinds this kit must render even when another kit is active', type: 'list', default: [], help: 'ComponentKind names, e.g. BUTTON,CHIP' },
    ],
    install: { gradle: `implementation("ai.amberx.axf:${moduleName}:$axf")`, module: `${cls}KitModule()`, import: `${pkg}.${cls}KitModule` },
    port: { source, version, covers, ported, report: 'port-report.json' },
  });
  writeFileSync(join(moduleDir, 'README.md'), `# ${moduleName}\n\n${name}: AXF UI kit ported from ${library}${version ? ` ${version}` : ''} by the console's import wizard (\`axf import-ui\`). ${ported ? 'Sources refactored to AXF tokens live in `ported/`; tune `tokens.map.json` and rerun to re-map.' : 'Wraps the library as a dependency.'} Install into an app with \`axf install kit-${kitId}\`.\n`);
  writeJson(join(FRAMEWORK_DIR, 'android/assets/ui-kit', `${kitId}.json`), {
    $axf: 'asset@1', type: 'ui-kit', id: kitId, name, version: '0.1.0', description: `Ported from ${library}. Swap this asset in to render with the ${name} kit.`, author: 'AmberX AXF import wizard', tags: ['android', 'ported'],
    data: { kit: kitId, overrides: {} },
  });
  const settings = join(ANDROID_DIR, 'settings.gradle.kts');
  let st = readFileSync(settings, 'utf8');
  if (!st.includes(`include(":${moduleName}")`)) { st = st.trimEnd() + `\ninclude(":${moduleName}")\n`; writeFileSync(settings, st); }
  const notCovered = COMPONENT_KINDS.filter((k) => !covers.includes(k));
  for (const k of notCovered) log(`  note: ${k} has no counterpart in ${name} → apps fall back to the default AmberX kit for it`);
  report.steps.push({ step: 'save', module: relative(FRAMEWORK_DIR, moduleDir), asset: `android/assets/ui-kit/${kitId}.json`, notCovered });

  // 4. apply to the open project
  if (dir) {
    log(`• applying to ${dir}`);
    const r = installLibrary({ dir, library: pkg, params: { makeDefault: true }, log });
    const mPath = join(resolve(dir), 'axf.manifest.json');
    const m = readJson(mPath);
    m.defaults ??= {}; m.defaults['ui-kit'] = kitId;
    writeJson(mPath, m);
    const inApk = join(resolve(dir), 'app/src/main/assets/axf/axf.manifest.json');
    if (existsSync(dirname(inApk))) writeJson(inApk, m);
    // ship the ui-kit asset inside the app too, so the swap works offline
    const appAsset = join(resolve(dir), 'app/src/main/assets/axf/assets/ui-kit', `${kitId}.json`);
    if (existsSync(dirname(dirname(appAsset)))) cpSync(join(FRAMEWORK_DIR, 'android/assets/ui-kit', `${kitId}.json`), appAsset);
    report.steps.push({ step: 'apply', dir: relative(FRAMEWORK_DIR, resolve(dir)), changed: r.changed, defaultUiKit: kitId });
  }

  report.finishedAt = new Date().toISOString();
  report.files = files;
  writeJson(join(moduleDir, 'port-report.json'), report);
  return { module: moduleName, kitId, pkg, cls, dir: moduleDir, report };
}

export function listPortedKits() {
  if (!existsSync(ANDROID_DIR)) return [];
  return readdirSync(ANDROID_DIR).filter((d) => d.startsWith('kit-') && existsSync(join(ANDROID_DIR, d, 'library.json'))).map((d) => ({ module: d, ...readJson(join(ANDROID_DIR, d, 'library.json')) }));
}
