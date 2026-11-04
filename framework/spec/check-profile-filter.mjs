#!/usr/bin/env node
/** profile-filter@1 checks: normalising, visibility, bulk actions act on what is visible only, CLI/MCP override. */
import * as pf from '../core/engines/profile-filter.mjs';

let failed = 0;
const check = (ok, name) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) failed += 1; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const known = ['main-framework', 'current', 'urgent'];
const profiles = [{ id: 'main-framework', name: 'Main framework' }, { id: 'current', name: 'Current' }, { id: 'urgent', name: 'Urgent' }];
const builds = [
  { id: 'a', title: 'A', profiles: ['current'] },
  { id: 'b', title: 'B', profiles: ['urgent'] },
  { id: 'c', title: 'C', profiles: ['current', 'urgent'] },
  { id: 'd', title: 'D', profiles: ['main-framework'] },
  { id: 'e', title: 'E', profile: 'current' },
  { id: 'f', title: 'F' },
];

check(pf.isAll(pf.normalizeFilter('all')) && pf.isAll(pf.normalizeFilter('')) && pf.isAll(pf.normalizeFilter(null)), "'all', '' and null mean every profile");
check(eq(pf.normalizeFilter('current,urgent').ids, ['current', 'urgent']), "'a,b' is two profiles");
check(eq(pf.normalizeFilter(['Current', 'current', 'bad id!']).ids, ['current']), 'ids are lower-cased, deduped and checked');
check(pf.isAll(pf.normalizeFilter(['nope'], known)), 'unknown ids only = all profiles');
check(pf.isAll(pf.normalizeFilter({ all: true, ids: ['current'] })), 'all:true wins over ids');

const cur = pf.onlyProfile('current');
const r = pf.applyFilter(builds, cur);
check(eq(r.shown.map((b) => b.id), ['a', 'c', 'e', 'f']) && r.hidden === 2, 'Current shows its builds, single-profile rows and rows without a profile');
check(pf.applyFilter(builds, pf.ALL_PROFILES).hidden === 0, 'All profiles hides nothing');
check(eq(pf.countsByProfile(builds), { current: 3, urgent: 2, 'main-framework': 1 }), 'counts per profile (a build in two counts in both)');

let f = pf.toggleProfile(pf.ALL_PROFILES, 'current', known);
f = pf.toggleProfile(f, 'urgent', known);
check(eq(f.ids, ['current', 'urgent']), 'multi-select adds profiles');
check(pf.isAll(pf.toggleProfile(f, 'main-framework', known)), 'ticking every profile = all profiles');
check(pf.isAll(pf.toggleProfile(pf.toggleProfile(f, 'current', known), 'urgent', known)), 'taking the last one off = all profiles');

check(pf.filterLabel(pf.ALL_PROFILES, profiles) === 'All profiles', 'label: All profiles');
check(pf.filterLabel(f, profiles) === 'Current + Urgent', 'label: two names');
check(pf.filterLabel(pf.normalizeFilter(known), profiles) === 'Main framework + 2 more', 'label: three or more');
check(pf.filterNote(cur, 2, profiles) === 'Filtered: Current · 2 hidden' && pf.filterNote(pf.ALL_PROFILES, 0, profiles) === '', 'the filtered note');
check(pf.bulkLabel('Merge', 5, cur, profiles) === 'Merge 5 (filtered: Current)' && pf.bulkLabel('Merge', 5, pf.ALL_PROFILES) === 'Merge 5', 'bulk buttons say the count and the filter');

const s = pf.bulkSummary('Archive', builds, cur, profiles);
check(eq(s.included.map((b) => b.id), ['a', 'c', 'e', 'f']) && s.hidden === 2, 'a bulk action includes only what is visible');
check(/2 hidden by the profile filter \(Current\) stay untouched/.test(s.text) && s.button === 'Archive 4 (filtered: Current)', 'its confirm text says how many hidden rows stay untouched');

check(eq(pf.resolveFilter(undefined, { all: false, ids: ['urgent'] }, known).ids, ['urgent']), 'CLI/MCP default: the saved filter');
check(pf.isAll(pf.resolveFilter('all', { all: false, ids: ['urgent'] }, known)), 'an explicit profiles argument overrides it');
check(pf.filterQuery(f) === 'current,urgent' && pf.filterQuery(pf.ALL_PROFILES) === 'all', 'query form');

check(pf.PROFILE_TONES.includes(pf.profileTone('current', profiles)) && pf.profileTone('current', profiles, { current: 'danger' }) === 'danger', 'chip tones come from the theme tone list');
check(eq(pf.orderProfiles(profiles, { hidden: ['main-framework'], order: ['urgent'] }).map((p) => p.id), ['urgent', 'current']), 'listed profiles: hidden out, saved order first');

const counted = pf.buildCounts([
  { status: 'running' }, { status: 'pending', kind: 'epic' }, { status: 'pending', queue: { order: 1 } }, { status: 'pending' }, { status: 'blocked' },
  { status: 'failed' }, { status: 'built' }, { status: 'complete' }, { status: 'archived' }, { status: 'pending', deleted: true },
]);
check(eq(counted, { builds: 8, open: 6, running: 1, queued: 2, pending: 3, built: 1, complete: 1 }), 'counts: running / queued / pending / built (archived and deleted count nowhere)');

console.log(failed ? `\n${failed} check(s) failed` : '\nprofile-filter@1: all checks passed');
process.exit(failed ? 1 : 0);
