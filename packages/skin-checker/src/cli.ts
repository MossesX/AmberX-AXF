/**
 * `axf skin …`: the skin checker's CLI. Run through bin/skin-check.mjs (which picks Node's type stripping or tsx).
 *
 *   axf skin list                                   every skin and design package with its last score
 *   axf skin check <skin> [--cached] [--json]       run the checker (or show the last result); exit 1 when it fails
 *   axf skin check --all [--json] [--out <file>]    every skin; exit 1 when any fails
 *   axf skin fix <skin> <issueId…> [--json]         apply those fixes
 *   axf skin fix <skin> --all [--json]              apply every fix
 *       --in-place                                  rewrite the repo's asset files instead of the console's copies
 *   axf skin settings [--json]                      the threshold settings
 *   axf skin settings set <key> <value> [--json]    one setting (contrast.text 7, rules.palette.sprawl off)
 *   axf skin settings reset [--json]
 *   axf skin open [<skin>] [<issueId>]              the checker panel's deep link (the console opens it via console_show)
 *   axf skin call <action> ['<json args>']          machine form the console's REST routes use; prints one JSON line
 *
 * Exit codes: 0 pass / done, 1 the skin (or any skin, with --all) does not pass, 2 usage or load error.
 */
import { writeFileSync } from 'node:fs';
import { SKIN_CHECK_EXIT_FAIL, SKIN_CHECK_CATEGORY_LABEL, SKIN_CHECK_CATEGORIES, type SkinCheckResult } from './contract.ts';
import { call, type CoreAnswer } from './core.ts';

const USAGE = `usage: axf skin list | check <skin>|--all [--cached] [--json] [--out file] | fix <skin> <issueId…>|--all [--in-place] [--json]
       | settings [set <key> <value> | reset] [--json] | open [<skin>] [<issueId>] | call <action> ['<json>']`;

function out(s: string): void { process.stdout.write(`${s}\n`); }
function err(s: string): void { process.stderr.write(`${s}\n`); }

function printResult(r: SkinCheckResult): void {
  out(`${r.skin.name} (${r.skin.id}): ${r.score}/100, grade ${r.grade}, ${r.pass ? 'passes' : 'FAILS'} (min ${r.settings.minScore}${r.settings.failOnError ? ', any error fails' : ''})`);
  out(`  ${r.counts.error} errors, ${r.counts.warning} warnings, ${r.counts.info} info; ${r.fixable} fixable`);
  for (const c of SKIN_CHECK_CATEGORIES) {
    const list = r.issues.filter((i) => i.category === c);
    if (!list.length) continue;
    out(`  ${SKIN_CHECK_CATEGORY_LABEL[c]} (-${r.byCategory[c].penalty})`);
    for (const i of list) out(`    ${i.severity.padEnd(7)} ${i.message}${i.fix ? `  [fix: ${i.fix.label}]` : ''}\n            ${i.id}`);
  }
  for (const s of r.skipped) out(`  skipped ${s.rule}: ${s.reason}`);
}

