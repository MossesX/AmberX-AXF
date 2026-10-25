#!/usr/bin/env node
/** Self-test for the Claude handoff kit (core + CLI). `node apps/console-web/plugins/claude-handoff/test.mjs` (also run by test.py). */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from './handoff-core.mjs';
import { ROOT, build, hookInstalled, status, withHook, withoutHook, writeKit } from './handoff.mjs';

let ok = 0;
const check = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } ok++; console.log(`  ✓ ${msg}`); };
const tmp = (p) => mkdtempSync(join(tmpdir(), `axf-handoff-${p}-`));
console.log('claude-handoff test.mjs');

// secrets
const fake = { gh: `ghp_${'a'.repeat(36)}`, ant: `sk-ant-${'b'.repeat(30)}`, pat: `github_pat_${'c'.repeat(40)}` };
check(!core.redact(`token ${fake.gh}`).includes(fake.gh), 'GitHub token redacted');
check(!core.redact(`key=${fake.ant}`).includes(fake.ant), 'Anthropic key redacted');
check(core.redact('GITHUB_TOKEN=abcdefghijkl12345') === 'GITHUB_TOKEN=[redacted secret]', 'NAME=value secrets redacted, name kept');
check(core.redact('"Authorization": "Bearer ${AXF_TOKEN}"').includes('${AXF_TOKEN}'), 'env references stay');
check(core.redact('createApiClient (Bearer call/post/put/patch/del)') === 'createApiClient (Bearer call/post/put/patch/del)', 'prose after "Bearer" is not a token');
check(core.redact('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----') === core.REDACTED, 'private keys redacted');
for (const p of ['.env', '.env.local', 'secrets.env', 'credentials.json', 'id_ed25519', 'x.pem', '.anthropic-key', 'token']) check(core.secretLooking(p), `${p} is never copied`);
for (const p of ['CLAUDE.md', 'RULES.md', 'settings.json']) check(!core.secretLooking(p), `${p} may be copied`);

// repo sources
const repo = core.repoSources(ROOT);
const paths = repo.map((s) => s.path);
for (const p of ['CLAUDE.md', '_claude/shared/rules/RULES.md', '_claude/rules/RULES.md', '_claude/memory/decisions.md', 'project.manifest.json', 'framework/spec/PORTING.md']) check(paths.includes(p), `source: ${p}`);
check(!paths.some((p) => p.startsWith(core.KIT_DIR)), 'the kit never indexes itself');
check(!paths.some((p) => core.secretLooking(p)), 'no secret-looking source');
check(repo.find((s) => s.path === '_claude/rules/RULES.md')?.role === 'rules' && repo.find((s) => s.path === '_claude/memory/decisions.md')?.role === 'memory', 'roles: rules, memory');

// user scope from a fake home
const home = tmp('home');
mkdirSync(join(home, '.claude/commands'), { recursive: true });
mkdirSync(join(home, '.claude/projects/-root-AmberX-AXF/memory'), { recursive: true });
mkdirSync(join(home, '.claude/skills/synced/x'), { recursive: true });
mkdirSync(join(home, '.config/axhub'), { recursive: true });
writeFileSync(join(home, '.claude/CLAUDE.md'), `# me\nmy key is ${fake.ant}\n`);
writeFileSync(join(home, '.claude/commands/go.md'), 'go');
writeFileSync(join(home, '.claude/projects/-root-AmberX-AXF/memory/notes.md'), 'remember X');
writeFileSync(join(home, '.claude/skills/synced/x/SKILL.md'), 'account skill');
writeFileSync(join(home, '.claude/.env'), 'A=1');
writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ env: { GITHUB_TOKEN: fake.gh, X: '1' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: `curl -H "Authorization: Bearer ${'d1'.repeat(15)}" x` }] }] }, permissions: { allow: ['Bash(ls)'] } }));
writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { axhub: { type: 'http', url: 'https://axhub.amberxai.com/mcp?t=secret', headers: { Authorization: 'Bearer zzz' } } } }));
writeFileSync(join(home, '.anthropic-key'), fake.ant);
writeFileSync(join(home, '.config/axhub/token'), 'tok');
const m = core.collectUserScope(home, 'vps');
const mp = m.files.map((f) => f.path);
check(mp.includes('.claude/CLAUDE.md') && mp.includes('.claude/commands/go.md') && mp.includes('.claude/projects/-root-AmberX-AXF/memory/notes.md'), 'collects user CLAUDE.md, commands, auto-memory');
check(!mp.some((p) => p.includes('synced')), 'skips the account\'s synced skills');
check(!mp.some((p) => p.endsWith('.env')), 'skips .env');
check(!JSON.stringify(m).includes(fake.ant) && !JSON.stringify(m).includes(fake.gh), 'no secret value anywhere in the record');
check(m.settings.env.join() === 'GITHUB_TOKEN,X' && m.settings.hooks[0].command.includes(core.REDACTED), 'settings: env names only, hook commands redacted');
check(m.mcp[0].url === 'https://axhub.amberxai.com/mcp' && !JSON.stringify(m.mcp).includes('zzz'), 'MCP servers: name + URL, no headers or query');
check(m.secrets.includes('.anthropic-key') && m.secrets.includes('.config/axhub/token'), 'secret files listed by name only');
check(core.machineError(m) === '', 'a collected record passes the console\'s checks');
check(core.machineError({ ...m, host: '../x' }) !== '' && core.machineError({ ...m, files: [{ path: '.claude/.env', content: '' }] }) !== '' && core.machineError({ ...m, files: [{ path: '../x', content: '' }] }) !== '', 'bad host, secret file, traversal refused');

