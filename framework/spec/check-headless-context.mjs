#!/usr/bin/env node
/**
 * check-headless-context — headless-context@1 (framework/core/headless-context.mjs, framework/cli/headless-context.mjs;
 * build brief-only-headless): the brief-only launch plan, lean hooks, brief needs, rule snippets by tag, the brief budget,
 * start tokens, the run notes the console reads, and the launcher's line protocol. No Claude call (the real before /
 * after numbers come from `headless-context.mjs measure`, see _claude/builds/reports/brief-only-headless.md).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as hc from '../core/headless-context.mjs';
import { noteRuns, parseRunNote, planLines, planRun } from '../cli/headless-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; let bad = 0;
const ok = (c, what) => { n++; if (!c) { bad++; console.error(`✗ ${what}`); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

// policy
const d = hc.policyOf();
eq([d.briefOnly, d.mcp, d.tools, d.disallowedTools, d.hooks], [true, [], ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'], ['Agent', 'Workflow'], 'quiet'], 'defaults');
const p2 = hc.policyOf({ 'headless.briefOnly': false, 'headless.mcp': 'axhub, nope', 'headless.tools': 'default', 'headless.hooks': 'weird', 'headless.briefBudgetChars': 5 });
eq([p2.briefOnly, p2.mcp, p2.tools, p2.hooks, p2.briefBudgetChars], [false, ['axhub'], 'default', 'quiet', 24000], 'settings cleaned (unknown MCP dropped, bad values = defaults)');

// plan
const plan = hc.launchPlan(d);
eq(plan.env, { CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }, 'brief-only env');
ok(plan.args.includes('--strict-mcp-config') && plan.args.includes('--disable-slash-commands'), 'strict MCP + no skills list');
const ss = plan.args.indexOf('--setting-sources'); eq(plan.args[ss + 1], '', 'no settings files (empty --setting-sources)');
ok(!plan.args.includes('--mcp-config') && !plan.mcp.length, 'no MCP by default');
ok(plan.args.every((a) => !/^--(tools|disallowedTools)$/.test(a)), 'variadic flags use the = form (they would swallow the prompt)');
ok(plan.args.includes('--tools=Bash,Read,Edit,Write,Glob,Grep') && plan.args.includes('--disallowedTools=Agent,Workflow'), 'tool set + never-given tools');
const withMcp = hc.launchPlan(d, { needs: ['axhub'], tools: ['WebFetch', 'Agent'], have: ['axhub'] });
ok(withMcp.mcp[0] === 'axhub' && withMcp.args.includes('--mcp-config'), 'the brief asks for axHub → it gets it');
ok(withMcp.args.includes('--tools=Bash,Read,Edit,Write,Glob,Grep,WebFetch'), 'brief tools added, never-given ones still out');
const noTok = hc.launchPlan(d, { needs: ['axhub'], have: [] });
ok(!noTok.mcp.length && noTok.skippedMcp[0]?.id === 'axhub', 'asked for but no token = skipped with a reason');
eq(hc.launchPlan({ ...d, briefOnly: false }).args, [], 'brief only off = the full chain, no args');
eq(hc.briefNeeds('x\nNeeds MCP: axhub, bogus\n<!-- needs-mcp: axhub -->'), ['axhub'], 'brief MCP line');
eq(hc.briefTools('Needs tools: WebFetch, NotebookEdit\nNeeds tools: none'), ['WebFetch', 'NotebookEdit'], 'brief tools line');

// lean hooks
const user = { hooks: {
  SessionStart: [{ hooks: [{ type: 'command', command: '"/root/.local/bin/claude-sync" start --quiet' }, { type: 'command', command: 'node checkin.mjs detect' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node changes.mjs hook' }] }],
  PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node activity.mjs hook', timeout: 5 }] }],
} };
const lean = hc.leanSettings([user, { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node framework/cli/builds-live.mjs sync' }] }] } }], 'quiet');
eq([lean.kept, lean.muted, lean.dropped], [1, 3, 1], 'quiet: claude-sync start dropped, context events muted, the rest kept');
ok(lean.settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('>/dev/null 2>&1; true'), 'muted = output thrown away, exit swallowed');
ok(!lean.settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('</dev/null'), 'muted hooks still get their stdin (the hook JSON)');
eq(lean.settings.hooks.PreToolUse[0], { matcher: 'Bash', hooks: [{ type: 'command', command: 'node activity.mjs hook', timeout: 5 }] }, 'tool hooks kept as they were');
eq(hc.leanSettings([user], 'none').settings, {}, 'hooks none');
eq(hc.leanSettings([user], 'all').kept, 4, 'hooks all');

// init + start
const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: ['Bash', 'Read', 'mcp__probe__ping'], mcp_servers: [{ name: 'probe', status: 'connected' }, { name: 'x', status: 'failed' }], slash_commands: ['a'], skills: [] };
eq(hc.loadedFrom(init), { model: 'claude-opus-5-5', tools: 3, mcpTools: 1, mcp: ['probe', 'x (failed)'], slashCommands: 1, skills: 0, agents: 0, plugins: 0, memory: 0 }, 'what loaded');
eq(hc.startOf({ input_tokens: 2, cache_read_input_tokens: 6091, cache_creation_input_tokens: 5106 }).tokens, 11199, 'start tokens = input + cache read + cache write');
ok(hc.startWarning(30000, d) && !hc.startWarning(11000, d), 'start warning over the level only');

// budget + rules by tag
eq(hc.briefBudget('x'.repeat(100), { briefBudgetChars: 50 }).ok, false, 'over budget');
ok(hc.briefBudget('x'.repeat(100), { briefBudgetChars: 50 }).warning.includes('100 characters'), 'budget warning names the size');
const rules = '- **Every UI change goes to UI Review (Oct 30):** submit shots. <!-- axf-plugin:ui-thing -->\n- **Tick steps** in the orchestrator. <!-- axf-build:step-ticker -->\n- **Untagged rule** stays out.';
eq(hc.taggedRules(rules).map((r) => r.tags[0]), ['ui-thing', 'step-ticker'], 'tagged bullets');
eq(hc.briefTags(`fix the ui-thing intake; tick with ${hc.COVERED_TAGS[0]}`, ['ui-thing', hc.COVERED_TAGS[0], 'other-thing']), ['ui-thing'], 'tags named (covered tags never picked)');
const cr = hc.composeRules({ brief: 'change the ui-thing submit', rulesBrief: '## Rules brief\n- core', ruleTexts: [rules] });
ok(cr.text.startsWith(hc.RULES_HEADING) && cr.text.includes('Every UI change goes to UI Review') && !cr.text.includes('Untagged') && !cr.text.includes('<!--'), 'rules block: rules brief + tagged snippet, tags stripped');
ok(hc.composeRules({ brief: `${hc.RULES_HEADING}\n- mine`, rulesBrief: 'x', ruleTexts: [rules] }).already, 'a brief with its own rules block gets nothing added');
ok(!hc.hasRules(`${hc.RULES_HEADING}\n<!-- template comment -->\n\n## Next`), 'an empty template heading is not a rules block');

// run notes (the console's build view parses the same line)
const note = 'Headless run axf-x--earl: brief only · start 11.2K tokens ($0.03) · cost $0.42 · 9 turns · 6 tools, MCP none';
eq(parseRunNote(note, 't'), { session: 'axf-x--earl', briefOnly: true, startTokens: 11200, startCostUsd: 0.03, costUsd: 0.42, at: 't', from: 'note' }, 'run note parsed');
const store = join(mkdtempSync(join(tmpdir(), 'hc-')), 'store.json');
writeFileSync(store, JSON.stringify({ builds: [{ id: 'b1', notes: [{ text: note, at: '2026-11-08' }, { text: 'other', at: '' }] }] }));
eq(noteRuns('b1', { AXF_BUILDS_STORE: store }).length, 1, 'runs from the build notes');

// CLI plan + line protocol (no Claude call)
const out = mkdtempSync(join(tmpdir(), 'hc-plan-'));
const env = { ...process.env, AXF_CLAUDE_SETTINGS_FILE: join(out, 'none.json'), HOME: out, CLAUDE_CONFIG_DIR: '', AXHUB_TOKEN: '' };
const r = planRun({ brief: 'Needs MCP: axhub\nchange the intake', out, session: 'axf-t', cwd: out, env });
const lines = planLines(r);
ok(lines.includes('arg ') && lines.includes('env CLAUDE_CODE_DISABLE_CLAUDE_MDS=1'), 'plan lines: empty arg survives, env lines');
ok(lines.some((l) => l.startsWith('warn MCP axhub')), 'MCP asked for without a token → a warning line');
ok(lines.some((l) => l.startsWith('rules ')) && readFileSync(r.files.rules, 'utf8').startsWith(hc.RULES_HEADING), 'rules file written for the launcher');
const cli = spawnSync(process.execPath, [join(HERE, '..', 'cli', 'headless-context.mjs'), 'plan', '--out', out, '--session', 'axf-t2'], { env: { ...env, AXF_BRIEF_ONLY: 'off' }, encoding: 'utf8' });
ok(cli.status === 0 && !cli.stdout.includes('env ') && cli.stdout.includes('full chain'), 'AXF_BRIEF_ONLY=off = full chain for one launch');

// the launcher wires it
const sh = readFileSync(join(HERE, '..', '..', 'deploy', 'claude-headless.sh'), 'utf8');
ok(/ctx_plan "axf-\$\{name:-run\}"/.test(sh) && /ctx_plan "\$session"/.test(sh), 'launcher plans both the tmux and the fallback run');
ok(sh.includes('"$(cat "$ctx_rules")"') && sh.includes('summary --meter'), 'launcher appends the rules block and notes the run on the build');

console.log(bad ? `✗ headless-context — ${bad} of ${n} checks failed` : `✓ headless-context — ${n} checks`);
process.exit(bad ? 1 : 0);
