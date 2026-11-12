import type { AxfRuntime } from '../../../src/axf/core';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import helpPack from '../help.json';
import { API_BASE_KEY, DEFAULT_API_BASE, apiBase, call, ledgerChanged, ledgerQuery, todayIso, type EntryInput, type PaydaysData, type StatementData } from './api';
import { LedgerScreen, PaydaysScreen, ReportsScreen, reportState } from './screens';
import { AssistantScreen, SETTINGS_SECTIONS, SettingsSection, ask, assistantChanged, assistantState, listConversations, newConversation, patchSettings, readConversation, type SettingsData } from './assistant';
import './expenses.css';

/**
 * Expenses (Molly): the Expense Tracker's ledger, paydays and reports drawn natively in Molly, on the app's own ledger
 * API (`/api/expenses/v1/*`, same document as expenses.amberxai.com, which keeps working on its own). Views
 * `expenses/ledger`, `expenses/paydays`, `expenses/reports` (deep links `#/expenses/ledger` …); every button is an
 * `expenses.*` action, so the console API, MCP (plugin commands), the CLI and voice do the same without the UI.
 */

const PLUGIN_ID = 'ai.amberx.axf.molly.expenses';
const TAB = 'expenses';
export const SCREENS = [
  { id: 'ledger', label: 'Ledger', icon: 'list', render: () => <LedgerScreen /> },
  { id: 'paydays', label: 'Paydays', icon: 'clock', render: () => <PaydaysScreen /> },
  { id: 'reports', label: 'Reports', icon: 'chart', render: () => <ReportsScreen /> },
  { id: 'assistant', label: 'Assistant', icon: 'sparkles', render: () => <AssistantScreen /> },
] as const;

/** Where the screens sit in Molly's navigation (setting `expenses.navPlacement`, the three UI Review options). */
export const NAV_KEY = 'expenses.navPlacement';
export const NAV_PLACEMENTS = [
  { value: 'section', label: 'Own section', hint: 'An "Expenses" section of its own under the apps.' },
  { value: 'nested', label: 'Under the Expenses app', hint: 'A sub menu that slides open from Apps → Expenses.' },
  { value: 'menu', label: 'Molly menu only', hint: 'No navigation entries; the Molly menu, search and deep links reach them.' },
] as const;
const NAV_SECTION = 'ai.amberx.axf.molly.expenses.nav';

function placeNav(rt: AxfRuntime): void {
  const p = rt.settings.get(NAV_KEY);
  const items = SCREENS.map((s) => ({ id: `expenses.${s.id}`, label: s.label, icon: s.icon, view: `expenses/${s.id}` }));
  rt.removeNavSection(NAV_SECTION);
  if (p === 'menu') return;
  // joined by view: the nav-menu asset's own Expenses entry (view `expenses`) takes the screens as its sub menu
  if (p === 'nested') rt.setNavSection({ id: NAV_SECTION, label: 'Apps', items: [{ id: 'expenses', label: 'Expenses', icon: 'chart', view: 'expenses', items }] });
  else rt.setNavSection({ id: NAV_SECTION, label: 'Expenses', items });
}

const argsOf = (args: string[], payload?: string) => (args.length ? args.join(':') : payload ?? '');

/** A JSON object payload (MCP / REST send one), or `{}`. */
function jsonOf<T extends object>(raw: string): T {
  if (!raw.trim().startsWith('{')) return {} as T;
  try { return JSON.parse(raw) as T; } catch { return {} as T; }
}

function report(rt: AxfRuntime, e: unknown): never {
  rt.toast((e as Error).message, 'danger', 'Expenses');
  throw e;
}

