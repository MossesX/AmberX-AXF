/**
 * Build rules ops (build-rules@1, framework/spec/BUILD-RULES.md): the one implementation behind the Build rules tab,
 * REST (/api/plugins/gate/build-rules…), MCP (gate_build_rules_* through plugin-commands), the CLI
 * (build-rules.mjs, `axf gate build-rules …`) and voice (console actions gate.build-rules.*). gate.mjs `run` sends every
 * build_rules_* op here; the store is framework/core/build-rules.mjs (the live store, the repo seed until the first write).
 *
 * Ops: build_rules_list, build_rules_get, build_rules_add, build_rules_edit, build_rules_toggle, build_rules_delete
 * (two-step confirm), build_rules_history, build_rules_runs, build_rules_run (dry run or real), build_rules_brief.
 * Answers: { ok: true, … } or { ok: false, code: invalid | not_found | confirmation_required | failed, message }.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as BR from '../../../../framework/core/build-rules.mjs';
import { RUN_PHASES, readRuns, runPhase } from './build-rules-runner.mjs';

export const BUILD_RULE_OPS = Object.freeze(['build_rules_list', 'build_rules_get', 'build_rules_add', 'build_rules_edit', 'build_rules_toggle', 'build_rules_delete', 'build_rules_history', 'build_rules_runs', 'build_rules_run', 'build_rules_brief']);

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const byOf = (i) => (typeof i.by === 'string' && i.by.trim() ? i.by.trim().slice(0, 80) : 'console');
const boolOf = (v) => (typeof v === 'boolean' ? v : v === 'true' || v === 'on' ? true : v === 'false' || v === 'off' ? false : undefined);
const reasonOf = (i, title) => (i.reason && typeof i.reason === 'object' ? i.reason : { title: typeof i.reason === 'string' && i.reason.trim() ? i.reason.trim().slice(0, 200) : title, description: '' });
const objOf = (v) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } } return v && typeof v === 'object' && !Array.isArray(v) ? v : null; };
const worktrees = () => process.env.AXF_PIPELINE_WORKTREES || '/root/axf-builds';

/** The store folder: input `dir` (tests), else the one decided by the engine (env, hub mount, home). */
const dirOf = (i) => (typeof i.dir === 'string' && i.dir && process.env.AXF_BUILD_RULES_TEST === '1' ? i.dir : BR.storeDir());

/** Each rule's latest run (any phase), for the list's Last result column. */
function lastRuns(dir) {
  const last = new Map();
  for (const r of readRuns({ dir, limit: 2000 })) if (!last.has(r.id)) last.set(r.id, { result: r.result, at: r.at, build: r.build, phase: r.phase, detail: String(r.detail || '').split('\n')[0].slice(0, 200) });
  return last;
}

/** Plain write: commit one change, answer the rule (or the removal). */
function write(i, change) {
  try {
    const r = BR.commit(change, { dir: dirOf(i), by: byOf(i) });
    const rule = r.store.rules.find((x) => x.id === r.entry.id) || null;
    return { ok: true, rule, entry: r.entry, rev: r.store.rev };
  } catch (e) {
    const m = String(e.message || e);
    return fail(/does not exist/.test(m) ? 'not_found' : e instanceof BR.StoreLocked ? 'failed' : 'invalid', m.slice(0, 600));
  }
}

