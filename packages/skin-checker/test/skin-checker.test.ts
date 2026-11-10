/*
 * skin-check@1 unit tests: the engine, the score, each rule, the fixes, the colour maths and the loader, on a clean and
 * a broken fixture skin (test/fixtures) and the shipped skins.
 *   npx -y tsx packages/skin-checker/test/skin-checker.test.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKIN_CHECK_RULES, createSkinCheckEngine, gradeOf, defaultSettings, defineRule, parseIssueId, readToken, scoreIssues, skinChecker,
  subjectVars, type SkinCheckIssue, type SkinCheckSubject,
} from '../src/index.ts';
import { contrastRatio, deltaE, parseColor, passingShade, toHex } from '../src/color.ts';
import { typefaceOf } from '../src/rules/typography.ts';
import { listSkins, loadSubject } from '../src/load-skin.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0, passes = 0;
function ok(name: string, cond: boolean, detail: unknown = ''): void {
  if (cond) { passes++; return; }
  fails++;
  console.log(`✗ ${name}  ${JSON.stringify(detail)}`);
}
const fixture = (name: string): SkinCheckSubject => {
  const raw = JSON.parse(readFileSync(join(HERE, 'fixtures', `${name}.json`), 'utf8')) as Record<string, unknown>;
  delete raw._doc;
  const base = raw as unknown as Omit<SkinCheckSubject, 'vars'>;
  return { ...base, vars: subjectVars(base) };
};
const NOW = new Date('2026-11-10T12:00:00Z');
const ids = (issues: readonly SkinCheckIssue[]) => issues.map((i) => i.id);

/* ---------------- engine ---------------- */
const clean = fixture('clean');
const broken = fixture('broken');
{
  ok('every contract rule is registered once, in table order', JSON.stringify(skinChecker.rules().map((r) => r.meta.id).sort()) === JSON.stringify(SKIN_CHECK_RULES.map((r) => r.id).sort()));
  const r = skinChecker.check(clean, null, NOW);
  ok('clean: no issues', r.issues.length === 0, ids(r.issues));
  ok('clean: score 100, grade A, pass', r.score === 100 && r.grade === 'A' && r.pass, r);
  ok('clean: every rule ran, none skipped', r.rules.length === SKIN_CHECK_RULES.length && r.skipped.length === 0, r.skipped);
  ok('result envelope', r.$axf === 'skin-check@1' && r.at === NOW.toISOString() && r.skin.id === 'clean-fixture' && r.settings.$axf === 'skin-check-settings@1');
  ok('deterministic', JSON.stringify(skinChecker.check(broken, null, NOW)) === JSON.stringify(skinChecker.check(broken, null, NOW)));
  ok('compiled vars name the tokens', clean.vars['--fx-accent'] === '#1d4ed8' && clean.vars['--fx-dens-gap-md'] !== undefined && clean.vars['--fx-radius-md'] === '8px');
}
{
  const noColour = { ...clean, colorTheme: null };
  const r = skinChecker.check(noColour, null, NOW);
  const skipped = r.skipped.map((s) => s.rule).sort();
  ok('missing colour theme skips palette and contrast, no throw', JSON.stringify(skipped) === JSON.stringify(['contrast.large-text', 'contrast.text', 'contrast.ui', 'palette.near-duplicate', 'palette.sprawl']), r.skipped);
  ok('skip reason names the asset', r.skipped.every((s) => s.reason.includes('colorTheme')));
}
{
  const boom = defineRule('palette.sprawl', [], () => { throw new Error('boom'); });
  const r = createSkinCheckEngine([boom, ...skinChecker.rules()]).check(clean, null, NOW);
  ok('a throwing rule is skipped with its error; duplicates of an id register once', r.skipped.some((s) => s.rule === 'palette.sprawl' && s.reason === 'failed: boom') && !r.rules.includes('palette.sprawl'), r.skipped);
}
{
  const r = skinChecker.check(broken, { rules: { 'contrast.text': 'off', 'shape.radius': 'info' } }, NOW);
  ok('a rule switched off is skipped', r.skipped.some((s) => s.rule === 'contrast.text' && s.reason.includes('off')) && !r.issues.some((i) => i.rule === 'contrast.text'));
  ok('a severity override applies', r.issues.filter((i) => i.rule === 'shape.radius').every((i) => i.severity === 'info'));
  ok('issues sorted errors first', r.issues.findIndex((i) => i.severity !== 'error') >= r.issues.filter((i) => i.severity === 'error').length);
  ok('every issue id parses back to its rule and token', r.issues.every((i) => { const p = parseIssueId(i.id); return p?.rule === i.rule && p.token.path === i.token.path; }), ids(r.issues));
}