export const plugin: AxfWebLibrary = {
  id: PLUGIN_ID,
  label: 'Expenses',
  version: '0.1.0',
  provides: ['view:expenses/ledger', 'view:expenses/paydays', 'view:expenses/reports', 'view:expenses/assistant', 'settings-tab:expenses'],
  builtWith: { model: 'opus', builtAt: '2026-11-12' },
  help: helpPack.data as AxfWebLibrary['help'],
  views: Object.fromEntries(SCREENS.map((s) => [`expenses/${s.id}`, { title: `Expenses ${s.label.toLowerCase()}`, icon: s.icon, render: s.render, keywords: ['expenses', 'money', s.id] }])),
  register(rt) {
    const on = rt.actions.register.bind(rt.actions);
    // Deep links: #/expenses/<screen> opens the native screen; any other #/expenses/<route> stays the app's own frame.
    const fromHash = () => {
      const m = /^#\/?expenses\/([a-z]+)\/?$/.exec(window.location.hash);
      if (m && SCREENS.some((s) => s.id === m[1])) rt.navigate(`expenses/${m[1]}`);
    };
    fromHash();
    window.addEventListener('hashchange', () => queueMicrotask(fromHash));
    placeNav(rt);
    rt.settings.onChange(NAV_KEY, () => placeNav(rt));
    on('expenses.open', (args, ctx) => {
      const id = argsOf(args, ctx.payload) || 'ledger';
      if (SCREENS.some((s) => s.id === id)) rt.navigate(`expenses/${id}`);
    }, { label: 'Open an Expenses screen (ledger, paydays, reports)' });
    on('expenses.list', (args, ctx) => call(rt, ledgerQuery(jsonOf(argsOf(args, ctx.payload)))).catch((e) => report(rt, e)), { label: 'List ledger entries' });
    on('expenses.get', (args, ctx) => call(rt, `entries/${encodeURIComponent(argsOf(args, ctx.payload))}`).catch((e) => report(rt, e)), { label: 'Read one entry' });
    on('expenses.add', async (args, ctx) => {
      const body = jsonOf<EntryInput>(argsOf(args, ctx.payload));
      const out = await call(rt, 'entries', { method: 'POST', body }).catch((e) => report(rt, e));
      ledgerChanged(); rt.toast('Entry added.', 'success', 'Expenses');
      return out;
    }, { label: 'Add an entry' });
    on('expenses.edit', async (args, ctx) => {
      const { id, ...body } = jsonOf<EntryInput & { id?: string }>(argsOf(args, ctx.payload));
      if (!id) return report(rt, new Error('expenses.edit needs {"id": …}'));
      const out = await call(rt, `entries/${encodeURIComponent(id)}`, { method: 'PATCH', body }).catch((e) => report(rt, e));
      ledgerChanged(); rt.toast('Entry saved.', 'success', 'Expenses');
      return out;
    }, { label: 'Change an entry' });
    on('expenses.totals', (args, ctx) => {
      const by = argsOf(args, ctx.payload);
      return call(rt, `totals${by ? `?by=${encodeURIComponent(by)}` : ''}`).catch((e) => report(rt, e));
    }, { label: 'Ledger totals (by category, account, month or merchant)' });
    on('expenses.export', () => { window.open(`${apiBase(rt)}/export?format=csv`, '_blank', 'noopener'); }, { label: 'Export the ledger as CSV' });
    on('expenses.paydays.get', () => call<PaydaysData>(rt, `paydays?today=${todayIso()}`).catch((e) => report(rt, e)), { label: 'Read paydays (schedule, next, missing)' });
    on('expenses.paydays.fill', async () => {
      const out = await call<{ added: number }>(rt, `paydays?today=${todayIso()}`, { method: 'POST' }).catch((e) => report(rt, e));
      ledgerChanged(); rt.toast(out.added ? `Added ${out.added} payday${out.added === 1 ? '' : 's'}.` : 'Every payday is already in the ledger.', 'success', 'Expenses');
      return out;
    }, { label: 'Add the missing paydays' });
    on('expenses.report.get', (args, ctx) => {
      const [kind = reportState.kind, date = reportState.date || todayIso()] = argsOf(args, ctx.payload).split(':').filter(Boolean);
      return call<StatementData>(rt, `statement?kind=${encodeURIComponent(kind)}&date=${encodeURIComponent(date)}&today=${todayIso()}`).catch((e) => report(rt, e));
    }, { label: 'Read a report (kind:date, e.g. month:2026-11-01)' });
    on('expenses.report', (args, ctx) => {
      const [kind, date] = argsOf(args, ctx.payload).split(':');
      if (kind === 'month' || kind === 'quarter' || kind === 'year') reportState.kind = kind;
      if (date) reportState.date = date;
      rt.navigate('expenses/reports');
    }, { label: 'Open a report (kind:date)' });
    on('expenses.report.copy', async () => {
      const d = await call<StatementData>(rt, `statement?kind=${reportState.kind}&date=${reportState.date || todayIso()}&today=${todayIso()}`).catch((e) => report(rt, e));
      await navigator.clipboard?.writeText(d.markdown);
      rt.toast('Report copied as text.', 'success', 'Expenses');
      return d.markdown;
    }, { label: 'Copy the report on screen as text' });
    on('expenses.assistant.list', () => listConversations(rt).catch((e) => report(rt, e)), { label: 'List assistant conversations' });
    on('expenses.assistant.read', (args, ctx) => readConversation(rt, Number(argsOf(args, ctx.payload))).catch((e) => report(rt, e)), { label: 'Read one assistant conversation' });
    on('expenses.assistant.new', async () => {
      const out = await newConversation(rt).catch((e) => report(rt, e));
      assistantState.id = out.conversation.id; assistantChanged();
      return out;
    }, { label: 'Start a new assistant conversation' });
    on('expenses.assistant.ask', async (args, ctx) => {
      const raw = argsOf(args, ctx.payload);
      const j = jsonOf<{ text?: string; conversation?: number }>(raw);
      const text = (j.text ?? raw).trim();
      if (!text) return report(rt, new Error('expenses.assistant.ask needs a question'));
      let id = j.conversation ?? assistantState.id;
      if (id == null) { id = (await newConversation(rt).catch((e) => report(rt, e))).conversation.id; assistantState.id = id; }
      const reply = await ask(rt, id, text).catch((e) => report(rt, e));
      assistantChanged();
      return { conversation: id, reply };
    }, { label: 'Ask the Expenses assistant' });
    on('expenses.settings.get', () => call<SettingsData>(rt, 'settings').catch((e) => report(rt, e)), { label: 'Read the Expense Tracker settings' });
    on('expenses.settings.set', async (args, ctx) => {
      const raw = argsOf(args, ctx.payload);
      let patch: Record<string, unknown> = jsonOf(raw);
      if (!Object.keys(patch).length) {
        const [key = '', ...rest] = raw.split(':');
        const v = rest.join(':');
        patch = { [key]: v === 'true' ? true : v === 'false' ? false : v };
      }
      const out = await patchSettings(rt, patch).catch((e) => report(rt, e));
      ledgerChanged(); rt.toast('Expenses settings saved.', 'success', 'Expenses');
      return out;
    }, { label: 'Change Expense Tracker settings (key:value or JSON)' });
    on('expenses.settings.reset', async (args, ctx) => {
      const keys = argsOf(args, ctx.payload).split(/[,:\s]+/).filter(Boolean);
      if (!keys.length) return report(rt, new Error('expenses.settings.reset needs the keys to reset'));
      const out = await patchSettings(rt, Object.fromEntries(keys.map((k) => [k, null]))).catch((e) => report(rt, e));
      ledgerChanged();
      return out;
    }, { label: 'Put Expense Tracker settings back to their defaults' });
    on('expenses.nav', (args, ctx) => {
      const v = argsOf(args, ctx.payload);
      if (NAV_PLACEMENTS.some((x) => x.value === v)) rt.settings.set(NAV_KEY, v);
      return rt.settings.get(NAV_KEY) ?? 'section';
    }, { label: 'Where Expenses sits in the navigation (section, nested, menu)' });
    on('expenses.refresh', () => ledgerChanged(), { label: 'Re-read the ledger' });
    on('expenses.settings', () => rt.dispatch(`settings.open:${TAB}`), { label: 'Expenses settings…' });
  },
  // Settings → Plugins → Expenses
  settingsTabs: [{ id: TAB, label: 'Expenses', icon: 'chart', order: 40, parent: 'plugins', description: 'The Expense Tracker inside Molly: where its ledger lives.' }],
  settingsPanels: SETTINGS_SECTIONS.map((x, i) => ({ id: `expenses.${x.id}`, tab: TAB, title: x.title, icon: x.icon, order: 20 + i * 10, render: () => <SettingsSection section={x.id} /> })),
  settings: [{ id: 'expenses.connection', label: 'Connection', icon: 'cloud', tab: TAB, order: 10, description: 'The Expense Tracker API Molly reads and writes. You stay signed in through expenses.amberxai.com.',
    settings: [
      { key: API_BASE_KEY, label: 'Ledger API address', kind: 'text', default: DEFAULT_API_BASE, scope: 'device' },
      { key: NAV_KEY, label: 'In the navigation', kind: 'choice', default: 'section', description: NAV_PLACEMENTS.map((x) => `${x.label}: ${x.hint}`).join(' '), options: NAV_PLACEMENTS.map(({ value, label }) => ({ value, label })) },
    ] }],
  // Molly's own menu (its index of every app): the Expenses screens under the Expenses entry
  appMenu: [
    { id: 'expenses.apps', menu: 'molly', menuLabel: 'Molly', after: 'go-expenses', items: [
      ...SCREENS.map((s) => ({ id: `expenses.go.${s.id}`, label: `Expenses ${s.label.toLowerCase()}`, icon: s.icon, action: `expenses.open:${s.id}` })),
      { id: 'expenses.go.settings', label: 'Expenses settings…', icon: 'settings', action: 'expenses.settings' },
    ] },
  ],
  contextMenu: [
    { id: 'expenses.ctx.entry', target: 'expenses-entry', items: [
      { id: 'expenses.ctx.refresh', label: 'Refresh the ledger', icon: 'refresh', action: 'expenses.refresh' },
      { id: 'expenses.ctx.export', label: 'Export CSV', icon: 'download', action: 'expenses.export' },
    ] },
  ],
};