// claude.ai registry
const reg = core.defaultClaudeAi(JSON.parse(readFileSync(join(ROOT, 'project.manifest.json'), 'utf8')));
check(reg.items.some((i) => i.id === 'pending-builds' && i.url.includes('HTwGSP7HcEt5yBd3MNz2Ye')), 'seeds the Pending Builds artifact from the manifest');
check(reg.items.some((i) => i.kind === 'connector' && i.url === 'https://axhub.amberxai.com/mcp'), 'seeds the axHub connector');
check(core.claudeAiError(reg) === '', 'seed passes validation');
check(core.claudeAiError({ items: [{ id: 'X Y', kind: 'artifact' }] }) !== '' && core.claudeAiError({ items: [{ id: 'a', kind: 'nope' }] }) !== '' && core.claudeAiError({ items: [{ id: 'a', kind: 'other', url: 'http://x' }] }) !== '', 'bad id, kind, non-https link refused');

// fingerprint + diff
const fp1 = core.fingerprint({ repo, machines: { vps: m }, claudeAi: reg });
check(fp1 === core.fingerprint({ repo, machines: { vps: m }, claudeAi: reg }), 'fingerprint is stable');
check(fp1 !== core.fingerprint({ repo, machines: {}, claudeAi: reg }), 'fingerprint changes with a machine');
check(fp1 !== core.fingerprint({ repo, machines: { vps: m }, claudeAi: { ...reg, memory: 'new' } }), 'fingerprint changes with the claude.ai memory');
const d = core.diffSources([{ path: 'a', sha: '1' }, { path: 'b', sha: '2' }], [{ path: 'a', sha: '9' }, { path: 'c', sha: '3' }]);
check(d.changed.join() === 'a' && d.added.join() === 'c' && d.removed.join() === 'b' && d.count === 3, 'diff: changed, added, removed');

// the kit
const kit = core.buildKit({ root: ROOT, manifest: JSON.parse(readFileSync(join(ROOT, 'project.manifest.json'), 'utf8')), repo, machines: { vps: m }, claudeAi: { ...reg, memory: `I like short replies ${fake.gh}` }, commit: 'abc1234def5678', now: '2026-10-22T12:00:00.000Z' });
const kp = kit.files.map((f) => f.path);
for (const f of ['README.md', 'HANDOFF.md', 'PROJECT.md', 'INSTRUCTIONS.md', 'FILES.md', 'USER-SCOPE.md', 'CLAUDE-AI.md', 'SECRETS.md', 'SETUP.md', 'PROMPT.md', 'handoff.json', 'sources/claude-ai.json', 'context/CLAUDE.md', 'context/claude__shared__rules__RULES.md', 'user/vps/CLAUDE.md', 'user/vps/settings-summary.json', 'user/claude-ai/memory.md']) check(kp.includes(f), `kit has ${f}`);
const all = kit.files.map((f) => f.content).join('\n');
check(!all.includes(fake.gh) && !all.includes(fake.ant), 'no secret value in any kit file');
check(kit.prompt.includes('MossesX/AmberX-AXF') && kit.prompt.includes('_claude/handoff/HANDOFF.md') && kit.prompt.includes('abc1234def56'), 'prompt names the repo, the entry point and the commit');
check(/never invent|Never invent/i.test(kit.prompt) && kit.prompt.includes('INSTRUCTIONS.md') && kit.prompt.includes('context/'), 'prompt: secrets asked for, Project instructions + knowledge');
check(/same repo/.test(kit.prompt) && /never create a new repository, fork it/.test(kit.prompt), 'prompt: keep working on the same repo (no new repo, no fork)');
const ownFiles = kit.files.filter((f) => !f.path.startsWith('context/') && !f.path.startsWith('user/'));
check(ownFiles.every((f) => !/clon/i.test(f.content)) && !/clon/i.test(kit.prompt), `the kit's own files never talk about cloning the repo (${ownFiles.filter((f) => /clon/i.test(f.content)).map((f) => f.path).join(', ') || 'none'})`);
check(kit.prompt.length < 4000, `prompt is short enough to type/paste (${kit.prompt.length} chars)`);
const hm = JSON.parse(kit.files.find((f) => f.path === 'handoff.json').content);
check(hm.$axf === core.FORMAT && hm.fingerprint === kit.fingerprint && hm.sources.length === repo.length && hm.machines[0].host === 'vps', 'handoff.json: format, fingerprint, sources, machines');
const handoff = kit.files.find((f) => f.path === 'HANDOFF.md').content;
check(handoff.includes('`_claude/rules/RULES.md`') && handoff.includes('the repo wins'), 'HANDOFF.md routes to repo paths; the repo wins over copies');
check(kit.files.find((f) => f.path === 'SECRETS.md').content.includes('`AXF_TOKEN`'), 'SECRETS.md lists names (AXF_TOKEN from .mcp.json)');

