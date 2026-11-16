/**
 * Lander adapter (gate-rules@1 lander-state@1, the `lander.*` tools in framework/spec/GATE.md). The gate plugin's view
 * on the auto-lander and its controls, over the store adapter (gate-store.mjs); a later axf-molly backend replaces this
 * file and the store, nothing else.
 *
 * ONE mode switch, "Merge queue" (Brett, Nov 15 2026 06:59):
 *   on   PRs go through the stacked merge queue (land.mjs queue add / move) and the one-at-a-time lander is off
 *        (lander config: mergeQueue on, queueMode stack, autoLand off, autoMerge off);
 *   off  (the default) the merge queue is off and the auto-lander lands each finished build one at a time: main merged
 *        in first, clashes fixed, then landed (mergeQueue off, autoLand on, autoMerge on).
 * Flipping it writes the lander config at once (the cron reads it every round) and is logged in History.
 *
 * Pause keeps the mode and switches the lander's flags off (the entry in flight finishes, nothing new starts); Resume
 * puts them back. Land now moves a PR to the head of the line in the current mode; it never merges anything itself.
 */
import * as gate from '../../../../framework/core/gate-rules.mjs';
import { record as historyRecord } from './history.mjs';

export const MODE_FLAGS = Object.freeze({
  on: { mergeQueue: true, queueMode: 'stack', autoLand: false, autoMerge: false },
  off: { mergeQueue: false, autoLand: true, autoMerge: true },
});
const OFF_FLAGS = Object.freeze({ mergeQueue: false, autoLand: false, autoMerge: false });
const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const pr = (v) => { const n = Number(String(v ?? '').replace(/^#/, '')); return Number.isInteger(n) && n > 0 ? n : 0; };

/** UI hold word from a land.json reason kind. */
const uiOf = (kind) => (kind === 'ui' ? 'waiting' : '');

export function createLander(store, { record = (e) => historyRecord(store, e) } = {}) {
  const log = (action, { by = 'console', reason = '', pr: n, before, after } = {}) => record({ $axf: 'gate-history@1', at: store.iso(), by: String(by || 'console').slice(0, 80), kind: 'lander', action, ...(n ? { pr: n } : {}), ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), reason });

  const lander = {
    /** The switch: { mergeQueue, since, by }. Without a gate record it reads the lander config (off unless the queue is on and auto-land is off). */
    mode() {
      const g = store.gateLander();
      if (typeof g.mergeQueue === 'boolean') return { mergeQueue: g.mergeQueue, since: g.modeAt || '', by: g.modeBy || '' };
      const c = store.landerConfig();
      return { mergeQueue: c.mergeQueue === true && c.autoLand !== true, since: '', by: '' };
    },

    /** Flip the switch: the lander config changes at once (unless paused: then on resume). */
    setMode(on, { by = 'console', reason = '' } = {}) {
      if (typeof on !== 'boolean') throw err('invalid', 'mergeQueue is true or false');
      const before = lander.mode().mergeQueue; const g = store.gateLander();
      const flags = MODE_FLAGS[on ? 'on' : 'off'];
      if (g.pause) store.writeGateLander({ ...g, mergeQueue: on, modeAt: store.iso(), modeBy: by, saved: { ...(g.saved || {}), ...flags } });
      else { store.patchLanderConfig(flags); store.writeGateLander({ ...g, mergeQueue: on, modeAt: store.iso(), modeBy: by }); }
      log('mode', { by, reason, before: { mergeQueue: before }, after: { mergeQueue: on } });
      return lander.status();
    },

    /** What the lander knows about one PR, as a pr-snapshot@1 for gate.evaluate. Null when it knows nothing. */
    snapshot(n) {
      const q = store.queue(); const land = store.land(); const ctl = store.queueControl();
      const qi = [...(q.items || []), ...(q.waiting || [])].find((x) => x.pr === n);
      const li = (land.items || []).find((x) => x.pr === n);
      if (!qi && !li) return null;
      const kind = li?.reason?.kind || '';
      const why = String(qi?.why || li?.reason?.text || '');
      return {
        number: n, title: qi?.title || li?.title || '', build: qi?.build || li?.id || '', branch: qi?.branch || li?.branch || '', head: qi?.head || li?.head || '',
        ci: qi?.ci === 'success' || qi?.ci === 'failure' || qi?.ci === 'running' ? qi.ci : li?.ci || 'none', failing: li?.failing || qi?.failing || [],
        ui: uiOf(kind) || (/ui review/i.test(why) ? 'waiting' : ''), conflicts: kind === 'conflict' ? (li?.reason?.files || ['code']) : /conflicts? with main in code/i.test(why) ? ['code'] : [],
        draft: /draft/i.test(why), landHeld: kind === 'held' ? String(li?.reason?.text || 'by hand') : '', removed: ctl.removed?.[n] ? String(ctl.removed[n].why || 'by hand') : '', kicked: qi?.state === 'kicked' ? why : '',
      };
    },

    /** The full lander-state@1, with each waiting PR's gate verdict (`gate`) from the current rules. */
    state() {
      const cfg = store.landerConfig(); const g = store.gateLander(); const m = lander.mode();
      const paused = !!g.pause;
      const enabled = paused ? true : m.mergeQueue ? cfg.mergeQueue !== false : cfg.autoLand === true;
      let queue = store.queue();
      if (!m.mergeQueue) {
        // one at a time: the line is land.json's finished builds in landing order
        const items = (store.land().items || []).filter((x) => pr(x.pr));
        const row = (x) => ({ pr: x.pr, title: x.title, build: x.id, branch: x.branch, head: x.head, url: x.url, why: x.reason?.text?.replace(`${x.id}: `, '') || '', since: x.since, state: x.state === 'blocked' ? 'held' : 'waiting' });
        queue = { items: items.filter((x) => x.state !== 'blocked').map(row), waiting: items.filter((x) => x.state === 'blocked').map(row), merged: queue.merged || [] };
      }
      const core = { ...cfg, autoLander: { enabled, mode: m.mergeQueue ? 'merge-queue' : 'serial' }, ...(m.mergeQueue ? { queueMode: cfg.queueMode === 'batch' ? 'batch' : 'stack' } : {}) };
      const st = gate.landerStateFrom({ config: core, queue, control: store.queueControl(), runs: store.runs(), pause: g.pause || null, at: store.iso() });
      const rules = store.readRules();
      const waiting = st.waiting.map((w) => {
        const snap = lander.snapshot(w.pr);
        if (!snap) return w;
        const v = gate.evaluate(rules, snap, { at: st.at });
        const rule = w.rule || (v.blockedBy && !v.blockedBy.startsWith('hand:') ? v.blockedBy : '');
        return { ...w, rule, gate: { pass: v.pass, held: v.held, blockedBy: v.blockedBy, reasons: v.reasons } };
      });
      return { ...st, waiting, mergeQueue: m.mergeQueue, modeSince: m.since, modeBy: m.by };
    },

    /** lander.status: the state without the waiting and run bodies. */
    status() {
      const s = lander.state();
      const { waiting, lastRuns, ...rest } = s;
      return { ...rest, counts: { waiting: waiting.length, runs: lastRuns.length }, lastRun: lastRuns.length ? lastRuns[lastRuns.length - 1] : null };
    },

    waiting({ rule = '', state = '' } = {}) {
      return { items: lander.state().waiting.filter((w) => (!rule || w.rule === rule) && (!state || w.state === state)) };
    },

    runs({ limit = 20, result = '' } = {}) {
      const n = Math.min(gate.RUNS_MAX, Math.max(1, Number(limit) || 20));
      return { items: store.runs().filter((r) => !result || r.result === result).reverse().slice(0, n) };
    },

    /**
     * Land now (two-step): the first call answers { confirm, pr, title }; the second, with that token, puts the PR at the
     * head of the line in the current mode. It still passes every rule; nothing merges here.
     */
    landNow({ pr: raw, by = 'console', reason = '', confirm = '' } = {}) {
      const n = pr(raw);
      if (!n) throw err('invalid', 'pr is a PR number');
      const snap = lander.snapshot(n);
      if (!confirm) return { ok: false, code: 'confirmation_required', confirm: store.issueConfirm('lander.land_now', n), pr: n, title: snap?.title || '' };
      if (!store.takeConfirm('lander.land_now', n, confirm)) throw err('invalid', 'the confirm token is wrong or expired: ask again');
      const m = lander.mode();
      let via; let r;
      if (m.mergeQueue) {
        via = 'merge-queue';
        const inQueue = (store.queue().items || []).some((x) => x.pr === n);
        if (!inQueue) { r = store.landerCommand(['queue', 'add', String(n)]); if (!r.ok) throw err('failed', `the merge queue refused #${n}: ${r.err || r.out}`); }
        r = store.landerCommand(['queue', 'move', String(n), '0']);
      } else {
        via = 'auto-lander';
        const item = (store.land().items || []).find((x) => x.pr === n);
        if (!item) throw err('not_found', `#${n} is not a finished build the auto-lander knows`);
        r = store.landerCommand(['now', item.id]);
      }
      if (!r.ok) throw err('failed', `the lander refused: ${r.err || r.out}`);
      log('land-now', { by, reason, pr: n, after: { via, position: 0 } });
      return { ok: true, pr: n, position: 0, via };
    },

    pause({ why = '', by = 'console', reason = '' } = {}) {
      const g = store.gateLander();
      if (g.pause) return lander.status();
      const cfg = store.landerConfig();
      const saved = { mergeQueue: cfg.mergeQueue !== false, autoLand: cfg.autoLand === true, autoMerge: cfg.autoMerge !== false };
      store.patchLanderConfig(OFF_FLAGS);
      store.writeGateLander({ ...g, pause: { why: String(why || '').slice(0, 200), by, at: store.iso() }, saved });
      log('pause', { by, reason: reason || why, before: { paused: false }, after: { paused: true, why } });
      return lander.status();
    },

    resume({ by = 'console', reason = '' } = {}) {
      const g = store.gateLander();
      if (!g.pause) return lander.status();
      const m = lander.mode();
      store.patchLanderConfig({ ...(g.saved || {}), ...MODE_FLAGS[m.mergeQueue ? 'on' : 'off'] });
      const { pause, saved, ...rest } = g;
      store.writeGateLander(rest);
      log('resume', { by, reason, before: { paused: true, why: pause.why }, after: { paused: false } });
      return lander.status();
    },
  };
  return lander;
}
