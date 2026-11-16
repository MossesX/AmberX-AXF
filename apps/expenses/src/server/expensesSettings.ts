/**
 * @file The Expense Tracker's settings over the ledger API (`/api/expenses/v1/settings`), for Molly and tools. The rows
 * are the module decl's (`expenses.decl.ts` → `settings.rows`), stored in the same kv document the app's settings store
 * writes (`expenses-settings`: `{ v, settings }`), so a change here shows in the standalone app and back. **Node-only.**
 */
import { EXPENSES_DECL } from "@axs/modules/expenses/expenses.decl";

import { axfKv } from "./axfKv";
import { ApiError } from "./expensesApi";

const NS = "expenses-settings";

interface Row {
  key: string; label: string; hint?: string; kind: string; defaultValue: unknown;
  options?: { value: string; label: string }[]; min?: number; max?: number; step?: number;
}

export const ROWS = ((EXPENSES_DECL as unknown as { settings: { rows: Row[] } }).settings.rows);

/** The settings dialog's sections (`settings.ts` → SECTIONS, which is client-only): same ids, titles and keys. */
export const SECTIONS: readonly { id: string; title: string; blurb: string; keys: readonly string[] }[] = [
  { id: "general", title: "General", blurb: "What a new entry starts as, which view opens, how long a toast stays.", keys: ["confirmDelete", "defaultAccount", "defaultCategory", "startView", "toastSeconds"] },
  { id: "grid", title: "Grid & filter", blurb: "The grid's defaults, and how the filter field reads what you type.", keys: ["showHints", "denseRows", "hiddenColumns", "defaultSort", "defaultSortDir", "filterMatchAll", "filterColumns", "statementPeriod"] },
  { id: "paydays", title: "Paydays", blurb: "The pay schedule. The Paydays screen reads it.", keys: ["paydayAmount", "paydayEvery", "paydayWeekday", "paydayDayOfMonth", "paydayAnchor", "paydaySince", "paydayPayer"] },
  { id: "welcome", title: "Welcome", blurb: "What the welcome dialog shows when you sign in.", keys: ["welcomeEnabled", "welcomeMissingPaydays", "welcomeMonthSummary", "welcomeNextPayday", "welcomeOverBudget", "welcomeTopCategories", "welcomeUnreconciled", "welcomeDisputed", "welcomeRecentImports"] },
  { id: "import", title: "Import", blurb: "Defaults for importing bank transactions and how loosely duplicates are matched.", keys: ["importAccount", "importSkipPayments", "importDateSlack", "importAmountSlack", "extraAccounts"] },
  { id: "ai", title: "AI", blurb: "How the app reaches Claude, for reading statement images and the assistant.", keys: ["aiMode", "aiModel"] },
];

async function readDoc(user: string): Promise<{ v?: number; settings: Record<string, unknown> }> {
  const doc = (await axfKv.read(user, NS)) as { v?: number; settings?: Record<string, unknown> } | null;
  return { ...(doc ?? {}), settings: { ...(doc?.settings ?? {}) } };
}

export async function settingsView(user: string) {
  const { settings } = await readDoc(user);
  const values = Object.fromEntries(ROWS.map((r) => [r.key, r.key in settings ? settings[r.key] : r.defaultValue]));
  const section = (k: string) => SECTIONS.find((s) => s.keys.includes(k))?.id ?? "general";
  return {
    values,
    changed: ROWS.filter((r) => r.key in settings).map((r) => r.key),
    rows: ROWS.map((r) => ({ key: r.key, label: r.label, hint: r.hint, kind: r.kind, default: r.defaultValue, options: r.options, min: r.min, max: r.max, step: r.step, section: section(r.key) })),
    sections: SECTIONS.map(({ id, title, blurb }) => ({ id, title, blurb })),
  };
}

/** One value checked against its row: switch → boolean, number → in range, select → one of the options, text → string. */
function coerce(r: Row, v: unknown): unknown {
  if (r.kind === "switch") {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "false") return v === "true";
  } else if (r.kind === "number") {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (Number.isFinite(n) && (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max)) return n;
    throw new ApiError(400, `${r.key} must be a number${r.min !== undefined ? ` from ${r.min}` : ""}${r.max !== undefined ? ` to ${r.max}` : ""}`);
  } else if (r.kind === "select") {
    if (typeof v === "string" && (!r.options || r.options.some((o) => o.value === v))) return v;
    throw new ApiError(400, `${r.key} must be one of ${(r.options ?? []).map((o) => o.value || '""').join(", ")}`);
  } else if (typeof v === "string") {
    if (v.length > 2000) throw new ApiError(400, `${r.key} is too long`);
    return v;
  }
  throw new ApiError(400, `${r.key}: bad value`);
}

/** Change settings: `{ key: value }`; `null` puts a key back to its default. Unknown keys are refused. */
export async function patchSettings(user: string, patch: Record<string, unknown>) {
  const doc = await readDoc(user);
  for (const [k, v] of Object.entries(patch)) {
    const r = ROWS.find((x) => x.key === k);
    if (!r) throw new ApiError(400, `unknown setting ${k}`);
    if (v === null) delete doc.settings[k]; else doc.settings[k] = coerce(r, v);
  }
  await axfKv.write(user, NS, { ...doc, v: doc.v ?? 1 });
  return settingsView(user);
}
