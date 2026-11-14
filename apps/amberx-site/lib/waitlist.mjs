/**
 * Waitlist with referral ranking.
 *
 * Everyone gets a referral code. Each friend who joins with your link moves you `boost` places up the line:
 *   score = joinOrder − referrals × boost      (lower is earlier; ties go to whoever joined first)
 * Only entries still `waiting` hold a place in line; `invited` ones have been let in.
 * Stored in <DATA_DIR>/waitlist.json. Emails are kept lower-cased; nothing else about the visitor is stored.
 */
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readJson, writeJsonAtomic } from './store.mjs';
import { bad } from './settings.mjs';

const EMAIL = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const STATUSES = ['waiting', 'invited'];
const JOIN_LIMIT = { perHour: 20 };

export function createWaitlist(dataDir, { boost = () => 5, now = () => new Date() } = {}) {
  const file = join(dataDir, 'waitlist.json');
  let db = readJson(file, { $axf: 'amberx-waitlist@1', seq: 0, entries: [] });
  const save = () => writeJsonAtomic(file, db);
  const hits = new Map();

  const newCode = () => {
    for (;;) {
      const b = randomBytes(8);
      const code = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
      if (!db.entries.some((e) => e.code === code)) return code;
    }
  };
  const score = (e) => e.order - e.referrals * boost();
  const waitingRanked = () => db.entries.filter((e) => e.status === 'waiting').sort((a, b) => score(a) - score(b) || a.order - b.order);

  function limit(ip) {
    if (!ip) return;
    const t = Date.now();
    const list = (hits.get(ip) ?? []).filter((x) => t - x < 3_600_000);
    if (list.length >= JOIN_LIMIT.perHour) throw Object.assign(new Error('too many sign-ups from this address, try again later'), { status: 429 });
    list.push(t);
    hits.set(ip, list);
  }

  return {
    join({ email, ref, ip } = {}) {
      const mail = String(email ?? '').trim().toLowerCase();
      if (!EMAIL.test(mail)) throw bad('enter a valid email address');
      const existing = db.entries.find((e) => e.email === mail);
      if (existing) return { entry: existing, created: false };
      limit(ip);
      const referrer = ref ? db.entries.find((e) => e.code === String(ref).toLowerCase()) : null;
      const entry = { code: newCode(), email: mail, order: ++db.seq, joinedAt: now().toISOString(), referredBy: referrer?.code ?? '', referrals: 0, status: 'waiting' };
      if (referrer) referrer.referrals += 1;
      db.entries.push(entry);
      save();
      return { entry, created: true };
    },
    byCode: (code) => db.entries.find((e) => e.code === String(code).toLowerCase()) ?? null,
    /** 1-based place in line, or 0 once invited. */
    position(code) {
      const i = waitingRanked().findIndex((e) => e.code === code);
      return i < 0 ? 0 : i + 1;
    },
    count: () => db.entries.filter((e) => e.status === 'waiting').length,
    /** Everyone: waiting in line order, then invited (by join order). `q` filters by email or code. */
    ranked({ q = '' } = {}) {
      const all = [...waitingRanked(), ...db.entries.filter((e) => e.status !== 'waiting').sort((a, b) => a.order - b.order)];
      const needle = q.trim().toLowerCase();
      return needle ? all.filter((e) => e.email.includes(needle) || e.code === needle) : all;
    },
    stats() {
      const total = db.entries.length;
      const referred = db.entries.filter((e) => e.referredBy).length;
      const top = waitingRanked().slice(0, 5).map((e) => ({ code: e.code, referrals: e.referrals }));
      const day = now().toISOString().slice(0, 10);
      return { total, waiting: this.count(), invited: total - this.count(), referred, today: db.entries.filter((e) => e.joinedAt.startsWith(day)).length, boost: boost(), top };
    },
    update(code, patch = {}) {
      const e = this.byCode(code);
      if (!e) return null;
      for (const k of Object.keys(patch)) if (k !== 'status') throw bad(`only status can be changed (got ${k})`);
      if (patch.status !== undefined) {
        if (!STATUSES.includes(patch.status)) throw bad(`status must be ${STATUSES.join(' or ')}`);
        e.status = patch.status;
      }
      save();
      return e;
    },
    remove(code) {
      const i = db.entries.findIndex((e) => e.code === String(code).toLowerCase());
      if (i < 0) return false;
      const [gone] = db.entries.splice(i, 1);
      const ref = gone.referredBy && db.entries.find((e) => e.code === gone.referredBy);
      if (ref) ref.referrals = Math.max(0, ref.referrals - 1);
      save();
      return true;
    },
    csv(base) {
      const cell = (v) => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = [['position', 'email', 'code', 'referrals', 'referred_by', 'joined_at', 'status', 'referral_link']];
      for (const e of this.ranked()) rows.push([this.position(e.code) || '', e.email, e.code, e.referrals, e.referredBy, e.joinedAt, e.status, `${base}/?ref=${e.code}`]);
      return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
    },
    reload() { db = readJson(file, { $axf: 'amberx-waitlist@1', seq: 0, entries: [] }); },
  };
}
