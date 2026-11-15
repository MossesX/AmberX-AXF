#!/usr/bin/env node
/**
 * Builder-rule inventory for build build-rules-tab-gate-rules-vps-owns (Brett, Nov 15 2026: "Remove everything for all the
 * builders from Claude so it don't happen twice and put them all in that plugin.").
 *
 * Pass 1 reads every rule line of CLAUDE.md, _claude/shared/rules/RULES.md and _claude/rules/RULES.md and writes
 * inventory.json next to this file: one entry per rule id, every source kept verbatim (file:line + the line's text with
 * only the list marker removed), a proposed doer (vps = the VPS does or enforces it by itself; session = the Claude
 * session has to do it) and a kind (mechanical = a checker, hook or fixer can do or verify it; judgement = it needs
 * reasoning). Nothing is deleted from the rules files here; the migration (framework/cli/build-rules-migrate.mjs) reads
 * this inventory and must keep every entry.
 *
 *   node _claude/builds/reports/build-rules-tab-gate-rules-vps-owns/inventory-build.mjs          write inventory.json
 *   node _claude/builds/reports/build-rules-tab-gate-rules-vps-owns/inventory-build.mjs --check  fail when it is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const OUT = join(HERE, 'inventory.json');
const CHECK = process.argv.includes('--check');

/** Which lines of each file are rule lines: bullets inside the named sections, plus named paragraphs. */
const SOURCES = [
  { file: 'CLAUDE.md', sections: ['## Conventions & decisions', '## Working with Brett (same in every MossesX repo)'], paragraphs: [10, 12, 14] },
  { file: '_claude/shared/rules/RULES.md', sections: ['## Before building anything', '## Code must conform to the asset system', '## Projects', '## How to work with him', '## Memory, rules and decisions', '## Repos, servers, credentials', '## Sessions'] },
  { file: '_claude/rules/RULES.md', sections: ['*'] },
];

/**
 * file:line → [id, doer, kind, applies]. applies: builds = binds a build session or the build pipeline; interactive =
 * only a chat / voice / Claude Code session with Brett present; all = both. Lines missing here still land in the
 * inventory (auto id, session / judgement, annotated: false) so no rule is lost.
 */
