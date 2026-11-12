#!/usr/bin/env node
/**
 * crew-say: a section that acts on its own (the dispatcher, landing, the merge queue, deploys, backups…) posts its key
 * events in the crew's group chat as the employee who owns it (Brett, Nov 11 2026: "Every everything has to have an
 * employee so she can communicate in the group chat").
 *
 *   node framework/cli/crew-say.mjs <section> <event> <text…> [--ref <build|pr>] [--key <dedupe key>] [--json]
 *        events: start, done, failed, blocked, waiting (for Brett). Dropped while the group chat is off; the same line
 *        is posted once per dedupe window. Never fails the caller: exit 0 unless the arguments are wrong.
 *   node framework/cli/crew-say.mjs list [--json]     every section and its owner
 *   node framework/cli/crew-say.mjs check [--json]    CI: every crewSay / crew_say / crew-say.mjs call in the repo names a
 *        section in the registry with an owner on the crew, and an event the section declares (exit 1 otherwise)
 *
 * In code: `import { crewSay } from 'framework/cli/crew-say.mjs'; crewSay('dispatcher', 'start', 'Started …', { ref })`.
 * Python plugins use the capability axf.crew-sections@1 (`say(section, event, text, ref)`), shell scripts this CLI. The
 * section id is always written out, so `check` can see it.
 *
 * The registry and the chat are found by capability (a console plugin providing service:crew-sections@1 with
 * sections.mjs), never by folder; without one every call is a no-op. AXF_CREW_SAY=off turns posting off (tests).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = fileURLToPath(import.meta.url);
export const CAPABILITY = 'service:crew-sections@1';

/** The plugin folder that provides service:crew-sections@1 and ships sections.mjs, or null. */
export function findCrew(root = ROOT) {
  const plugins = join(root, 'apps/console-web/plugins');
  if (!existsSync(plugins)) return null;
  for (const n of readdirSync(plugins).sort()) {
    const d = join(plugins, n);
    try { if (JSON.parse(readFileSync(join(d, 'plugin.json'), 'utf8')).provides?.includes(CAPABILITY) && existsSync(join(d, 'sections.mjs'))) return d; } catch { /* not a plugin */ }
  }
  return null;
}

/**
 * Post one section event as its owner. Synchronous (a child process, so callers in sync code and in folders that may
 * import only node built-ins can use the CLI the same way) and never throws: returns { posted, why }.
 */
export function crewSay(section, event, text, { ref = '', key = '', dedupeMin, env = process.env, root = ROOT } = {}) {
  if (env.AXF_CREW_SAY === 'off') return { posted: false, why: 'off (AXF_CREW_SAY)' };
  const owner = findCrew(root);
  if (!owner) return { posted: false, why: 'no crew plugin here' };
  const args = [join(owner, 'sections.mjs'), 'post', String(section), String(event), String(text ?? '').slice(0, 600), '--json'];
  if (ref) args.push('--ref', String(ref));
  if (key) args.push('--key', String(key));
  if (dedupeMin !== undefined) args.push('--dedupe-min', String(dedupeMin));
  try {
    const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, env });
    const last = String(r.stdout || '').trim().split('\n').pop();
    const j = last ? JSON.parse(last) : {};
    return j.ok ? { posted: !!j.posted, why: j.why || '', owner: j.owner } : { posted: false, why: j.error || String(r.stderr || '').trim().slice(-200) || `exit ${r.status}` };
  } catch (e) { return { posted: false, why: e.message }; }
}

// ------------------------------------------------------------------ the CI check: call sites in the repo