/* ---------------- score ---------------- */
{
  const mk = (severity: SkinCheckIssue['severity'], category: SkinCheckIssue['category'], n: number): SkinCheckIssue[] =>
    Array.from({ length: n }, (_, k) => ({ id: `x${k}`, rule: 'spacing.off-scale', category, severity, token: { type: 'sizing', id: 'a', path: `p${k}` }, value: 1, expected: '', message: '' }));
  const s = defaultSettings();
  ok('score: no issues = 100', scoreIssues([], s).score === 100);
  ok('score: weights 10 / 4 / 1', scoreIssues([...mk('error', 'contrast', 1), ...mk('warning', 'spacing', 1), ...mk('info', 'shape', 1)], s).score === 85);
  ok('score: a category caps at 40', scoreIssues(mk('error', 'contrast', 9), s).score === 60 && scoreIssues(mk('error', 'contrast', 9), s).byCategory.contrast.penalty === 40);
  ok('score: every category capped lands at 0', scoreIssues((['spacing', 'typography', 'palette', 'contrast', 'shape'] as const).flatMap((c) => mk('error', c, 4)), s).score === 0);
  ok('pass: an error fails while failOnError is on', !scoreIssues(mk('error', 'contrast', 1), s).pass && scoreIssues(mk('error', 'contrast', 1), { ...s, failOnError: false }).pass);
  ok('pass: below minScore fails', !scoreIssues(mk('warning', 'spacing', 6), s).pass && scoreIssues(mk('warning', 'spacing', 6), { ...s, minScore: 70 }).pass);
  ok('grades', [95, 90, 80, 65, 45, 10].map(gradeOf).join('') === 'AABCDF');
  const r = skinChecker.check(broken, null, NOW);
  const again = scoreIssues(r.issues, r.settings);
  ok('the engine score is scoreIssues of its issues', again.score === r.score && again.pass === r.pass && r.fixable === r.issues.filter((i) => i.fix).length);
}

