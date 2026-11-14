// Keeping an open console on the live deploy (console app part 4). Pure: liveUpdate.test.mjs runs it in Node.
//
// The server never caches index.html, so every load starts from the live entry bundle. A page that stays open (the
// Android console app keeps its one WebView alive for days, a browser tab can sit for a week) compares its own entry
// bundle with the one the live index.html names now. Newer and nobody is looking, inside the app: reload. Otherwise
// the console shows its "Reload for the new version" bar. Part 1's shell does the same check natively (ContentUpdate);
// the page runs its own only when the shell has no update method, so an older shell or a browser is covered too.

/** At most one automatic check per this many ms (native.update:check always runs). */
export const MIN_GAP_MS = 10 * 60_000;
/** A background check this often while the page is open. */
export const PERIOD_MS = 30 * 60_000;

const ENTRY = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']|<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i;

/** Path of the entry module in an index.html (`/assets/index-AbC123.js`), or '' when there is none. Same rule as UpdateRules.entry. */
export function entryOf(html) {
  const m = ENTRY.exec(String(html ?? ''));
  return m ? pathOf(m[1] ?? m[2]) : '';
}

/** A script src as a path: origin, query and hash dropped. */
export function pathOf(src) {
  try { return new URL(String(src), 'http://x').pathname; } catch { return ''; }
}

/** What to do after a check: 'none', 'reload' (off screen, in the app) or 'notify' (show the reload bar). */
export function decide({ loaded, live, hidden, wrapper }) {
  if (!loaded || !live || loaded === live) return 'none';
  return hidden && wrapper ? 'reload' : 'notify';
}

/** Is an automatic check due? */
export function due(lastAt, now, forced = false) {
  return forced || !lastAt || now - lastAt >= MIN_GAP_MS;
}
