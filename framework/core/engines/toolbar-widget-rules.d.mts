/** Types for toolbar-widget-rules.mjs (toolbar-widgets@1). */

export const TOOLBAR_WIDGETS_CONTRACT: 'toolbar-widgets@1';
export const TOOLBAR_APP_INSTANCE: 'app';
export const TOOLBAR_WIDGETS_MAX: number;
export const TOOLBAR_PERSON_ORDER: number;
export const TOOLBARS_WIDGET_STYLE_KEY: 'axf.toolbars.widgetStyle';
export function TOOLBAR_WIDGETS_KEY(instance: string): string;
export function TOOLBAR_WIDGET_STYLE_KEY(instance: string): string;
export function toolbarInstanceOfKey(key: unknown): string | null;

export interface HostEntryWidgetSpec {
  sizes: readonly string[];
  shows: readonly string[];
  priority: { min: number; max: number; default: number };
  widthUnits: readonly string[];
  aliasesMax: number;
}
export const HOST_ENTRY_WIDGET: HostEntryWidgetSpec;
export const HOST_ENTRY_WIDGET_FIELDS: readonly string[];
export const WIDGET_STYLE_FIELDS: readonly string[];
export const ASSET_ID: RegExp;
export const TOOLBAR_INSTANCE: RegExp;
export function isToolbarInstanceId(v: unknown): v is string;
export function isShapeId(v: unknown): v is string;

export function hostEntryErrors(path: string, entry: unknown): string[];
export function hostShapeErrors(shape: unknown, path?: string): string[];
export function hostWidgetStyleErrors(field: string, data: unknown): string[];
