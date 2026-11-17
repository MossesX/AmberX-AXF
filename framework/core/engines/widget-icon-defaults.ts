/**
 * Widget icon defaults (widget-icon-defaults@1, schemas/widget-icon-defaults.json): the inventory of every banner and
 * settings widget the console draws and the default icon of each one. A host passes `widgetDefaultIcon(id)` as the
 * widget's own icon when the widget came without one, so a text-only widget gets a fitting icon instead of its kind's.
 * Pure; append-only rows; `registerWidgetDefaultIcon` lets a plugin add its own at run time.
 */
import spec from '../../schemas/widget-icon-defaults.json';
import { WIDGET_ICON_GLYPH_ID, parseWidgetIconId } from './widget-icons';

export interface WidgetDefaultRow { id: string; owner: string; label: string; hadIcon: boolean; longText: boolean; icon: string }

const rows = new Map<string, WidgetDefaultRow>((spec.widgets as WidgetDefaultRow[]).map((w) => [w.id, w]));
const rules = spec.rules as { match: string; icon: string }[];

/** Every inventoried widget (plus the ones registered at run time). */
export function widgetDefaultRows(): WidgetDefaultRow[] { return [...rows.values()]; }

/** Add or replace a widget's default icon (a plugin's own widget). Bad ids or glyphs are ignored. */
export function registerWidgetDefaultIcon(row: Partial<WidgetDefaultRow> & { id: string; icon: string }): void {
  if (!parseWidgetIconId(row.id) || !WIDGET_ICON_GLYPH_ID.test(row.icon)) return;
  const prev = rows.get(row.id);
  rows.set(row.id, { owner: '', label: row.id, hadIcon: false, longText: false, ...prev, ...row });
}

/** The default icon of one widget: its row, else the first rule whose `<host>:<kind>:*` matches, else undefined. */
export function widgetDefaultIcon(id: string): string | undefined {
  const row = rows.get(id);
  if (row) return row.icon;
  for (const r of rules) if (r.match.endsWith('*') && id.startsWith(r.match.slice(0, -1))) return r.icon;
  return undefined;
}
