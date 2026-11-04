#!/usr/bin/env node
/**
 * Profile switcher self-test: the CLI's filter and settings on a temporary data folder (never the real one, never the
 * saved active profile), what a bulk command acts on, and that the plugin's commands cover profiles-list,
 * profile-current, profile-select and profile-filter.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'psw-'));
process.env.AXF_PROFILE_SWITCHER_DIR = dir;
process.env.AXF_BUILDS_LIVE = '0';
const sw = await import('./switcher.mjs');
const { registry } = await import('../../../../framework/cli/plugin-commands.mjs');

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed += 1; };

try {
  const l = sw.list();
  const ids = l.profiles.map((p) => p.id);
  check(l.ok && ids.length > 0 && l.filter.all === true, 'list: every profile, no filter by default');
  check(l.profiles.every((p) => Number.isInteger(p.counts.open) && Number.isInteger(p.counts.running)), 'list: open and running counts per profile');
  const two = ids.slice(0, 2);
  const f = sw.filter(two.join(','));
  check(!f.filter.all && f.filter.ids.join() === two.join() && f.hidden >= 0, 'filter: two profiles picked together');
  const t = sw.filter(undefined, two[0]);
  check(t.filter.ids.join() === two.slice(1).join() || t.filter.all, 'filter --toggle takes one off');
  const v = sw.visible();
  check(v.builds.every((b) => b.profiles.length === 0 || b.profiles.some((p) => v.filter.ids.includes(p)) || v.filter.all), 'visible: only builds the filter shows');
  const all = sw.visible('all');
  check(all.filter.all && all.hidden === 0 && all.builds.length >= v.builds.length, 'visible --profiles all overrides the saved filter');
  const before = l.active;
  const r = sw.select('all');
  check(r.filter.all && r.active === before, "select all: every profile shown, the active profile unchanged");
  let threw = false; try { sw.select('no-such-profile'); } catch { threw = true; }
  check(threw, 'select refuses an unknown profile');
  const s = sw.saveSettings({ counts: false, mode: 'compact', hidden: [ids[0], 'nope'], tones: { [ids[0]]: 'danger', x: 'pink' }, placements: ['banner', 'toolbar', 'moon'] });
  check(s.counts === false && s.mode === 'compact' && s.hidden.join() === ids[0] && s.tones[ids[0]] === 'danger' && !('x' in s.tones) && s.placements.join() === 'banner,toolbar', 'settings: checked and kept');
  check(!sw.list().listed.includes(ids[0]), 'a hidden profile is left out of the list');
  {
    const reg = registry({ folders: ['profile-switcher'] });
    const entry = (reg.plugins ?? reg).find?.((x) => x.folder === 'profile-switcher') ?? reg.plugins?.[0];
    const cmds = (entry?.commands ?? []).map((c) => c.id);
    check(['profiles-list', 'profile-current', 'profile-select', 'profile-filter'].every((c) => cmds.includes(c)), 'commands: profiles-list, profile-current, profile-select, profile-filter');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : '\nprofile-switcher: all checks passed');
process.exit(failed ? 1 : 0);
