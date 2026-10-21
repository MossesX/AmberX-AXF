// Approvals banner: postponed-approval reminders and the mandatory review plan (node test.mjs; run by test.py in CI).
import assert from 'node:assert/strict';
import { REMEMBER_CAP, REVIEW_CHOICES, age, reminderKey, reminderPlan, reviewState } from './web/reminders.mjs';

let n = 0;
const eq = (a, b, what) => { assert.deepEqual(a, b, what); n++; };
const A = 'dfe44a5d-15ab-47bf-8128-9843d37cd6ec';
const B = '0b6f3c2e-9a41-4d7e-8f10-2c3d4e5f6a7b';
const item = (id, slot, extra = {}) => ({ id, tool: 'vps.run', waitingFor: 'service github is healthy', url: `https://axhub.example/auth/admin/approvals/${id}`, slot, minutes: slot * 30 + 1, review: slot >= 4, ...extra });

eq(age(0), '0 min', 'age 0'); eq(age(45.9), '45 min', 'age min'); eq(age(120), '2 h', 'age h'); eq(age(125), '2 h 5 min', 'age h min'); eq(age(NaN), '0 min', 'age NaN');
eq(reminderKey(A, 3), `approvals:postponed:${A}:3`, 'key');

// first half hour: nothing, but the request is remembered at slot 0
let p = reminderPlan([item(A, 0)], {});
eq([p.raise.length, p.resolve, p.next], [0, [], { [A]: 0 }], 'slot 0: no alert yet');
// 30 min: one warn alert
p = reminderPlan([item(A, 1)], p.next);
eq(p.raise.map((r) => [r.key, r.severity, r.source]), [[reminderKey(A, 1), 'warn', 'approvals']], 'slot 1 raises a warn');
eq(p.raise[0].link, `https://axhub.example/auth/admin/approvals/${A}`, 'links to the hub page');
eq(p.raise[0].meta, { approval: A, slot: 1 }, 'meta');
assert.match(p.raise[0].body, /Postponed 31 min, waiting for service github is healthy\./); n++;
eq(p.resolve, [], 'nothing to resolve yet');
// same slot again (another poll, another tab): nothing new
eq(reminderPlan([item(A, 1)], p.next).raise, [], 'once per slot');
// 1 h: new alert, the 30-min one resolved
p = reminderPlan([item(A, 2)], { [A]: 1 });
eq([p.raise.map((r) => r.key), p.resolve], [[reminderKey(A, 2)], [reminderKey(A, 1)]], 'next slot raises and resolves the last');
// opened after 3 h: only the current slot, as an error with the review wording
p = reminderPlan([item(A, 6)], {});
eq([p.raise.map((r) => [r.key, r.severity]), p.resolve], [[[reminderKey(A, 6), 'error']], []], 'late open: current slot only');
assert.match(p.raise[0].title, /^Review postponed approval: vps\.run$/); n++;
assert.match(p.raise[0].body, /needs your decision now/); n++;
// gone from the feed (decided on the hub / back to pending / expired): its open reminder is resolved and forgotten
p = reminderPlan([item(B, 1)], { [A]: 3, [B]: 0 });
eq([p.raise.map((r) => r.key), p.resolve, p.next], [[reminderKey(B, 1)], [reminderKey(A, 3)], { [B]: 1 }], 'left the feed: resolved');
// bad input is ignored; duplicates count once; slot -1 (unknown since) never alerts
p = reminderPlan([null, { id: 5 }, item(A, 2), item(A, 2), item(B, -1)], {});
eq([p.raise.map((r) => r.key), Object.keys(p.next)], [[reminderKey(A, 2)], [A]], 'bad and duplicate items');
// the remembered map stays bounded
const many = Array.from({ length: REMEMBER_CAP + 20 }, (_, i) => item(`id-${i}`, 1));
eq(Object.keys(reminderPlan(many, {}).next).length, REMEMBER_CAP, 'remembered capped');

// mandatory review
eq(REVIEW_CHOICES.map((c) => c.id), ['approve', 'decline', 'postpone', 'revoke'], 'review choices');
eq(REVIEW_CHOICES.find((c) => c.id === 'postpone').page, 'postpone', 'postpone again opens the hub postpone page');
let r = reviewState([item(A, 2), item(B, 5)], {});
eq([r.blocking, r.rows.map((x) => x.id), r.chosen], [true, [B], 0], 'only requests due for review block');
r = reviewState([item(B, 5)], { [B]: 'decline', [A]: 'approve', x: 'nonsense' });
eq([r.rows[0].choice, r.chosen, r.choices], ['decline', 1, { [B]: 'decline' }], 'choices kept only for due requests');
eq(reviewState([item(B, 5)], { [B]: 'explode' }).rows[0].choice, '', 'unknown choice ignored');
// the review ends only when the hub stops listing it as due (here: postponed again → back under 2 h)
eq(reviewState([item(B, 0)], { [B]: 'postpone' }).blocking, false, 'cleared by the hub, not by the tap');

console.log(`✓ approvals-banner reminders: ${n} checks`);
