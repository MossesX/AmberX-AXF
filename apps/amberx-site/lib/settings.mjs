/**
 * Site settings: everything on the landing page that Brett may change without a deploy (copy, demo video, pricing,
 * theme). Stored in <DATA_DIR>/settings.json; anything missing falls back to DEFAULTS.
 */
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './store.mjs';

export const DEFAULTS = Object.freeze({
  brand: 'AmberX',
  colorTheme: 'amber-ember',
  styleTheme: 'fresh',
  button: 'solid',
  card: 'glass',
  eyebrow: 'Early access',
  hook: 'Talk, and it builds your app.',
  sub: 'Say what you want. AmberX designs the screens, writes the code, wires the data and ships it to your phone and the web, while you watch.',
  videoUrl: '',
  videoPoster: '',
  videoCaption: 'One minute: an idea said out loud becomes a running app.',
  features: [
    { title: 'Voice first', text: 'Describe the app the way you would to a friend. AmberX asks only what it needs and starts building.' },
    { title: 'Watch it build', text: 'Every screen renders live as it is written. Point at anything and say what to change.' },
    { title: 'Real code, yours', text: 'A real codebase in your own repository: web, desktop and Android from one description.' },
    { title: 'Ships itself', text: 'Tests, review and deploy run on their own. You get a link on your phone when it is live.' },
    { title: 'Restyle in a word', text: 'Every colour, font and spacing is a swappable theme. Say "make it warmer" and it is.' },
    { title: 'A crew, not a chatbot', text: 'Planner, builder, reviewer and tester agents work in parallel and report back in plain words.' },
  ],
  pricing: {
    plan: 'AmberX Pro',
    trialDays: 14,
    price: 30,
    currency: 'USD',
    interval: 'month',
    includes: ['Unlimited apps and projects', 'Voice and chat building', 'Web, desktop and Android targets', 'Hosting on your own server', 'Cancel any time'],
    stripePriceId: '',
    checkoutUrl: '',
  },
  waitlistOpen: true,
  /** Places in line each referral moves its referrer up. */
  referralBoost: 5,
});

const KEYS = Object.keys(DEFAULTS);
const PRICING_KEYS = Object.keys(DEFAULTS.pricing);

export function createSettings(dataDir, { themes } = {}) {
  const file = join(dataDir, 'settings.json');
  const get = () => {
    const raw = readJson(file, {});
    return { ...DEFAULTS, ...raw, pricing: { ...DEFAULTS.pricing, ...(raw.pricing ?? {}) } };
  };
  /** Validate and merge a partial update. Throws an Error with .status = 400 on a bad value. */
  const set = (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw bad('settings must be an object');
    const cur = readJson(file, {});
    for (const [k, v] of Object.entries(patch)) {
      if (!KEYS.includes(k)) throw bad(`unknown setting: ${k}`);
      if (k === 'colorTheme' && themes && !themes.color[v]) throw bad(`unknown colour theme: ${v}`);
      if (k === 'styleTheme' && themes && !themes.style[v]) throw bad(`unknown style theme: ${v}`);
      if (k === 'button' && !['solid', 'soft', 'outline', 'gradient'].includes(v)) throw bad('button must be solid, soft, outline or gradient');
      if (k === 'card' && !['default', 'panel', 'outline', 'glass'].includes(v)) throw bad('card must be default, panel, outline or glass');
      if (k === 'features' && (!Array.isArray(v) || v.some((f) => typeof f?.title !== 'string' || typeof f?.text !== 'string'))) throw bad('features must be [{title, text}]');
      if (k === 'pricing') {
        if (typeof v !== 'object' || !v) throw bad('pricing must be an object');
        for (const pk of Object.keys(v)) if (!PRICING_KEYS.includes(pk)) throw bad(`unknown pricing field: ${pk}`);
        cur.pricing = { ...(cur.pricing ?? {}), ...v };
        continue;
      }
      if (k === 'referralBoost' && !(Number.isInteger(v) && v >= 0 && v <= 1000)) throw bad('referralBoost must be a whole number 0–1000');
      if (k === 'waitlistOpen' && typeof v !== 'boolean') throw bad('waitlistOpen must be true or false');
      if (['brand', 'eyebrow', 'hook', 'sub', 'videoUrl', 'videoPoster', 'videoCaption'].includes(k) && typeof v !== 'string') throw bad(`${k} must be text`);
      cur[k] = v;
    }
    writeJsonAtomic(file, cur);
    return get();
  };
  const reset = () => { writeJsonAtomic(file, {}); return get(); };
  return { get, set, reset };
}

export function bad(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}