export function main(argv: string[]): number {
  const json = argv.includes('--json');
  const flag = (f: string) => argv.includes(f);
  const optVal = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
  const [cmd, ...rest] = pos;
  const opts = { inPlace: flag('--in-place') };
  const fail = (a: CoreAnswer & { ok: false }) => { if (json) out(JSON.stringify(a)); else err(`${a.code}: ${a.message}`); return 2; };

  switch (cmd) {
    case 'call': {
      const [action, raw] = rest;
      let args: Record<string, unknown> = {};
      try { args = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { out(JSON.stringify({ ok: false, code: 'invalid', message: 'args must be JSON' })); return 2; }
      out(JSON.stringify(call(action ?? '', args, opts)));
      return 0;
    }
    case 'list': {
      const a = call('skins', {}, opts);
      if (!a.ok) return fail(a);
      if (json) { out(JSON.stringify(a)); return 0; }
      for (const s of a.skins as { id: string; name: string; kind: string; fixed: boolean; last: { score: number; grade: string; pass: boolean } | null }[]) {
        out(`${s.id.padEnd(28)} ${s.kind.padEnd(15)} ${s.last ? `${String(s.last.score).padStart(3)} ${s.last.grade} ${s.last.pass ? 'pass' : 'FAIL'}` : '  - not checked'}${s.fixed ? '  (fixed copy)' : ''}`);
      }
      return 0;
    }
    case 'check': {
      if (flag('--all')) {
        const a = call('check_all', {}, opts);
        if (!a.ok) return fail(a);
        const file = optVal('--out');
        if (file) writeFileSync(file, `${JSON.stringify(a, null, 2)}\n`);
        if (json) out(JSON.stringify(a));
        else for (const r of a.results as SkinCheckResult[]) out(`${r.skin.id.padEnd(28)} ${String(r.score).padStart(3)} ${r.grade} ${r.pass ? 'pass' : 'FAIL'}  ${r.counts.error}E ${r.counts.warning}W ${r.counts.info}I`);
        return a.pass ? 0 : SKIN_CHECK_EXIT_FAIL;
      }
      const skin = rest[0];
      if (!skin) { err(USAGE); return 2; }
      const a = call(flag('--cached') ? 'state' : 'check', { skin }, opts);
      if (!a.ok) return fail(a);
      const r = a.result as SkinCheckResult;
      if (json) out(JSON.stringify(a)); else printResult(r);
      return r.pass ? 0 : SKIN_CHECK_EXIT_FAIL;
    }
    case 'fix': {
      const [skin, ...ids] = rest;
      if (!skin || (!flag('--all') && !ids.length)) { err(USAGE); return 2; }
      const a = flag('--all') ? call('fix_all', { skin }, opts) : call('fix', { skin, issues: ids }, opts);
      if (!a.ok) return fail(a);
      if (json) { out(JSON.stringify(a)); return 0; }
      const ap = a.applied as { writes: { token: { type: string; id: string; path: string }; value: unknown }[]; fixed: string[]; unfixable: string[]; files: string[] };
      const before = a.before as { score: number };
      const r = a.result as SkinCheckResult;
      out(`fixed ${ap.fixed.length}${ap.unfixable.length ? `, ${ap.unfixable.length} without a fix` : ''}; score ${before.score} → ${r.score} (${r.grade}, ${r.pass ? 'passes' : 'fails'})`);
      for (const w of ap.writes) out(`  ${w.token.type}:${w.token.id}/${w.token.path} = ${JSON.stringify(w.value)}`);
      for (const f of ap.files) out(`  wrote ${f}`);
      return 0;
    }
    case 'settings': {
      const [sub, key, value] = rest;
      const a = sub === 'set' ? (key === undefined || value === undefined ? null : call('settings_set', { key, value }, opts))
        : sub === 'reset' ? call('settings_reset', {}, opts)
          : sub === undefined || sub === 'get' ? call('settings_get', {}, opts) : null;
      if (!a) { err(USAGE); return 2; }
      if (!a.ok) return fail(a);
      if (json) { out(JSON.stringify(a)); return 0; }
      const flat = a.flat as Record<string, unknown>;
      const changed = new Set(a.changed as string[]);
      for (const [k, v] of Object.entries(flat)) out(`${k.padEnd(28)} ${String(v)}${changed.has(k) ? '  (changed)' : ''}`);
      for (const [r, v] of Object.entries((a.settings as { rules: Record<string, string> }).rules)) out(`rules.${r.padEnd(22)} ${v}  (changed)`);
      return 0;
    }
    case 'open': {
      const a = call('open', { skin: rest[0] ?? '', issue: rest[1] ?? '' }, opts);
      if (!a.ok) return fail(a);
      out(json ? JSON.stringify(a) : String(a.target));
      return 0;
    }
    default:
      err(USAGE);
      return 2;
  }
}

// a closed pipe (`| head`) ends the output quietly
process.stdout.on('error', () => {});
process.exitCode = main(process.argv.slice(2));