/* ---------------- rules on the broken fixture ---------------- */
const r = skinChecker.check(broken, null, NOW);
const has = (id: string) => r.issues.find((i) => i.id === id);
const expectIssue = (name: string, id: string, fixValue?: unknown) => {
  const i = has(id);
  ok(`${name}: reported`, !!i, ids(r.issues));
  if (i && fixValue !== undefined) ok(`${name}: fix writes ${JSON.stringify(fixValue)}`, i.fix?.writes[0]?.value === fixValue, i.fix);
  return i;
};
// rule 1, spacing
expectIssue('spacing.off-scale padding', 'spacing.off-scale@sizing:clean-sizing/button.padX', 1);
expectIssue('spacing.off-scale height', 'spacing.off-scale@sizing:clean-sizing/field.height', 2.25);
ok('spacing.off-scale: on-scale values are not reported', !has('spacing.off-scale@sizing:clean-sizing/field.padX'));
{
  const t = skinChecker.check(clean, { 'spacing.maxDistinct': 3 }, NOW);
  ok('spacing.too-many-steps over the threshold, no fix', t.issues.some((i) => i.rule === 'spacing.too-many-steps' && !i.fix && (i.measured ?? 0) > 3), ids(t.issues));
  const tol = skinChecker.check(broken, { 'spacing.tolerance': 0.15 }, NOW);
  ok('spacing.tolerance widens the scale', !tol.issues.some((i) => i.id === 'spacing.off-scale@sizing:clean-sizing/button.padX'));
}
// rule 2, typography
expectIssue('typography.font-families display', 'typography.font-families@style-theme:clean-style/fontDisplay', broken.styleTheme!.data.fontFamily);
expectIssue('typography.font-families part', 'typography.font-families@skin:broken-fixture/parts.badge.fontFamily', 'theme');
ok('typography.font-families is an error', has('typography.font-families@style-theme:clean-style/fontDisplay')?.severity === 'error');
ok('typography.maxFamilies 4 allows four faces', !skinChecker.check(broken, { 'typography.maxFamilies': 4 }, NOW).issues.some((i) => i.rule === 'typography.font-families'));
expectIssue('typography.off-scale heading', 'typography.off-scale@typography:clean-type/headings.h1', 1.5);
expectIssue('typography.off-scale sizing', 'typography.off-scale@sizing:clean-sizing/tab.font', 0.75);
ok('typefaces fold variants', typefaceOf("'Segoe UI Variable Text', sans-serif") === typefaceOf("'Segoe UI Variable Display'") && typefaceOf("'IBM Plex Mono'") === typefaceOf("'IBM Plex Sans'") && typefaceOf('system-ui, sans-serif') === 'system' && typefaceOf("'Source Sans 3'") === 'source');
// rule 3, palette
{
  const i = expectIssue('palette.near-duplicate', 'palette.near-duplicate@color-theme:clean-colors/tokens.surface2~color-theme:clean-colors/tokens.surface', '#f1f3f5');
  ok('palette.near-duplicate is a merge into the canonical token', i?.fix?.kind === 'merge' && i.fix.into?.path === 'tokens.surface' && (i.measured ?? 9) < 2.5, i?.fix);
  ok('exact duplicates (focus = accent) are not reported', !r.issues.some((x) => x.token.path === 'tokens.focus' && x.rule === 'palette.near-duplicate'));
  const s = skinChecker.check(clean, { 'palette.maxColors': 6 }, NOW);
  ok('palette.sprawl over the threshold, no fix', s.issues.some((x) => x.rule === 'palette.sprawl' && x.measured === 12 && !x.fix), ids(s.issues));
  ok('palette.sprawl quiet at the default (12)', !skinChecker.check(clean, null, NOW).issues.some((x) => x.rule === 'palette.sprawl'));
}
// rule 4, contrast
{
  const i = expectIssue('contrast.text muted over bg', 'contrast.text@color-theme:clean-colors/tokens.muted~color-theme:clean-colors/tokens.bg');
  const shade = i?.fix?.writes[0]?.value as string;
  const bgs = ['bg', 'surface', 'surface2'].map((k) => parseColor((broken.colorTheme!.data.tokens as Record<string, string>)[k])!);
  ok('contrast fix passes over every background of the rule', !!shade && bgs.every((bg) => contrastRatio(parseColor(shade)!, bg) >= 4.5), shade);
  ok('contrast fix is the same shade on every pair of one token', new Set(r.issues.filter((x) => x.rule === 'contrast.text' && x.token.path === 'tokens.muted').map((x) => x.fix?.writes[0]?.value)).size === 1);
  expectIssue('contrast.ui warning icons', 'contrast.ui@color-theme:clean-colors/tokens.warning~color-theme:clean-colors/tokens.surface');
  const strict = skinChecker.check(clean, { 'contrast.largeText': 7 }, NOW);
  ok('contrast.large-text follows its threshold', strict.issues.some((x) => x.rule === 'contrast.large-text' && x.token.path === 'tokens.accent'), ids(strict.issues));
  ok('contrast measured is the ratio', (i?.measured ?? 0) > 2 && (i?.measured ?? 9) < 3);
}
// rule 5, shape
expectIssue('shape.radius past the limit', 'shape.radius@skin:broken-fixture/parts.progress.radius', 'theme');
expectIssue('shape.radius out of order', 'shape.radius@style-theme:clean-style/radius.lg~style-theme:clean-style/radius.md', 14);
expectIssue('shape.border off the token set', 'shape.border@skin:broken-fixture/parts.button.borderWidth~style-theme:clean-style/borderWidth', 'theme');
{
  const i = expectIssue('shape.shadow literal colour', 'shape.shadow@style-theme:clean-style/shadow.lg');
  ok('shape.shadow has no fix', !i?.fix);
  ok('shape.maxRadii 5 allows them', !skinChecker.check(broken, { 'shape.maxRadii': 5 }, NOW).issues.some((x) => x.rule === 'shape.radius' && x.token.type === 'skin'));
}

