/**
 * Background monitoring rules, pure: the auto-approval patterns (the same as the AXHub app's AutoApprove and the native
 * HubRules) and the watch config sent to the Android service. Tested by `apps/amberx-droid/test.mjs`.
 */
export const NOT_IN_ALL: readonly string[] = ['vps.run'];

export function patterns(raw: unknown): string[] {
  const out: string[] = [];
  for (const p of String(raw ?? '').split(/[,\s;]+/)) if (p && !out.includes(p) && out.length < 50) out.push(p);
  return out;
}

export function matches(list: readonly string[], tool: string): boolean {
  return list.some((p) => p === '*' || p === tool || (p.endsWith('.*') && tool.startsWith(p.slice(0, -1)) && tool.length > p.length - 1));
}

/** Never approved by the phone on its own, whatever the settings say: starting a recording needs Brett's own tap (axHub 108). */
export const NEVER_AUTO: readonly string[] = ['amberx.recorder_start'];

/** "Approve everything" never covers vps.run; the tool list does when it names it (or `*`). Never NEVER_AUTO. */
export function autoApproves(on: boolean, all: boolean, raw: unknown, tool: string): boolean {
  if (NEVER_AUTO.includes(tool)) return false;
  return (all && tool !== '' && !NOT_IN_ALL.includes(tool)) || (on && matches(patterns(raw), tool));
}

export const clampInterval = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 30;
  return Math.max(15, Math.min(300, n));
};

export interface WatchSettings {
  hub: string; interval: unknown; listen: unknown; wake: string[]; lang: unknown;
  autoApprove: unknown; autoApproveAll: unknown; autoApproveTools: unknown;
  /** Dev Console alerts (builds, CI, deploys, systems check) as phone notifications; on unless switched off */
  consoleAlerts?: unknown;
}

/** The config the native watch service runs with (MonitorConfig in src/native.ts). */
export function watchConfig(s: WatchSettings) {
  return {
    hub: s.hub,
    intervalSec: clampInterval(s.interval),
    autoApprove: { on: s.autoApprove === true, all: s.autoApproveAll === true, tools: String(s.autoApproveTools ?? '').slice(0, 2000) },
    wakePhrases: s.listen === false ? [] : s.wake.slice(0, 20),
    lang: typeof s.lang === 'string' && s.lang.trim() ? s.lang.trim() : 'en-US',
    consoleAlerts: s.consoleAlerts !== false,
  };
}
