/** Checks for the Git status page's pure helpers. Prints {total, failed} as its last line (read by test.py). */
import { actionsFor, aheadBehind, ageText, ciLook, filterRows, matchesFocus, money, reposOf, type Row } from './core';

let total = 0;
const failed: string[] = [];
const ok = (c: boolean, m: string) => { total++; if (!c) failed.push(m); };
const row = (o: Partial<Row>): Row => ({
  key: 'o/r#1', kind: 'pr', repo: 'o/r', number: 1, branch: 'claude/a', title: 't', lead: '#1 A: does a', agent: 'Snap Sully', status: 'ready', tone: 'success',
  ci: 'success', ahead: 2, behind: 0, at: '2026-11-03T10:00:00Z', cost: 1.2, url: 'https://github.com/o/r/pull/1', sha: 'a', blockers: [], sections: ['ready'],
  build: null, ui: null, hold: null, batch: '', dependsOn: [], ...o,
});
const now = Date.parse('2026-11-03T12:00:00Z');
ok(ageText('2026-11-03T10:00:00Z', now) === '2h' && ageText('', now) === '—' && ageText('2026-10-30T12:00:00Z', now) === '4d', 'ages read short');
ok(money(1.234) === '$1.23' && money(null) === '' && money(250) === '$250', 'money');
ok(aheadBehind({ ahead: 2, behind: 5, unpushed: 1 }) === '⇡1 ↑2 ↓5' && aheadBehind({ ahead: 0, behind: 0 }) === '', 'ahead / behind / unpushed');
ok(ciLook('failure').tone === 'danger' && ciLook('running').tone === 'info' && ciLook('').label === 'No CI here', 'CI dot');
const rows: [Row, Row, Row] = [row({}), row({ key: 'o/r#2', number: 2, lead: '#2 B: red', ci: 'failure', sections: ['ci'], at: '2026-11-03T11:00:00Z', behind: 9 }), row({ key: 'x/y:b', kind: 'branch', repo: 'x/y', number: null, branch: 'b', lead: 'B', sections: ['push', 'stale'] })];
ok(filterRows(rows, { section: 'ready', q: '', repo: '', sort: 'newest' }).map((r) => r.key).join() === 'o/r#1', 'section filter');
ok(filterRows(rows, { section: 'all', q: 'red', repo: '', sort: 'newest' }).length === 1, 'search');
ok(filterRows(rows, { section: 'all', q: '', repo: 'x/y', sort: 'newest' }).length === 1, 'repo filter');
ok(filterRows(rows, { section: 'all', q: '', repo: '', sort: 'behind' })[0]?.key === 'o/r#2', 'sort by behind');
ok(matchesFocus(rows[0], '#1') && matchesFocus(rows[0], 'claude/a') && !matchesFocus(rows[1], '#1') && matchesFocus(rows[2], 'x/y:b'), 'Show in Git status focus: number, branch, key');
ok(reposOf(rows).join() === 'o/r,x/y', 'repos');
ok(actionsFor(rows[0]).includes('merge') && !actionsFor(rows[1]).includes('merge') && actionsFor(rows[1]).includes('fix') && actionsFor(rows[2]).includes('kill'), 'actions per row');
console.log(JSON.stringify({ total, failed }));