// writing + status
const out = join(tmp('out'), 'handoff');
writeKit(kit, out);
check(existsSync(join(out, 'HANDOFF.md')) && existsSync(join(out, 'context/CLAUDE.md')), 'writeKit writes the folder');
let refused = false; try { writeKit(kit, tmp('notkit')); } catch { refused = true; }
check(refused, 'writeKit refuses a folder not named handoff');
const data = tmp('data');
const b = build(ROOT, data);
check(b.files.length > 10 && b.fingerprint, 'build() from the real repo');
const s = status(ROOT, data);
check(typeof s.current === 'boolean' && s.sources === repo.length, 'status() reports');

// hooks
const withH = withHook({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'other' }] }] } }, '/x/claude-handoff/handoff.mjs');
check(hookInstalled(withH) && withH.hooks.SessionStart.length === 2, 'hook added next to others');
check(hookInstalled(withHook(withH, '/x/claude-handoff/handoff.mjs')) && withHook(withH, '/x/claude-handoff/handoff.mjs').hooks.SessionStart.length === 2, 'installing twice keeps one');
const without = withoutHook(withH);
check(!hookInstalled(without) && without.hooks.SessionStart[0].hooks[0].command === 'other', 'remove takes only ours');

// CLI collect to a file
const recFile = join(tmp('rec'), 'm.json');
execFileSync('node', [join(ROOT, 'apps/console-web/plugins/claude-handoff/handoff.mjs'), 'collect', '--host', 'test-box', '--home', home, '--out', recFile], { env: { ...process.env, HOME: tmp('h2') } });
const rec = JSON.parse(readFileSync(recFile, 'utf8'));
check(rec.host === 'test-box' && rec.files.length >= 3, 'CLI collect --out writes a machine record');


// Handoff Session
const changes = [
  { id: 'chg-a', title: 'Running build', status: 'running', createdAt: '2026-10-24T10:00:00Z', buildRef: { kind: 'pending', id: 'x' }, branch: 'b1' },
  { id: 'chg-b', title: 'Closed one', status: 'running', closed: { at: '2026-10-24T11:00:00Z', by: 'me' } },
  { id: 'chg-c', title: 'Finished', status: 'done', result: { state: 'done' } },
  { id: 'chg-d', title: 'No result yet', createdAt: '2026-10-24T12:00:00Z' },
];
const oc = core.openChanges(changes);
check(oc.length === 2 && oc[0].id === 'chg-d' && !oc.some((e) => e.id === 'chg-b' || e.id === 'chg-c'), 'openChanges: open, unclosed, newest first');
const op = core.openPending([{ id: 'p1', status: 'complete' }, { id: 'p2', status: 'pending' }, { id: 'p3', status: 'broken' }]);
check(op.length === 2 && op[0].id === 'p3', 'openPending: drops complete, broken first');
const P = core.projectFacts(JSON.parse(readFileSync(join(ROOT, 'project.manifest.json'), 'utf8')), 'abc1234', 'main', '2026-10-25T09:00:00.000Z');
const smd = core.sessionMd({ P, now: '2026-10-25T09:00:00.000Z', changes: [...changes, { id: 'chg-s', title: `leak ${fake.gh}`, status: 'running' }], pending: [{ id: 'p2', title: 'Two', status: 'pending', model: 'opus' }], prs: [{ number: 7, title: 'PR seven', draft: true, head: 'b1' }] });
check(smd.includes('chg-a') && smd.includes('pending:x') && !smd.includes('[object Object]'), 'sessionMd lists running changes with their buildRef');
check(smd.includes('p2') && smd.includes('#7') && smd.includes('## Standing rules'), 'sessionMd has pending, PRs, rules');
check(!smd.includes(fake.gh), 'sessionMd hides secrets');
check(core.sessionPrompt(smd).includes(smd), 'sessionPrompt carries the summary');
check(core.fingerprint({ repo, machines: { vps: m }, claudeAi: reg }) === fp1, 'fingerprint unchanged without a session');
check(core.fingerprint({ repo, machines: { vps: m }, claudeAi: reg, session: smd }) !== fp1, 'fingerprint changes with a session');
const kitS = core.buildKit({ root: ROOT, manifest: JSON.parse(readFileSync(join(ROOT, 'project.manifest.json'), 'utf8')), repo, machines: {}, claudeAi: reg, session: smd, commit: 'abc1234def5678', now: '2026-10-22T12:00:00.000Z' });
check(kitS.files.some((f) => f.path === core.SESSION_FILE && f.content === smd), 'kit includes ACTIVE-THREADS.md with a session');
check(!kit.files.some((f) => f.path === core.SESSION_FILE), 'kit has no ACTIVE-THREADS.md without one');

console.log(`claude-handoff test.mjs: ${ok} checks passed`);
