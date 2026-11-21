#!/usr/bin/env node
/**
 * branch-protection: the ruleset the script would send, checked against the CI workflow. No network, no settings change.
 *
 *   node deploy/branch-protection.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS_APP_ID, REQUIRED_CHECKS, jobNames, missingChecks, ruleset } from './branch-protection.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let n = 0; let failed = 0;
const ok = (c, msg) => { n += 1; if (c) console.log(`  ✓ ${msg}`); else { failed += 1; console.log(`  ✗ FAIL ${msg}`); } };

const yaml = readFileSync(join(HERE, '..', '.github/workflows/android.yml'), 'utf8');
const names = jobNames(yaml);
ok(names.length >= REQUIRED_CHECKS.length && names.includes('CI scope (what changed)'), `the workflow's job names are read (${names.length})`);
ok(missingChecks(yaml).length === 0, `every required check is a job of android.yml (${missingChecks(yaml).join('; ') || 'none missing'})`);
ok(JSON.stringify(missingChecks(yaml, ['No such job'])) === '["No such job"]', 'a renamed job is caught before it blocks every merge');
ok(JSON.stringify(jobNames('on: push\njobs:\n  a:\n    name: "Quoted: one"\n    steps:\n      - name: not a job\n  b:\n    runs-on: x\nother:\n  c:\n    name: nope\n')) === '["Quoted: one"]', 'job names: quotes stripped, step names and other sections ignored');

const r = ruleset();
const rule = (t) => r.rules.find((x) => x.type === t);
ok(r.enforcement === 'active' && r.target === 'branch' && r.conditions.ref_name.include.join() === '~DEFAULT_BRANCH', 'active, on the default branch');
ok(rule('required_status_checks').parameters.strict_required_status_checks_policy === true, 'the branch must be up to date before the merge');
ok(rule('required_status_checks').parameters.required_status_checks.length === REQUIRED_CHECKS.length && rule('required_status_checks').parameters.required_status_checks.every((c) => c.integration_id === ACTIONS_APP_ID && REQUIRED_CHECKS.includes(c.context)), 'every required check must come from GitHub Actions');
ok(rule('pull_request')?.parameters.required_approving_review_count === 0 && !!rule('non_fast_forward') && !!rule('deletion'), 'PRs only (no approvals), no force push, no delete');
ok(r.bypass_actors.length === 1 && r.bypass_actors[0].actor_type === 'DeployKey', 'only the deploy key bypasses: no admin, no role, no user');
ok(!rule('update'), 'no restrict-updates rule while the lander has no identity of its own');

const withApp = ruleset({ landerApp: '12345' });
ok(withApp.bypass_actors.some((a) => a.actor_type === 'Integration' && a.actor_id === 12345) && withApp.rules.some((x) => x.type === 'update'), 'with the lander app: it bypasses, and only bypass actors may move main');
ok(ruleset({ enforcement: 'disabled' }).enforcement === 'disabled', 'the emergency path only switches enforcement');

const cli = (...args) => spawnSync(process.execPath, [join(HERE, 'branch-protection.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, AXF_GITHUB_ADMIN_TOKEN: '', AXF_GITHUB_REPO: 'example/none' } });
for (const cmd of ['apply', 'status-key', 'off']) { const c = cli(cmd); ok(c.status === 1 && /--yes/.test(c.stderr), `${cmd} without --yes changes nothing`); }

console.log(`${failed ? '✗' : '✓'} branch-protection: ${n - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