export function createBuildRulesOps({ confirms } = {}) {
  const ops = {
    build_rules_list(i = {}) {
      const dir = dirOf(i);
      const l = BR.load({ dir });
      const en = boolOf(i.enabled);
      const q = String(i.q || '').toLowerCase();
      const last = lastRuns(dir);
      const rules = l.store.rules
        .filter((r) => (!i.doer || r.doer === i.doer) && (!i.kind || r.kind === i.kind) && (!i.phase || r.phase === i.phase) && (en === undefined || r.enabled === en) && (!q || `${r.id} ${r.title} ${r.text}`.toLowerCase().includes(q)))
        .map((r) => ({ ...r, sources: undefined, sourceCount: r.sources.length, checkKind: BR.checkKind(r), last: last.get(r.id) || null }));
      const all = l.store.rules;
      const counts = { total: all.length, vps: all.filter((r) => r.doer === 'vps').length, session: all.filter((r) => r.doer === 'session').length, on: all.filter((r) => r.enabled).length };
      return { ok: true, $axf: BR.STORE_FRAME, rev: l.store.rev, at: l.store.at, source: l.seeded ? 'seed' : l.empty ? 'empty' : 'live', path: l.path, counts, rules, enums: { doers: BR.DOERS, kinds: BR.KINDS, phases: BR.PHASES, briefBlocks: BR.BRIEF_BLOCKS, applies: BR.APPLIES, fixers: BR.FIXERS } };
    },
    build_rules_get(i = {}) {
      const dir = dirOf(i);
      const rule = BR.load({ dir }).store.rules.find((r) => r.id === String(i.id || ''));
      if (!rule) return fail('not_found', `no build rule ${i.id}`);
      return { ok: true, rule, checkKind: BR.checkKind(rule), runs: readRuns({ dir, rule: rule.id, limit: 20 }), history: BR.history({ dir, id: rule.id, limit: 20 }) };
    },
    build_rules_add(i = {}) {
      const rule = objOf(i.rule) || Object.fromEntries(['id', 'title', 'text', 'doer', 'kind', 'phase', 'enabled', 'check', 'autofix', 'briefBlock', 'applies', 'when', 'note'].filter((k) => i[k] !== undefined).map((k) => [k, k === 'enabled' ? boolOf(i[k]) ?? true : k === 'when' ? objOf(i[k]) || {} : i[k]]));
      if (!rule.id) return fail('invalid', 'send rule {id, title, text, doer, kind, phase, …}');
      if (rule.doer !== 'vps') rule.autofix = ''; // only the VPS runs a fixer
      return write(i, { action: 'add', rule: { enabled: true, ...rule }, reason: reasonOf(i, `Add build rule ${rule.id}`) });
    },
    build_rules_edit(i = {}) {
      const patch = objOf(i.patch) || Object.fromEntries(['title', 'text', 'doer', 'kind', 'phase', 'check', 'autofix', 'briefBlock', 'applies', 'when', 'note'].filter((k) => i[k] !== undefined).map((k) => [k, k === 'when' ? objOf(i[k]) || {} : i[k]]));
      if (patch.doer !== undefined && patch.doer !== 'vps') patch.autofix = ''; // a rule handed to the session drops its fixer
      if (!Object.keys(patch).length) return fail('invalid', 'nothing to change: send patch or title, text, doer, kind, phase, check, autofix, briefBlock, applies, when, note');
      return write(i, { action: 'edit', id: String(i.id || ''), patch, reason: reasonOf(i, `Edit build rule ${i.id}`) });
    },
    build_rules_toggle(i = {}) {
      const dir = dirOf(i);
      const cur = BR.load({ dir }).store.rules.find((r) => r.id === String(i.id || ''));
      if (!cur) return fail('not_found', `no build rule ${i.id}`);
      const want = boolOf(i.enabled);
      const enabled = want === undefined ? !cur.enabled : want;
      if (enabled === cur.enabled) return { ok: true, rule: cur, unchanged: true };
      return write(i, { action: 'toggle', id: cur.id, enabled, reason: reasonOf(i, `Switch build rule ${cur.id} ${enabled ? 'on' : 'off'}`) });
    },
    build_rules_delete(i = {}) {
      const id = String(i.id || '');
      const cur = BR.load({ dir: dirOf(i) }).store.rules.find((r) => r.id === id);
      if (!cur) return fail('not_found', `no build rule ${id}`);
      if (!confirms) return fail('failed', 'confirm tokens are unavailable');
      if (!i.confirm) return { ok: false, code: 'confirmation_required', message: `deletes build rule ${id} (History keeps it and Restore brings it back): call again with confirm`, confirm: confirms.issueConfirm('gate.build_rules_delete', id), affects: [id] };
      if (!confirms.takeConfirm('gate.build_rules_delete', id, i.confirm)) return fail('invalid', 'the confirm token is wrong or expired: ask again');
      const r = write(i, { action: 'remove', id, reason: reasonOf(i, `Delete build rule ${id}`) });
      return r.ok ? { ok: true, removed: id, entry: r.entry, rev: r.rev } : r;
    },
    build_rules_history(i = {}) {
      return { ok: true, entries: BR.history({ dir: dirOf(i), id: String(i.id || ''), action: String(i.action || ''), since: String(i.since || ''), limit: Number(i.limit) || 100 }) };
    },
    build_rules_runs(i = {}) {
      return { ok: true, runs: readRuns({ dir: dirOf(i), rule: String(i.id || i.rule || ''), build: String(i.build || ''), result: String(i.result || ''), since: String(i.since || ''), limit: Number(i.limit) || 100 }) };
    },
    async build_rules_run(i = {}) {
      const phase = String(i.phase || '');
      if (!RUN_PHASES.includes(phase)) return fail('invalid', `phase is one of ${RUN_PHASES.join(', ')}`);
      const build = String(i.build || '').trim();
      if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(build)) return fail('invalid', 'build is a build id');
      const dryRun = boolOf(i.dryRun) ?? false;
      const rules = (Array.isArray(i.rules) ? i.rules : String(i.rules || i.rule || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
      // a real run works in the build's worktree when there is one (fixes then land on its branch, never on main)
      const wt = join(worktrees(), build);
      const ctx = existsSync(wt) ? { root: wt, cwd: wt } : {};
      try {
        const out = await runPhase(build, phase, { rules, dryRun, dir: dirOf(i), by: byOf(i), ctx });
        return { ...out, pass: out.ok, ok: true, worktree: ctx.root || '' };
      } catch (e) { return fail(e.code || 'failed', String(e.message || e).slice(0, 600)); }
    },
    build_rules_brief(i = {}) {
      const b = { id: String(i.build || i.id || ''), title: String(i.title || ''), text: String(i.text || ''), ...(boolOf(i.ui) !== undefined ? { ui: boolOf(i.ui) } : {}) };
      return { ok: true, ...BR.briefBlocks(BR.load({ dir: dirOf(i) }).store, b) };
    },
  };
  return ops;
}
