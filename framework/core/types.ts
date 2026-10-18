/**
 * AmberX AXF core types — the cross-platform, cross-application contract.
 * Every UI component and schema-driven object is an *asset* wrapped in an
 * AssetEnvelope. Any app built on AmberX AXF can load any asset of a known type.
 */

export const ASSET_TYPES = [
  'color-theme',
  'style-theme',
  'layout',
  'app-menu',
  'toolbar',
  'nav-menu',
  'context-menu',
  'dialog',
  'popup',
  'button',
  'slider',
  'container',
  'uac-policy',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetEnvelope<T = unknown> {
  $axf: 'asset@1';
  type: AssetType;
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
  data: T;
}

/* ---------- shared ---------- */

export interface MenuItem {
  id: string;
  label?: string;
  icon?: string;
  /** Action spec, e.g. "file.save" or "swap:color-theme:next" */
  action?: string;
  shortcut?: string;
  /** Permission required (UAC engine) */
  requires?: string;
  items?: MenuItem[];
  separator?: boolean;
}

/* ---------- themes ---------- */

export type ColorToken =
  | 'bg' | 'surface' | 'surface2' | 'surface3' | 'text' | 'muted' | 'border'
  | 'accent' | 'accentText' | 'accentSoft' | 'danger' | 'success' | 'warning'
  | 'info' | 'focus' | 'shadow';

export interface ColorThemeData {
  scheme: 'light' | 'dark';
  tokens: Record<ColorToken, string>;
}

export interface StyleThemeData {
  fontFamily: string;
  fontDisplay: string;
  fontMono: string;
  /** base font size in px */
  fontSize: number;
  radius: { sm: number; md: number; lg: number };
  /** base spacing unit in px */
  space: number;
  borderWidth: number;
  shadow: { sm: string; md: string; lg: string };
  density: 'compact' | 'comfortable' | 'spacious';
  /** transition duration in ms */
  motion: number;
  /** backdrop blur in px (glass surfaces) */
  blur: number;
  headingWeight: number;
  /** heading letter-spacing in em */
  tracking: number;
  /* ---- transparency (0..1, optional; defaults in engines/theme.ts OPACITY_DEFAULTS) ---- */
  /** disabled controls */
  opacityDisabled?: number;
  /** de-emphasised content (secondary icons, closed-tab buttons) */
  opacityMuted?: number;
  /** hover / pressed wash over a surface */
  opacityHover?: number;
  /** soft status and accent tints (backgrounds behind success/warning/danger/info) */
  opacityTint?: number;
  /** backdrop behind dialogs, sheets and lightboxes */
  opacityScrim?: number;
  /** glass surfaces (how much of the surface colour a frosted panel keeps) */
  opacityGlass?: number;
  /* ---- behaviour ---- */
  /** every section / group (Container) gets a collapse toggle top-right; build option --wrap-groups (default false) */
  wrapGroups?: boolean;
}

export interface LayoutData {
  nav: 'left' | 'right' | 'top';
  navWidth: number;
  showMenubar: boolean;
  showToolbar: boolean;
  toolbarPosition: 'top' | 'bottom';
  showStatusbar: boolean;
  inspector: 'left' | 'right' | 'none';
  inspectorWidth: number;
  contentMaxWidth: number;
  /** region → asset types it accepts; overrides the defaults in asset-types.json (layout.slots.defaults) */
  slots?: Partial<Record<string, string[]>>;
}

/** Shared density / surface vocabulary for chrome assets (toolbar, nav-menu, app-menu). */
export type ChromeDensity = 'compact' | 'regular' | 'roomy';
export type ChromeSurface = 'flat' | 'raised' | 'glass';

/* ---------- navigation ---------- */

export interface AppMenuData {
  menus: { id: string; label: string; items: MenuItem[] }[];
  density?: ChromeDensity;
  surface?: ChromeSurface;
}

export interface ToolbarItem {
  id: string;
  icon: string;
  label: string;
  action: string;
  requires?: string;
}

export interface ToolbarData {
  variant: 'icons' | 'icons-labels' | 'labels';
  align: 'start' | 'center' | 'spread';
  groups: { id: string; items: ToolbarItem[] }[];
  showSearch: boolean;
  window?: string;
  density?: ChromeDensity;
  surface?: ChromeSurface;
  /** rule between item groups (default true) */
  divider?: boolean;
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  view: string;
  badge?: string;
  requires?: string;
}

export interface NavMenuData {
  style: 'list' | 'pills' | 'rail';
  header?: string;
  sections: { label?: string; items: NavItem[] }[];
  density?: ChromeDensity;
  indicator?: 'auto' | 'bar' | 'fill' | 'none';
  /** default true */
  showIcons?: boolean;
}

export interface ContextMenuData {
  variant: 'compact' | 'roomy' | 'glass';
  showIcons: boolean;
  showShortcuts: boolean;
  /** target name -> items. "default" is required and used as fallback. */
  targets: Record<string, MenuItem[]>;
}

/* ---------- overlays ---------- */

export interface DialogData {
  variant: 'modal' | 'drawer' | 'sheet';
  width: number;
  backdrop: 'dim' | 'blur' | 'none';
  animation: 'scale' | 'slide' | 'fade';
  header: 'plain' | 'accent-bar' | 'filled';
  closeOnBackdrop: boolean;
}

export interface PopupData {
  position: 'top-right' | 'bottom-right' | 'bottom-center' | 'top-center';
  variant: 'solid' | 'outline' | 'minimal';
  duration: number;
  showIcon: boolean;
  maxVisible: number;
}

/* ---------- controls ---------- */

export interface ButtonData {
  shape: 'rounded' | 'pill' | 'square';
  fill: 'solid' | 'soft' | 'outline' | 'gradient';
  weight: number;
  uppercase: boolean;
  size: 'sm' | 'md' | 'lg';
  elevation: boolean;
}

export interface SliderData {
  track: number;
  thumb: 'circle' | 'square' | 'bar';
  thumbSize: number;
  fill: 'solid' | 'gradient' | 'none';
  showValue: 'always' | 'hover' | 'never';
  ticks: boolean;
}

export interface ContainerData {
  variant: 'card' | 'panel' | 'glass' | 'outline';
  header: 'plain' | 'divided' | 'accent';
  padding: 'sm' | 'md' | 'lg';
  elevation: 0 | 1 | 2 | 3;
  collapsible: boolean;
}

/* ---------- system ---------- */

export interface UACRole {
  id: string;
  label: string;
  description?: string;
  /** permission ids; "*" = all, "assets.*" = namespace wildcard */
  permissions: string[];
  inherits?: string[];
}

export interface UACPolicyData {
  defaultRole: string;
  /** how denied UI is rendered */
  gating: 'hide' | 'disable';
  roles: UACRole[];
  /** permission id -> description */
  permissions: Record<string, string>;
}

/* ---------- maps ---------- */

export interface AssetDataMap {
  'color-theme': ColorThemeData;
  'style-theme': StyleThemeData;
  layout: LayoutData;
  'app-menu': AppMenuData;
  toolbar: ToolbarData;
  'nav-menu': NavMenuData;
  'context-menu': ContextMenuData;
  dialog: DialogData;
  popup: PopupData;
  button: ButtonData;
  slider: SliderData;
  container: ContainerData;
  'uac-policy': UACPolicyData;
}

export type Asset<K extends AssetType> = AssetEnvelope<AssetDataMap[K]>;
export type ActiveAssets = { [K in AssetType]: string };

export interface AxfManifest {
  $axf: 'manifest@1';
  app: { id: string; name: string; version: string };
  framework: { version: string; template: string };
  initializedAt?: string;
  targets: string[];
  startView?: string;
  defaults: ActiveAssets;
  structure?: { path: string; purpose: string }[];
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  message: string;
}

export interface AxfState {
  active: ActiveAssets;
  role: string;
  view: string;
  dialog: { id: string; props?: Record<string, unknown> } | null;
  toasts: Toast[];
  context: { x: number; y: number; target: string; payload?: string } | null;
  /** increments on every state change */
  rev: number;
  /** increments on every successful hot-swap */
  swaps: number;
}

export type Gate = 'allow' | 'disable' | 'hide';
