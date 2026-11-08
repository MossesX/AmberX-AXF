/**
 * Memory Manager model checks (pure helpers in web/model.ts): toolbar edits, find / replace, outline, ids, views, snippets
 * and wizards.  npx -y tsx apps/console-web/plugins/memory-manager/test.mts
 */
import {
  SNIPPETS, TOOLS, VIEWS, WIZARDS, codeBlock, findAll, findNext, heading, idFromLoose, insertBlock, linePrefix, link, offsetOfLine,
  outline, replaceAll, table, toggleCheck, tokens, viewOf, wizardId, wrap, type Sel,
} from './web/model.ts';

declare const process: { exit(code: number): never };
let fails = 0;
const check = (name: string, ok: boolean, detail: unknown = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(detail)}`}`); if (!ok) fails++; };
const sel = (text: string, a: number, b = a): Sel => ({ text, start: a, end: b });
const tool = (id: string) => TOOLS.find((t) => t.id === id)!.run;

// wrap
let r = wrap(sel('say hi now', 4, 6), '**');
check('bold wraps selection', r.text === 'say **hi** now' && r.text.slice(r.start, r.end) === 'hi', r);
r = wrap(r, '**');
check('bold again unwraps', r.text === 'say hi now' && r.text.slice(r.start, r.end) === 'hi', r);
r = wrap(sel('x', 1), '*');
check('empty selection = placeholder selected', r.text === 'x*text*' && r.text.slice(r.start, r.end) === 'text', r);

// headings + prefixes
r = heading(sel('one\ntwo', 5), 2);
check('heading on the cursor line only', r.text === 'one\n## two', r);
r = heading(sel('## two', 2), 2);
check('same heading again = plain', r.text === 'two', r);
r = heading(sel('# two', 2), 3);
check('other level replaces', r.text === '### two', r);
r = linePrefix(sel('a\nb\nc', 0, 5), 'bullet');
check('bullet list over lines', r.text === '- a\n- b\n- c', r);
r = linePrefix(sel(r.text, 0, r.text.length), 'bullet');
check('bullet list toggles off', r.text === 'a\nb\nc', r);
r = linePrefix(sel('a\nb', 0, 3), 'number');
check('numbered list', r.text === '1. a\n2. b', r);
r = linePrefix(sel('- a', 0, 3), 'check');
check('bullet → checklist', r.text === '- [ ] a', r);
r = linePrefix(sel('- [ ] a', 0, 7), 'bullet');
check('checklist is not a bullet (becomes bullet)', r.text === '- a', r);
r = linePrefix(sel('a', 0, 1), 'quote');
check('quote', r.text === '> a', r);
check('toggleCheck ticks and unticks', toggleCheck('x\n- [ ] a', 2) === 'x\n- [x] a' && toggleCheck('- [x] a', 1) === '- [ ] a');

// blocks
r = insertBlock(sel('para', 4), '---');
check('block gets blank lines around it', r.text === 'para\n\n---', r);
r = codeBlock(sel('', 0));
check('code block selects placeholder', r.text === '```\ncode\n```' && r.text.slice(r.start, r.end) === 'code', r);
r = table(sel('', 0));
check('table 3×2 with header rule', r.text.split('\n').length === 4 && r.text.includes('| --- | --- | --- |') && r.text.slice(r.start, r.end) === 'Column 1', r);
r = link(sel('see docs', 4, 8));
check('link selects url', r.text === 'see [docs](url)' && r.text.slice(r.start, r.end) === 'url', r);
check('every tool runs on an empty doc', TOOLS.every((t) => typeof t.run(sel('', 0)).text === 'string'));
check('tool shortcuts unique', new Set(TOOLS.filter((t) => t.key).map((t) => t.key)).size === TOOLS.filter((t) => t.key).length);
check('bold tool via list', tool('bold')(sel('ab', 0, 2)).text === '**ab**');

// find / replace
check('findAll case-insensitive', JSON.stringify(findAll('Aa aA', 'aa')) === '[[0,2],[3,5]]');
check('findAll case-sensitive', findAll('Aa aa', 'aa', { caseSensitive: true }).length === 1);
check('findNext wraps', JSON.stringify(findNext('ab ab', 'ab', 4)) === '[0,2]');
const rep = replaceAll('a.b.c', '.', '-');
check('replaceAll plain text (not a pattern)', rep.text === 'a-b-c' && rep.count === 2, rep);
check('empty query finds nothing', findAll('abc', '').length === 0);

// outline
const o = outline('# One\ntext\n## Two ##\n```\n# not a heading\n```\n### Three');
check('outline skips code fences', o.map((h) => `${h.level}${h.text}@${h.line}`).join(',') === '1One@1,2Two@3,3Three@7', o);
check('offsetOfLine', offsetOfLine('a\nbb\nc', 3) === 5);
check('tokens = ceil(len/4)', tokens('abcde') === 2 && tokens('') === 0);

// ids
check('idFromLoose keeps ids', idFromLoose('hub:amberx-axf/rules/RULES.md') === 'hub:amberx-axf/rules/RULES.md');
check('idFromLoose hub path', idFromLoose('/projects/amberx-axf/_claude/rules/RULES.md') === 'hub:amberx-axf/rules/RULES.md');
check('idFromLoose notes path', idFromLoose('/projects/_shared/_claude/notes/plans/x.md') === 'notes:plans/x.md' && idFromLoose('notes/plans/x.md') === 'notes:plans/x.md');
check('idFromLoose repo path', idFromLoose('./CLAUDE.md') === 'repo:CLAUDE.md');

// views, snippets, wizards
check('four views incl. IDE', VIEWS.map((v) => v.id).join() === 'browse,read,write,ide' && viewOf('ide').side && viewOf('nope').id === 'browse');
check('snippets have unique ids and categories', new Set(SNIPPETS.map((s) => s.id)).size === SNIPPETS.length && SNIPPETS.every((s) => s.category && s.body));
check('wizards: CLAUDE.md, rules, persona, threads, skill', ['claude-md', 'rules', 'persona', 'threads', 'skill'].every((id) => WIZARDS.some((w) => w.id === id)));
for (const w of WIZARDS) {
  for (const s of w.scopes) {
    const id = wizardId(w, s, { name: 'My Thing' });
    check(`wizard ${w.id} → ${s} makes a .md id`, /^(repo|hub):[^:]+\.md$/.test(id) && !id.includes('{'), id);
  }
  const out = w.render({ name: 'X' });
  check(`wizard ${w.id} renders text`, typeof out === 'string' && out.startsWith('') && out.includes('X'));
}
check('rules wizard on the hub', wizardId(WIZARDS.find((w) => w.id === 'rules')!, 'claude', { name: 'Deploy rules' }, '_shared') === 'hub:_shared/rules/deploy-rules.md');
check('skill wizard in the repo', wizardId(WIZARDS.find((w) => w.id === 'skill')!, 'repo', { name: 'Deploy' }) === 'repo:.claude/skills/deploy/SKILL.md');

console.log(`\n${fails ? `${fails} failed` : 'all passed'}`);
process.exit(fails ? 1 : 0);