const CALL = /(?<![\w.$])(?:crewSay|crew_say|say_section)\(\s*(['"])([^'"]+)\1\s*,\s*(?:(['"])([^'"]+)\3)?/g;
const DYNAMIC = /(?<![\w.$]|function |def )(?:crewSay|crew_say|say_section)\(\s*(?!['")])[^\s)]/g;
const SHELL = /crew-say\.mjs["']?\s+(?:(['"])([^'"\s]+)\1|([a-z][a-z0-9-]*))\s+(?:(['"])([a-z]+)\4|([a-z]+))/g;
const SKIP = /(^|\/)(node_modules|fixtures|dist|build)\/|(^|\/)test\.(mjs|py)$|\.test\.mjs$|_test\.py$|(^|\/)tests?\//;

/** Every literal crewSay / crew_say / say_section / crew-say.mjs call in the tracked source files. */
export function scan(root = ROOT) {
  const r = spawnSync('git', ['ls-files', '*.mjs', '*.js', '*.ts', '*.py', '*.sh'], { cwd: root, encoding: 'utf8' });
  const files = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  const usages = []; const dynamic = [];
  for (const f of files) {
    if (SKIP.test(f) || resolve(root, f) === SELF) continue;
    let text = ''; try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    if (!/crewSay|crew_say|say_section|crew-say\.mjs/.test(text)) continue;
    // comment lines (#, //, * of a block) only talk about posting: blanked, line numbers kept
    text = text.split('\n').map((l) => (/^\s*(#|\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(CALL)) usages.push({ file: f, line: lineOf(m.index), section: m[2], event: m[4] ?? '' });
    for (const m of text.matchAll(DYNAMIC)) dynamic.push({ file: f, line: lineOf(m.index) });
    for (const m of text.matchAll(SHELL)) usages.push({ file: f, line: lineOf(m.index), section: m[2] ?? m[3], event: m[5] ?? m[6] ?? '' });
  }
  return { usages: usages.filter((u) => !['list', 'check'].includes(u.section)), dynamic };
}

export async function check(root = ROOT) {
  const found = scan(root);
  const owner = findCrew(root);
  if (!owner) return { ok: true, skipped: 'no crew plugin here: nothing posts', ...found, problems: [] };
  const mod = await import(pathToFileURL(join(owner, 'sections.mjs')).href);
  const problems = mod.check(found);
  return { ok: !problems.length, ...found, problems };
}

export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] ?? '' : ''; };
  const named = new Set(['--ref', '--key', '--dedupe-min']);
  const args = argv.filter((a, i) => a !== '--json' && !named.has(a) && !named.has(argv[i - 1]));
  const out = (o, t) => console.log(json ? JSON.stringify(o) : t);
  const [cmd] = args;
  if (!cmd) { console.error('usage: crew-say.mjs <section> <event> <text…> [--ref r] | list | check'); process.exitCode = 2; return; }
  if (cmd === 'check') {
    const r = await check();
    if (!r.ok) process.exitCode = 1;
    const where = [...new Set(r.usages.map((u) => u.file))];
    return out(r, r.skipped ? `crew-say check: ${r.skipped}` : r.ok ? `crew-say check: ${r.usages.length} call(s) in ${where.length} file(s), every section has an owner` : `crew-say check failed:\n${r.problems.map((p) => `  ✗ ${p}`).join('\n')}`);
  }
  if (cmd === 'list') {
    const owner = findCrew(); if (!owner) return out({ ok: true, sections: [] }, 'no crew plugin here');
    const mod = await import(pathToFileURL(join(owner, 'sections.mjs')).href);
    const b = mod.board();
    return out({ ok: true, board: b }, b.sections.map((s) => `${s.id.padEnd(16)} ${s.name}`).join('\n'));
  }
  const [section, event, ...words] = args;
  if (!event || !words.length) { console.error('usage: crew-say.mjs <section> <event> <text…>'); process.exitCode = 2; return; }
  const dm = opt('dedupe-min');
  const r = crewSay(section, event, words.join(' '), { ref: opt('ref'), key: opt('key'), dedupeMin: dm === '' ? undefined : Number(dm) });
  return out({ ok: true, ...r }, r.posted ? `posted as ${r.owner}` : `not posted: ${r.why}`);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  // a post never fails its caller; the check does fail CI
  main().catch((e) => { console.error(`crew-say: ${e.message}`); process.exitCode = process.argv[2] === 'check' ? 1 : 0; });
}