/* ---------------- fixes ---------------- */
{
  const one = skinChecker.applyFixes(broken, r, ['spacing.off-scale@sizing:clean-sizing/button.padX', 'nope@x', 'shape.shadow@style-theme:clean-style/shadow.lg']);
  ok('applyFixes: fixed and unfixable', JSON.stringify(one.fixed) === JSON.stringify(['spacing.off-scale@sizing:clean-sizing/button.padX']) && one.unfixable.length === 2, one);
  ok('applyFixes: the write lands in the subject', readToken(one.subject, { type: 'sizing', id: 'clean-sizing', path: 'button.padX' }) === 1);
  ok('applyFixes: the input subject is untouched', readToken(broken, { type: 'sizing', id: 'clean-sizing', path: 'button.padX' }) === 0.9);
  const w = skinChecker.write(broken, { token: { type: 'color-theme', id: 'clean-colors', path: 'tokens.accent' }, value: '#123456' });
  ok('write recompiles the vars', w.vars['--fx-accent'] === '#123456');
  ok('write to an asset the subject does not hold is a no-op', skinChecker.write(broken, { token: { type: 'color-theme', id: 'other', path: 'tokens.accent' }, value: '#000000' }) === broken);
  let sub = broken, res = r;
  for (let k = 0; k < 3; k++) { sub = skinChecker.applyAllFixes(sub, res).subject; res = skinChecker.check(sub, null, NOW); }
  ok('fix all: every fixable issue is gone', res.fixable === 0, ids(res.issues.filter((i) => i.fix)));
  ok('fix all: only unfixable issues remain', res.issues.every((i) => !SKIN_CHECK_RULES.find((m) => m.id === i.rule)!.fixes || i.rule === 'shape.shadow'), ids(res.issues));
  ok('fix all: the score goes up', res.score > r.score, [r.score, res.score]);
}

/* ---------------- colour ---------------- */
{
  ok('parse #rgb, #rrggbbaa, rgb(), rgba(), hsl()', toHex(parseColor('#fff')!) === '#ffffff' && parseColor('#00000080')!.a === 0.502 && toHex(parseColor('rgb(255, 0, 0)')!) === '#ff0000' && parseColor('rgba(0 0 0 / 50%)')!.a === 0.5 && toHex(parseColor('hsl(120, 100%, 25%)')!) === '#008000');
  ok('unknown colours are null', parseColor('var(--fx-text)') === null && parseColor('linear-gradient(red, blue)') === null && parseColor(4) === null);
  ok('black on white is 21:1', Math.abs(contrastRatio(parseColor('#000')!, parseColor('#fff')!) - 21) < 1e-9);
  ok('deltaE of a colour with itself is 0; black-white ~100', deltaE(parseColor('#336699')!, parseColor('#336699')!) === 0 && Math.abs(deltaE(parseColor('#000')!, parseColor('#fff')!) - 100) < 0.5);
  const s = passingShade(parseColor('#9ca3af')!, parseColor('#ffffff')!, 4.5);
  ok('passingShade reaches the target', contrastRatio(parseColor(s)!, parseColor('#fff')!) >= 4.5, s);
  ok('passingShade stays close (just past the target)', contrastRatio(parseColor(s)!, parseColor('#fff')!) < 4.8, s);
  ok('passingShade lightens on a dark background', contrastRatio(parseColor(passingShade(parseColor('#444444')!, parseColor('#111111')!, 4.5))!, parseColor('#111111')!) >= 4.5);
}

/* ---------------- loader on the shipped skins ---------------- */
{
  const all = listSkins();
  ok('the loader lists the shipped skins and design packages', all.some((s) => s.kind === 'skin') && all.some((s) => s.kind === 'design-package'), all.length);
  let crashed = 0;
  for (const s of all) {
    const got = loadSubject(s.id, { kind: s.kind });
    if (!got.subject) { crashed++; continue; }
    const res = skinChecker.check(got.subject, null, NOW);
    if (res.skipped.length) crashed++;
  }
  ok('every shipped skin loads with all its assets and runs every rule', crashed === 0, crashed);
  ok('an unknown skin is an error, not a throw', !!loadSubject('no-such-skin').error);
}

console.log(`${fails ? '✗' : '✓'} skin-checker: ${passes} passed, ${fails} failed`);
if (fails) process.exitCode = 1;
