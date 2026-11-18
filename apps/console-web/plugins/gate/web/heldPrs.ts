/**
 * Held PRs (held-prs@1, Nov 18 2026, build auto-lander-never-wait-missing-ui-review) on console-control@1: the systems
 * check's `held-prs` item (`row:held-prs`) and every PR row on it (`grid:held-prs/row:816`; the address grammar has no `pr`
 * segment and a row sits under a grid) have an address, so `console_show grid:held-prs/row:816` opens the item, `state` reads
 * the held PRs with their reasons, and `press grid:held-prs/row:816/button:land-now` lands one (destructive:
 * a press without `confirm` answers confirmation_required, like the button's own confirm). The same record as GET
 * /api/plugins/gate/held-prs, MCP gate_held_prs and `axf gate held-prs`; the press is POST land-now / gate_land_now /
 * `axf gate land-now <pr>` / voice gate.land-now:<pr>.
 */
import type { AxfRuntime } from '@console/axf/core';
import { controlRegistry } from '@console/axf/react';
import { confirmed, gateCall } from './api';

export interface HeldPr { pr: number; build: string; title: string; branch: string; state: string; rule: string; reviewFlag: string; holdReason: string; heldSince: string; heldMin: number; over: boolean; link: string; url?: string }
export interface HeldPrs { $axf: 'held-prs@1'; at: string; limitMin: number; count: number; over: number[]; items: HeldPr[] }

export const HELD_PRS_ROW = 'row:held-prs';
export const HELD_PRS_GRID = 'grid:held-prs';
const REFRESH_MS = 120_000;
let cache: HeldPrs | null = null;
export async function loadHeldPrs(): Promise<HeldPrs> { cache = await gateCall<HeldPrs>('held-prs'); return cache; }
export const heldPrs = () => cache;

const openItem = (rt: AxfRuntime) => () => rt.openDialog('system-check', { focus: 'held-prs' });
const landNow = (pr: number) => confirmed<{ pr: number; via: string }>('land-now', { pr, by: 'console-control' });

export function registerHeldPrsTargets(rt: AxfRuntime): () => void {
  const reg = controlRegistry(rt);
  const offs: (() => void)[] = [];
  offs.push(reg.register({
    address: HELD_PRS_ROW, kind: 'row', label: 'PRs the lander holds', detail: 'Systems check item (gate)', icon: 'shield', keywords: ['held', 'prs', 'lander', 'gate', 'systems check', 'land now'],
    open: openItem(rt), get: () => cache?.over ?? null,
    state: () => ({ limitMin: cache?.limitMin ?? null, count: cache?.count ?? 0, over: cache?.over ?? [], items: (cache?.items ?? []).map((x) => ({ pr: x.pr, build: x.build, state: x.state, heldMin: x.heldMin, heldSince: x.heldSince, reviewFlag: x.reviewFlag, reason: x.holdReason, over: x.over })) }),
  }));
  offs.push(reg.register({ address: HELD_PRS_GRID, kind: 'grid', label: 'Held PRs', detail: 'one row per PR the lander holds', icon: 'list', keywords: ['held', 'prs', 'lander'], open: openItem(rt), get: () => (cache?.items ?? []).map((x) => x.pr), state: () => ({ count: cache?.count ?? 0, over: cache?.over ?? [] }) }));
  // one row per held PR, re-registered when the list changes
  let rows: (() => void)[] = [];
  const sync = (h: HeldPrs) => {
    rows.forEach((off) => off()); rows = [];
    for (const x of h.items) {
      const label = `#${x.pr}${x.build ? ` ${x.build}` : ''}`;
      const state = () => ({ pr: x.pr, build: x.build, title: x.title, state: x.state, rule: x.rule, reviewFlag: x.reviewFlag, reason: x.holdReason, heldSince: x.heldSince, heldMin: x.heldMin, over: x.over });
      rows.push(reg.register({ address: `${HELD_PRS_GRID}/row:${x.pr}`, kind: 'row', label, detail: `held ${x.heldMin} min: ${x.holdReason}`.slice(0, 160), keywords: ['held', String(x.pr), x.build, x.state, x.reviewFlag].filter(Boolean), open: openItem(rt), get: () => x.holdReason, state, destructive: true, invoke: () => landNow(x.pr) }));
      rows.push(reg.register({ address: `${HELD_PRS_GRID}/row:${x.pr}/button:land-now`, kind: 'button', label: `Land #${x.pr} now`, detail: 'front of the merge queue, override noted; never a direct merge', keywords: ['land now', String(x.pr), x.build].filter(Boolean), open: openItem(rt), destructive: true, invoke: () => landNow(x.pr) }));
    }
  };
  const refresh = () => loadHeldPrs().then(sync).catch(() => { /* the server part may be off: the targets answer null */ });
  void refresh();
  const timer = setInterval(() => void refresh(), REFRESH_MS);
  return () => { clearInterval(timer); rows.forEach((off) => off()); offs.forEach((off) => off()); };
}