const A = {
  // CLAUDE.md
  'CLAUDE.md:10': ['claude-settings-first', 'vps', 'mechanical', 'all'],
  'CLAUDE.md:12': ['fix-it-yourself', 'session', 'judgement', 'all'],
  'CLAUDE.md:14': ['threads-log', 'vps', 'mechanical', 'all'],
  'CLAUDE.md:105': ['ui-asset-tokens', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:106': ['ui-asset-tokens', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:107': ['toolbars', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:108': ['plugin-controls', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:109': ['themed-transparency', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:110': ['console-size-tokens', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:111': ['build-options-switches', 'session', 'judgement', 'builds'],
  'CLAUDE.md:112': ['project-manifest', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:113': ['asset-types-source-of-truth', 'session', 'judgement', 'builds'],
  'CLAUDE.md:114': ['cross-port-fixtures', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:115': ['kernel-pure-kotlin', 'session', 'judgement', 'builds'],
  'CLAUDE.md:116': ['interop-adapters', 'session', 'judgement', 'builds'],
  'CLAUDE.md:117': ['react-port-engine-compatible', 'session', 'judgement', 'builds'],
  'CLAUDE.md:118': ['change-framework-not-baked', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:119': ['one-builds-store', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:120': ['build-origin-verbatim', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:121': ['approve-deny-in-console', 'vps', 'mechanical', 'all'],
  'CLAUDE.md:122': ['ui-review-options', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:123': ['build-priority-tag', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:124': ['builds-live', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:125': ['feature-status-tracker', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:126': ['shipped-features', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:127': ['assigned-agent', 'vps', 'mechanical', 'all'],
  'CLAUDE.md:128': ['follow-amber', 'session', 'judgement', 'interactive'],
  'CLAUDE.md:129': ['console-control-targets', 'session', 'mechanical', 'builds'],
  'CLAUDE.md:130': ['agent-cap', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:131': ['worker-accounts', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:132': ['patches-retired', 'session', 'judgement', 'builds'],
  'CLAUDE.md:133': ['model-per-step', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:134': ['no-secrets', 'session', 'mechanical', 'all'],
  'CLAUDE.md:135': ['github-app-tokens', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:148': ['phone-readable', 'session', 'judgement', 'all'],
  'CLAUDE.md:149': ['model-per-step', 'vps', 'mechanical', 'builds'],
  'CLAUDE.md:150': ['shared-memory', 'session', 'judgement', 'all'],
  'CLAUDE.md:151': ['no-secrets', 'session', 'mechanical', 'all'],
  'CLAUDE.md:152': ['github-account', 'session', 'judgement', 'all'],
  'CLAUDE.md:153': ['coolify-apps', 'session', 'judgement', 'builds'],
  'CLAUDE.md:154': ['axhub-tools', 'session', 'judgement', 'all'],
  // _claude/shared/rules/RULES.md
  'RULES.md:7': ['claude-settings-first', 'vps', 'mechanical', 'all'],
  'RULES.md:8': ['fix-it-yourself', 'session', 'judgement', 'all'],
  'RULES.md:9': ['models-opus-fable-only', 'vps', 'mechanical', 'builds'],
  'RULES.md:10': ['model-per-step', 'vps', 'mechanical', 'builds'],
  'RULES.md:11': ['model-upgrade-approval', 'vps', 'mechanical', 'builds'],
  'RULES.md:12': ['build-origin-verbatim', 'vps', 'mechanical', 'builds'],
  'RULES.md:13': ['check-pending-list', 'session', 'judgement', 'all'],
  'RULES.md:14': ['plan-for-later', 'session', 'judgement', 'interactive'],
  'RULES.md:15': ['queue-clash-check', 'session', 'judgement', 'builds'],
  'RULES.md:16': ['no-fable-rebuilds', 'vps', 'judgement', 'builds'],
  'RULES.md:17': ['load-rules-go-pass', 'vps', 'mechanical', 'all'],
  'RULES.md:18': ['axhub-reason', 'session', 'mechanical', 'all'],
  'RULES.md:19': ['no-model-pick-for-questions', 'session', 'judgement', 'interactive'],
  'RULES.md:20': ['one-agent-no-subagents', 'session', 'judgement', 'all'],
  'RULES.md:21': ['one-chat-per-task', 'session', 'judgement', 'interactive'],
  'RULES.md:22': ['orchestrator-first', 'session', 'judgement', 'interactive'],
  'RULES.md:23': ['one-builds-store', 'vps', 'mechanical', 'builds'],
  'RULES.md:24': ['change-log', 'vps', 'mechanical', 'builds'],
  'RULES.md:25': ['ui-review-submit', 'vps', 'mechanical', 'builds'],
  'RULES.md:26': ['ui-review-options', 'session', 'mechanical', 'builds'],
  'RULES.md:27': ['shots-not-review', 'session', 'mechanical', 'builds'],
  'RULES.md:28': ['shots-group-name', 'vps', 'mechanical', 'builds'],
  'RULES.md:29': ['ui-review-item-schema', 'vps', 'mechanical', 'builds'],
  'RULES.md:30': ['sync-my-chats', 'session', 'judgement', 'interactive'],
  'RULES.md:31': ['follow-amber', 'session', 'judgement', 'interactive'],
  'RULES.md:32': ['record-every-session', 'vps', 'mechanical', 'all'],
  'RULES.md:35': ['ui-asset-tokens', 'session', 'mechanical', 'builds'],
  'RULES.md:36': ['toolbars', 'session', 'mechanical', 'builds'],
  'RULES.md:37': ['chrome-assets', 'session', 'mechanical', 'builds'],
  'RULES.md:40': ['project-manifest', 'vps', 'mechanical', 'builds'],
  'RULES.md:41': ['project-manifest', 'vps', 'mechanical', 'builds'],
  'RULES.md:42': ['project-claude-sync', 'session', 'judgement', 'builds'],
  'RULES.md:45': ['phone-readable', 'session', 'judgement', 'all'],
  'RULES.md:46': ['wait-until-continue', 'session', 'judgement', 'interactive'],
  'RULES.md:47': ['ask-with-cards', 'session', 'judgement', 'interactive'],
  'RULES.md:50': ['shared-memory', 'session', 'judgement', 'all'],
  'RULES.md:51': ['save-rules-to-claude', 'session', 'judgement', 'interactive'],
  'RULES.md:52': ['sync-holds-ask', 'session', 'judgement', 'interactive'],
  'RULES.md:53': ['hub-delete-veto', 'session', 'mechanical', 'all'],
  'RULES.md:56': ['github-account', 'session', 'judgement', 'all'],
  'RULES.md:57': ['coolify-apps', 'session', 'judgement', 'builds'],
  'RULES.md:58': ['axhub-tools', 'session', 'judgement', 'all'],
  'RULES.md:59': ['veto-send-once', 'session', 'judgement', 'all'],
  'RULES.md:60': ['merge-queue-only', 'vps', 'mechanical', 'builds'],
  'RULES.md:61': ['pr-only', 'vps', 'mechanical', 'builds'],
  'RULES.md:62': ['push-via-amberx', 'vps', 'mechanical', 'all'],
  'RULES.md:63': ['deny-first-screen', 'vps', 'mechanical', 'all'],
  'RULES.md:64': ['dns-self', 'session', 'judgement', 'all'],
  'RULES.md:65': ['no-secrets', 'session', 'mechanical', 'all'],
  'RULES.md:68': ['assigned-agent', 'vps', 'mechanical', 'all'],
  'RULES.md:69': ['session-mirror', 'session', 'judgement', 'interactive'],
  'RULES.md:70': ['session-in-progress', 'vps', 'mechanical', 'all'],
  'RULES.md:71': ['no-chores', 'session', 'judgement', 'all'],
  'RULES.md:72': ['broken-banner', 'session', 'judgement', 'all'],
  // _claude/rules/RULES.md
  'rules/RULES.md:6': ['check-pending-list', 'session', 'judgement', 'all'],
  'rules/RULES.md:7': ['project-manifest', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:8': ['shared-data-hub', 'session', 'judgement', 'builds'],
  'rules/RULES.md:9': ['ui-asset-tokens', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:10': ['plugin-controls', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:11': ['cross-port-fixtures', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:12': ['build-options-switches', 'session', 'judgement', 'builds'],
  'rules/RULES.md:13': ['app-defaults', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:14': ['plugin-settings-subtab', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:15': ['plugin-lifecycle', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:16': ['editor-sync', 'session', 'judgement', 'builds'],
  'rules/RULES.md:17': ['plugin-manager-engine', 'session', 'judgement', 'builds'],
  'rules/RULES.md:18': ['no-fable-rebuilds', 'vps', 'judgement', 'builds'],
  'rules/RULES.md:19': ['rebuild-report', 'session', 'judgement', 'builds'],
  'rules/RULES.md:20': ['rebuild-shots', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:21': ['orchestrator-tracks', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:22': ['merge-queue-only', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:23': ['builds-live', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:24': ['build-profiles', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:25': ['small-steps', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:26': ['android-on-hold', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:27': ['change-log', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:28': ['embed-one-banner', 'session', 'judgement', 'builds'],
  'rules/RULES.md:29': ['banners-settings', 'session', 'judgement', 'builds'],
  'rules/RULES.md:30': ['embed-skip', 'session', 'judgement', 'builds'],
  'rules/RULES.md:31': ['change-log', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:32': ['change-log', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:33': ['plugin-built-with', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:34': ['expansion-care', 'session', 'judgement', 'builds'],
  'rules/RULES.md:35': ['no-console-repo', 'session', 'judgement', 'all'],
  'rules/RULES.md:36': ['hub-badge-red', 'session', 'judgement', 'builds'],
  'rules/RULES.md:37': ['threads-log', 'vps', 'mechanical', 'all'],
  'rules/RULES.md:38': ['carry-on-block', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:39': ['attached-snap', 'session', 'judgement', 'builds'],
  'rules/RULES.md:40': ['toolbars', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:41': ['patches-retired', 'session', 'judgement', 'builds'],
  'rules/RULES.md:42': ['settings-level-toolbar', 'session', 'judgement', 'builds'],
  'rules/RULES.md:43': ['everything-is-an-asset', 'session', 'judgement', 'builds'],
  'rules/RULES.md:44': ['recurring-agents', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:45': ['shared-assets', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:46': ['skins', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:47': ['skin-coverage', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:48': ['model-upgrade-approval', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:49': ['chrome-assets', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:50': ['model-upgrade-approval', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:51': ['fable-auto-upgrade', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:52': ['glossary-catalog', 'vps', 'mechanical', 'builds'],
  'rules/RULES.md:53': ['notify-registry', 'session', 'mechanical', 'builds'],
  'rules/RULES.md:54': ['build-pipeline', 'vps', 'mechanical', 'builds'],
};

/** Short titles for the ids (the inventory's own words; every source line stays verbatim beside them). */
const TITLES = {
  'claude-settings-first': 'Read Claude settings first and follow them', 'fix-it-yourself': 'Fix what is broken yourself; ask only when it needs Brett', 'threads-log': 'Threads log in the repo, read on load and kept current',
  'ui-asset-tokens': 'Every colour, size, spacing, font, radius and border comes from asset tokens', 'toolbars': 'Every toolbar is a Toolbars plugin toolbar with role="toolbar" and an aria-label', 'plugin-controls': 'Plugin and library UIs use framework controls and theme tokens only',
  'themed-transparency': 'Transparency comes from --fx-opacity-* tokens', 'console-size-tokens': 'Console sizes are tokens', 'build-options-switches': 'Build options are --switches from one registry, off by default',
  'project-manifest': 'Every project has a validated manifest; nothing loads without one', 'asset-types-source-of-truth': 'asset-types.json is the single source of truth for asset types', 'cross-port-fixtures': 'Change a reference engine, then regenerate the fixtures',
  'kernel-pure-kotlin': 'The Android kernel is pure Kotlin', 'interop-adapters': 'The kernel never knows a protocol; exposure is default-deny', 'react-port-engine-compatible': 'The React/TS port stays engine-compatible',
  'change-framework-not-baked': 'Change the framework, never the baked copies', 'one-builds-store': 'One builds store, every write versioned', 'build-origin-verbatim': "Every build carries Brett's verbatim words",
  'approve-deny-in-console': 'Approve and Deny stay in the console; no session decides', 'ui-review-options': 'Every UI Review submission ships at least 3 options, each an asset', 'build-priority-tag': 'Every build has a priority tag',
  'builds-live': 'Every step reaches main at once (builds-live)', 'feature-status-tracker': 'Feature status and build queue updated, then tracker.mjs', 'shipped-features': 'Every feature is a row in the Shipped features ledger (build-hook)',
  'assigned-agent': 'Every session works as the agent Brett assigns', 'follow-amber': 'Follow Amber: console_show whenever the console is mentioned', 'console-control-targets': 'New UI registers console-control targets',
  'agent-cap': 'Agent cap: slots for headless agents, heavy steps through agent-slots heavy', 'worker-accounts': 'Headless jobs run on worker accounts', 'patches-retired': 'Patches and Build Pilot are retired; never bring them back',
  'model-per-step': 'The orchestrator pins each step to Fable or Opus', 'no-secrets': 'No secrets in repos, logs, chat or data', 'github-app-tokens': 'GitHub tokens come from the GitHub App broker',
  'phone-readable': 'Replies to Brett are phone-readable, result first', 'shared-memory': '_claude/ and the repo are the shared memory', 'github-account': 'GitHub account MossesX; repos exist before a push; commit often',
  'coolify-apps': 'New web apps go behind Coolify', 'axhub-tools': "Use axHub's tools instead of asking for credentials", 'models-opus-fable-only': 'Opus or Fable only, never Sonnet or Haiku',
  'model-upgrade-approval': 'Model upgrades need Brett (while the setting is on); downgrades run', 'check-pending-list': 'Check the pending build list before building', 'plan-for-later': '"Put it in a plan for later" is a Plan Studio plan',
  'queue-clash-check': 'Check the queue for clashes; build related items together', 'no-fable-rebuilds': 'Claude decides when a step runs on Fable; no parked Fable rebuilds', 'load-rules-go-pass': 'Load the rules and threads from axHub first, or stop (go pass)',
  'axhub-reason': 'Every axHub call that changes something carries a reason', 'no-model-pick-for-questions': 'Questions need no model pick', 'one-agent-no-subagents': 'One agent, no sub-agents or fan-outs',
  'one-chat-per-task': 'One chat per task', 'orchestrator-first': 'Ask for a build profile and add the build to the orchestrator first', 'change-log': 'Every build and change is logged in the Codebase changes log with estimates, steps and result',
  'ui-review-submit': 'Every UI change goes to UI Review (desktop and phone shots) before the PR is ready', 'shots-not-review': 'Screenshots not for approval go to Screenshots', 'shots-group-name': 'Screenshots go in a named group',
  'ui-review-item-schema': 'Everything in UI Review is a ui-review-item@1', 'sync-my-chats': '"Sync my chats" writes claude.ai chats to the hub', 'record-every-session': 'Every session is recorded',
  'chrome-assets': 'Every tab group, toolbar, banner and nav menu is an asset with a settings interface', 'project-claude-sync': 'Every project has _claude/ synced with the hub', 'wait-until-continue': '"Wait until I say continue" means wait',
  'ask-with-cards': 'Ask Brett with tap-to-pick cards', 'save-rules-to-claude': 'Save every rule, preference and decision to _claude/', 'sync-holds-ask': 'A held sync file: ask which copy to keep',
  'hub-delete-veto': 'Deleting hub files is a veto call', 'veto-send-once': 'Veto calls: send once with a reason and keep building', 'merge-queue-only': 'Only the merge queue (the lander) merges',
  'pr-only': 'Every change reaches main through a PR up to date with main', 'push-via-amberx': 'Push notifications come from the AmberX Android app', 'deny-first-screen': 'Deny is on the first screen of every notice',
  'dns-self': 'DNS: do it yourself and log it', 'session-mirror': 'Chat and voice sessions post what they do to their mirror', 'session-in-progress': 'Every active session shows as in progress',
  'no-chores': "Don't hand Brett chores", 'broken-banner': 'Broken = a banner item with a fix', 'shared-data-hub': 'Shared data is on the hub; change it through the CLI, console or MCP',
  'app-defaults': 'Every app gets a landing screen and a settings interface', 'plugin-settings-subtab': 'Plugin settings are a sub-tab of Settings → Plugins, with a Plugin Manager entry', 'plugin-lifecycle': 'Every plugin can be removed completely (install.mjs + uninstall.mjs)',
  'editor-sync': 'UI-editing plugins: last save wins, fresh on focus', 'plugin-manager-engine': 'The Plugin Manager runs on plugin-inventory@1', 'rebuild-report': 'Every rebuild ends with a differences report',
  'rebuild-shots': 'Every rebuild gets a log entry with before/after screenshots', 'orchestrator-tracks': 'The Build orchestrator tracks every build; steps ticked as they finish', 'build-profiles': 'Builds belong to the active build profile',
  'small-steps': 'Big builds are split into small steps', 'android-on-hold': 'All framework Android work is on hold; twins are deferred gaps in PORTING.md', 'embed-one-banner': 'One banner on screen (embed@1)',
  'banners-settings': 'One Banners settings interface', 'embed-skip': "Plugins a host makes unneeded aren't loaded", 'plugin-built-with': 'One instance per plugin, builtWith recorded',
  'expansion-care': 'Extraordinary care for expansion: placeholders, open registries', 'no-console-repo': 'AmberX-AXF is private; no separate console repo yet', 'hub-badge-red': 'The axHub badge is red unless settings come live from axHub',
  'carry-on-block': 'Unfinished work can be carried on from another account', 'attached-snap': 'Attached things snap, never overlap', 'settings-level-toolbar': 'Every settings interface has a level toolbar',
  'everything-is-an-asset': 'Everything in the UI is an asset; a new asset type when none fits', 'recurring-agents': 'Recurring work goes to hired agents', 'shared-assets': 'The look comes from axHub only; every app ships every shareable asset',
  'skins': 'Skins: every app has its own look with Restore to default', 'skin-coverage': 'Skins cover every asset type at any scope', 'fable-auto-upgrade': 'No Fable approvals: a step that needs Fable is set to Fable and runs there',
  'glossary-catalog': 'The orchestrator updates the glossary, index and catalog on every build', 'notify-registry': 'Every notification is in the one registry', 'build-pipeline': 'The build pipeline: Pending → Queue → Building, started only by the dispatcher',
};

/**
 * Pass 2: the rules a build gets from somewhere other than the rules files. Each entry names a file, a line (or a
 * from..to range, joined with spaces) and the rule id it is a source of; the text is read from the file so it stays
 * verbatim and --check notices drift. `part` picks one bullet of a JSON string (rules-briefs.json).
 */
const CODE_SOURCES = [
  // the brief template every launch fills in
  { file: '_claude/builds/BRIEF-TEMPLATE.md', from: 3, to: 11, id: 'build-origin-verbatim' },
  { file: '_claude/builds/BRIEF-TEMPLATE.md', from: 16, to: 20, id: 'headless-context' },
  { file: '_claude/builds/BRIEF-TEMPLATE.md', from: 22, to: 28, id: 'rules-brief-only' },
  { file: '_claude/builds/BRIEF-TEMPLATE.md', from: 30, to: 32, id: 'build-origin-verbatim' },
  // the orchestrator's phase brief (orchestrator.mjs brief <id>; the dispatcher's briefFor wraps it)
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 52, id: 'checkpoints' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 63, id: 'ui-asset-tokens' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 69, id: 'api-everything' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 260, id: 'model-upgrade-approval' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 261, id: 'model-upgrade-approval' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 262, id: 'fable-auto-upgrade' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 264, id: 'phase-brief-scope' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 265, id: 'checkpoints' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 266, id: 'ui-asset-tokens' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 267, id: 'api-everything' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 273, id: 'checkpoints' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 274, id: 'watch-live' },
  { file: 'apps/console-web/plugins/build-orchestrator/web/orchestrator-core.mjs', line: 275, id: 'shots-not-review' },
  { file: 'framework/core/model-switch.mjs', line: 133, id: 'model-upgrade-approval' },
  { file: 'framework/core/model-switch.mjs', line: 135, id: 'fable-auto-upgrade' },
  // the dispatcher (pipeline.mjs launch → briefFor) and the splitter's own rules
  { file: 'apps/console-web/plugins/build-orchestrator/pipeline.mjs', line: 497, id: 'checkpoints' },
  { file: 'apps/console-web/plugins/build-orchestrator/pipeline-core.mjs', line: 406, id: 'small-steps' },
  // the launcher's notes appended to every headless prompt
  { file: 'deploy/claude-headless.sh', from: 74, to: 80, id: 'rules-brief-only' },
  { file: 'deploy/claude-headless.sh', from: 81, to: 85, id: 'hard-build-limit' },
  { file: 'deploy/claude-headless.sh', line: 135, id: 'watch-live' },
  { file: 'deploy/claude-headless.sh', line: 138, id: 'agent-cap' },
  { file: 'deploy/claude-headless.sh', line: 213, id: 'model-upgrade-approval' },
  // the rules brief seed (Claude settings → Rules briefs), one bullet at a time
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 0, id: 'rules-brief-only' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 1, id: 'one-agent-no-subagents' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 2, id: 'checkpoints' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 3, id: 'pr-only' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 4, id: 'models-opus-fable-only' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 5, id: 'cross-port-fixtures' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 6, id: 'veto-send-once' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 7, id: 'fix-it-yourself' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 8, id: 'feature-status-tracker' },
  { file: 'framework/schemas/rules-briefs.json', line: 9, part: 9, id: 'clean-professional-amber' },
  { file: 'framework/schemas/rules-briefs.json', line: 13, part: 1, id: 'ui-asset-tokens' },
  { file: 'framework/schemas/rules-briefs.json', line: 13, part: 2, id: 'toolbars' },
  { file: 'framework/schemas/rules-briefs.json', line: 13, part: 3, id: 'settings-level-toolbar' },
  { file: 'framework/schemas/rules-briefs.json', line: 13, part: 4, id: 'ui-review-submit' },
  { file: 'framework/schemas/rules-briefs.json', line: 17, part: 1, id: 'plugin-lifecycle' },
  { file: 'framework/schemas/rules-briefs.json', line: 17, part: 2, id: 'plugin-lifecycle' },
  // the console MCP server's instructions to every connected session
  { file: 'apps/console-web/server/mcp_server.py', from: 44, to: 45, id: 'assigned-agent' },
  { file: 'apps/console-web/server/mcp_server.py', line: 46, id: 'claude-settings-first' },
  { file: 'apps/console-web/server/mcp_server.py', line: 48, id: 'check-pending-list' },
  { file: 'apps/console-web/server/mcp_server.py', from: 49, to: 50, id: 'small-steps' },
  { file: 'apps/console-web/server/mcp_server.py', from: 51, to: 52, id: 'models-opus-fable-only' },
  { file: 'apps/console-web/server/mcp_server.py', from: 53, to: 56, id: 'fable-auto-upgrade' },
  { file: 'apps/console-web/server/mcp_server.py', from: 57, to: 58, id: 'feature-status-tracker' },
  { file: 'apps/console-web/server/mcp_server.py', from: 60, to: 62, id: 'session-mirror' },
  { file: 'apps/console-web/server/mcp_server.py', from: 64, to: 65, id: 'follow-amber' },
  // _claude/memory/docs rule docs (the lines that state a rule, not the how-to around them)
  { file: '_claude/memory/docs/build-steps.md', from: 3, to: 4, id: 'small-steps' },
  { file: '_claude/memory/docs/ui-all-assets.md', line: 13, id: 'expansion-care' },
  { file: '_claude/memory/docs/build-reporting.md', from: 3, to: 5, id: 'change-log' },
  { file: '_claude/memory/docs/token-log.md', from: 5, to: 7, id: 'rules-brief-only' },
  { file: '_claude/memory/docs/codebase-changes.md', line: 30, id: 'change-log' },
  { file: '_claude/memory/docs/session-checkin.md', line: 149, id: 'no-secrets' },
  { file: '_claude/memory/docs/priority-tags.md', line: 16, id: 'build-priority-tag' },
  { file: '_claude/memory/docs/patches-banners.md', from: 33, to: 34, id: 'banners-launch-expanded' },
  { file: '_claude/memory/docs/Building-baseline.md', line: 1, id: 'expansion-care' },
  { file: '_claude/memory/docs/Frame.md', line: 1, id: 'app-defaults' },
];
/** Sources read for pass 2 that hold no builder rule (recorded so the pass is complete). */
const EMPTY_SOURCES = [{ file: '_claude/instructions/README.md', why: 'a folder description' }, { file: '_claude/instructions/builds-one-page-foldin.md', why: 'a finished fold-in note' }];

/** Ids that first appear in pass 2: [doer, kind, applies]. */
const A2 = {
  'checkpoints': ['session', 'mechanical', 'builds'], 'phase-brief-scope': ['session', 'mechanical', 'builds'], 'api-everything': ['session', 'judgement', 'builds'],
  'watch-live': ['session', 'mechanical', 'builds'], 'headless-context': ['vps', 'mechanical', 'builds'], 'rules-brief-only': ['vps', 'mechanical', 'builds'],
  'hard-build-limit': ['vps', 'mechanical', 'builds'], 'clean-professional-amber': ['session', 'judgement', 'all'], 'banners-launch-expanded': ['session', 'judgement', 'builds'],
};
Object.assign(TITLES, {
  'checkpoints': 'Steps are checkpoints in one session: commit, push, tick, go on; the next session picks up at the first open step',
  'phase-brief-scope': 'A phase brief: one session, no sub-agents, steps within the cap, read only the files listed, stop at the end of the phase',
  'api-everything': 'Everything comes with an API: deep link, readable state, every action callable through REST, MCP, CLI and voice',
  'watch-live': 'Watch live: say which screen and element you are changing so the live preview follows',
  'headless-context': 'Headless runs start with no MCP and the built-in tools only; the brief names what it truly needs',
  'rules-brief-only': 'Headless runs load no CLAUDE.md chain: the task brief plus the rules brief are all the standing rules',
  'hard-build-limit': 'A hard VPS build limit: no launch past it, whoever asks',
  'clean-professional-amber': 'Code, comments, commits, PRs and docs stay clean and professional; to Brett you are Amber, short and blunt',
  'banners-launch-expanded': 'Every banner launches expanded',
});

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const key = (file, line) => `${file === '_claude/rules/RULES.md' ? 'rules/RULES.md' : file.split('/').pop()}:${line}`;

/** Rule lines of one source: [{ line, text }]. A bullet's continuation lines (indented) are folded into it. */
function ruleLines({ file, sections, paragraphs = [] }) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const out = [];
  let inSection = sections.includes('*');
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (/^## /.test(raw)) inSection = sections.includes('*') || sections.includes(raw.trim());
    if (paragraphs.includes(n)) { out.push({ line: n, text: raw.trim() }); return; }
    if (!inSection) return;
    if (/^- /.test(raw)) out.push({ line: n, text: raw.slice(2).trim() });
    else if (/^\s+\S/.test(raw) && out.length && out[out.length - 1].line === n - 1 && !/^\s*- /.test(raw)) { out[out.length - 1].text += ` ${raw.trim()}`; out[out.length - 1].line = n; }
  });
  return out;
}

const titleOf = (text) => { const m = /^\*\*(.+?)\*\*/.exec(text); return (m ? m[1] : text).replace(/\s*\((?:[A-Z][a-z]{2} \d|Brett|Oct|Nov|Dec)[^)]*\)?.*$/, '').replace(/[:.]\s*$/, '').trim(); };

const byId = new Map();
const sources = [];
for (const src of SOURCES) {
  const rows = ruleLines(src);
  sources.push({ file: src.file, rules: rows.length });
  for (const r of rows) {
    const k = key(src.file, r.line);
    const a = A[k];
    const id = a ? a[0] : slug(titleOf(r.text)) || `${slug(src.file)}-${r.line}`;
    const entry = byId.get(id) || { id, title: TITLES[id] || titleOf(r.text), doer: a ? a[1] : 'session', kind: a ? a[2] : 'judgement', applies: a ? a[3] : 'all', annotated: !!a, sources: [] };
    if (!a) entry.annotated = false;
    entry.sources.push({ source: `${src.file}:${r.line}`, file: src.file, line: r.line, text: r.text });
    byId.set(id, entry);
  }
}
// ------------------------------------------------------------------ pass 2

const fileCache = new Map();
const linesOf = (file) => { if (!fileCache.has(file)) fileCache.set(file, readFileSync(join(ROOT, file), 'utf8').split('\n')); return fileCache.get(file); };
/** The verbatim text of one pass-2 source: a line, a joined range, or one bullet of a JSON string on that line. */
function codeText(s) {
  const lines = linesOf(s.file);
  if (s.part !== undefined) {
    const line = lines[s.line - 1];
    const m = /"text": "((?:[^"\\]|\\.)*)"/.exec(line);
    if (!m) throw new Error(`${s.file}:${s.line} has no "text" string`);
    const parts = JSON.parse(`"${m[1]}"`).split('\n- ');
    if (parts[s.part] === undefined) throw new Error(`${s.file}:${s.line} has no bullet ${s.part}`);
    return (s.part === 0 ? parts[0] : `- ${parts[s.part]}`).trim();
  }
  const from = s.from ?? s.line; const to = s.to ?? s.line;
  const text = lines.slice(from - 1, to).map((l) => l.trim()).filter(Boolean).join(' ');
  if (!text) throw new Error(`${s.file}:${from} is empty`);
  return text;
}
const pass2 = new Map();
for (const s of CODE_SOURCES) {
  const where = s.from ? `${s.file}:${s.from}-${s.to}` : s.part !== undefined ? `${s.file}:${s.line}#${s.part}` : `${s.file}:${s.line}`;
  const text = codeText(s);
  const a = A2[s.id];
  const entry = byId.get(s.id) || { id: s.id, title: TITLES[s.id] || s.id, doer: a ? a[0] : 'session', kind: a ? a[1] : 'judgement', applies: a ? a[2] : 'builds', annotated: !!a, sources: [] };
  if (!byId.has(s.id) && !a) entry.annotated = false;
  entry.sources.push({ source: where, file: s.file, line: s.from ?? s.line, ...(s.to ? { to: s.to } : {}), ...(s.part !== undefined ? { part: s.part } : {}), text, pass: 2 });
  byId.set(s.id, entry);
  pass2.set(s.file, (pass2.get(s.file) || 0) + 1);
}
for (const [file, n] of pass2) sources.push({ file, rules: n, pass: 2 });
for (const e of EMPTY_SOURCES) sources.push({ file: e.file, rules: 0, pass: 2, why: e.why });

const rules = [...byId.values()].map((e) => ({ ...e, source: e.sources[0].source, text: e.sources[0].text }));
const doc = {
  $axf: 'build-rules-inventory@1', build: 'build-rules-tab-gate-rules-vps-owns', pass: 2,
  about: 'Every builder rule a Claude session is given today, one entry per rule id, every source kept verbatim. Pass 1: the rule lines of CLAUDE.md, _claude/shared/rules/RULES.md and _claude/rules/RULES.md (only the list marker removed). Pass 2: the brief template, the orchestrator and dispatcher brief blocks (Look / API / Checkpoints / Rules, the tick, watch-live and screenshot lines), the launcher notes, the rules-brief seed, the console MCP instructions and the rule lines of _claude/memory/docs, merged onto the same ids. doer: vps = the VPS does or enforces it by itself, session = the Claude session has to; kind: mechanical = a checker, hook or fixer can do or verify it, judgement = it needs reasoning; applies: builds | interactive | all. Generated by inventory-build.mjs; nothing in the rules files was deleted.',
  fields: { id: 'stable rule id (the store keeps it)', source: 'first source file:line', text: 'verbatim text of that line', sources: 'every file:line (or :from-to, or :line#bullet) the rule appears at, each verbatim; pass 2 entries say so', doer: 'vps | session', kind: 'mechanical | judgement', applies: 'builds | interactive | all', annotated: 'false = doer and kind are the defaults, not a decision' },
  counts: { rules: rules.length, sourceLines: rules.reduce((n, r) => n + r.sources.length, 0), pass2Sources: CODE_SOURCES.length, vps: rules.filter((r) => r.doer === 'vps').length, session: rules.filter((r) => r.doer === 'session').length, mechanical: rules.filter((r) => r.kind === 'mechanical').length, judgement: rules.filter((r) => r.kind === 'judgement').length, unannotated: rules.filter((r) => !r.annotated).length },
  sources, rules,
};
const text = `${JSON.stringify(doc, null, 2)}\n`;
if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const strip = (s) => s.replace(/"generatedAt": "[^"]*",?\n?/g, '');
  if (strip(cur) !== strip(text)) { console.error('inventory.json is stale: run inventory-build.mjs'); process.exit(1); }
  console.log(`inventory.json is current: ${rules.length} rules, ${doc.counts.sourceLines} source lines`);
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}: ${rules.length} rules from ${doc.counts.sourceLines} source lines (${doc.counts.unannotated} unannotated)`);
}
