/**
 * AmberX AXF core types — the cross-platform, cross-application contract.
 * Every UI component and schema-driven object is an *asset* wrapped in an
 * AssetEnvelope. Any app built on AmberX AXF can load any asset of a known type.
 */
import type { SettingsUi } from './engines/settingsui';

// Same order as framework/schemas/asset-types.json (the Kotlin registry's order), so lists derived from it match across ports.
export const ASSET_TYPES = [
  'color-theme',
  'style-theme',
  'layout',
  'app-menu',
  'toolbar',
  'nav-menu',
  'context-menu',
  'tab-group',
  'dialog',
  'popup',
  'button',
  'slider',
  'container',
  'gauge',
  'meter',
  'banner',
  'clock',
  'search-bar',
  'action-button',
  'logo',
  'label',
  'status',
  'counter',
  'progress',
  'avatar',
  'link',
  'theme-switch',
  'spacer',
  'divider',
  'badge',
  'settings',
  'uac-policy',
] as const;

/** Types that are optional: an app may ship none (the framework ships starters). Attachable ones live on a host (the banner). */
export const OPTIONAL_TYPES: readonly AssetType[] = ['tab-group', 'gauge', 'meter', 'banner', 'clock', 'search-bar', 'logo', 'action-button', 'label', 'status', 'counter', 'progress', 'avatar', 'link', 'theme-switch', 'spacer', 'divider', 'badge', 'settings'];

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
  /** May a randomize roll pick this asset? Default comes from the type (engines/roll.ts); runtime overrides win. */
  roll?: boolean;
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
  /* ---- optional fields (asset-types.json → menuItems; engines/appmenu.ts) ---- */
  /** id of a live-list provider (`rt.registerAppMenuProvider`): the item becomes a submenu filled on open */
  provider?: string;
  /** name of a runtime counter shown as a badge (e.g. `alerts.unread`); hidden at 0 */
  badge?: string;
  /** check-mark binding: `setting:<key>` | `counter:<name>` | `slot:<type>` (shown) | `hidden:<type>` */
  checked?: string;
  /** placement among siblings (default 100); `before` / `after` name a sibling id */
  order?: number;
  before?: string;
  after?: string;
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
  menus: { id: string; label: string; items: MenuItem[]; /** placement (default 100), see engines/appmenu.ts */ order?: number }[];
  density?: ChromeDensity;
  surface?: ChromeSurface;
}

export interface ToolbarItem {
  id: string;
  icon: string;
  label: string;
  action: string;
  requires?: string;
  /** name of a runtime counter to show as a badge on the button (e.g. `alerts.unread`); hidden at 0 */
  badge?: string;
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
  /** live search box (see ToolbarSearch); absent or live:false = classic submit-to-jump box */
  search?: ToolbarSearch;
  /** widget assets (clock, search bar) at the toolbar's start or end (core/engines/widgets.ts) */
  widgets?: ToolbarWidget[];
  /** a chevron at the end folds the toolbar to a thin handle and back (default false); remembered per device */
  collapsible?: boolean;
}

/** Toolbar search behaviour. Results come from the runtime's search index (engines/search.ts). */
export interface ToolbarSearch {
  /** dropdown that updates on every keystroke */
  live: boolean;
  placeholder?: string;
  /** default 12 */
  maxResults?: number;
  /** Ctrl/Cmd+K and / focus this box (default true) */
  shortcut?: boolean;
  /** limit results to these kinds (default: all) */
  kinds?: string[];
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

/* ---------- banner + attachables (core/engines/banner.ts) ---------- */

export type BannerSide = 'left' | 'center' | 'right';
export interface BannerAttach { type: string; id: string; at: BannerSide; order?: number }
export interface BannerData {
  /** px, 16 to 48 (thin = 24) */
  height: number;
  surface: 'flat' | 'raised' | 'accent';
  logo: { show: boolean; text: string };
  attach: BannerAttach[];
  divider?: boolean;
}
export interface ClockData {
  format: '24h' | '12h';
  seconds: boolean;
  date: 'none' | 'short' | 'weekday';
  timezone?: string;
  mono?: boolean;
}
export interface SearchBarData {
  placeholder: string;
  maxResults: number;
  width: 'compact' | 'regular' | 'wide';
  kinds?: string[];
  shortcut?: boolean;
}
/** A widget placed on a toolbar (asset type toolbar → data.widgets). */
export interface ToolbarWidget { type: string; id: string; at: 'start' | 'end'; order?: number }
export type WidgetTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';
/** Widget kinds (asset types with "widget": true besides clock and search bar); rules in engines/widgets.ts. */
export interface LogoData { kind: 'text' | 'image' | 'icon'; text: string; size: 'small' | 'regular' | 'large'; image?: string; icon?: string; link?: string; bold?: boolean; tooltip?: string }
export interface ActionButtonData { icon: string; label: string; action: string; show: 'icon' | 'label' | 'both'; tone?: 'neutral' | 'accent' | 'danger'; tooltip?: string }
export interface LabelData { text: string; tone: WidgetTone; bold?: boolean; mono?: boolean; tooltip?: string }
export interface StatusData { counter: string; onLabel: string; offLabel: string; onTone: WidgetTone; offTone: WidgetTone; link?: string; dot?: boolean }
export interface CounterData { counter: string; tone: WidgetTone; hideAtZero: boolean; icon?: string; label?: string; link?: string; max?: number }
export interface ProgressData { counter: string; max: number; width: 'compact' | 'regular' | 'wide'; label?: string; tone?: WidgetTone; showValue?: boolean }
export interface AvatarData { source: 'account' | 'text' | 'image'; size: 'small' | 'regular' | 'large'; shape: 'circle' | 'rounded'; text?: string; image?: string; link?: string; tooltip?: string }
export interface LinkData { label: string; href: string; external: boolean; icon?: string; tooltip?: string }
export interface ThemeSwitchData { light: string; dark: string; show: 'icon' | 'label' | 'both'; lightLabel?: string; darkLabel?: string; tooltip?: string }
export interface SpacerData { size: 'small' | 'regular' | 'large' | 'flex' }
export interface DividerData { inset: boolean }
export interface BadgeData {
  icon: string;
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';
  shape: 'pill' | 'icon' | 'dot';
  tooltip?: string;
  link?: string;
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

/** Gauge control asset: how every dial looks (engines/components.ts gaugeStyle). */
export interface GaugeData {
  shape: 'arc' | 'ring' | 'bar' | 'digital';
  /** stroke / bar thickness, 4–16 (drawing units of a 120-wide gauge) */
  thickness: number;
  needle: boolean;
  /** tick marks along the scale, 0–10 */
  ticks: number;
  cap: 'round' | 'square';
  readout: 'big' | 'small' | 'none';
}

/** Progress meter control asset: how every progress bar looks (engines/components.ts meterStyle). */
/** tab-group asset: how every tab row looks (page tabs + window tab bars). Engine tabGroupStyle (engines/components.ts). */
export interface TabGroupData {
  style: 'underline' | 'pills' | 'boxed' | 'segmented' | 'plain';
  align: 'start' | 'center' | 'end' | 'stretch';
  position?: 'top' | 'bottom';
  density?: ChromeDensity;
  overflow?: 'scroll' | 'wrap';
  showIcons?: boolean;
  divider?: boolean;
}

export interface MeterData {
  shape: 'bar' | 'segments' | 'steps' | 'line';
  /** bar height in px, 2–24 */
  height: number;
  radius: 'pill' | 'soft' | 'square';
  stripes: boolean;
  animated: boolean;
  fill: 'solid' | 'gradient' | 'soft';
  /** segments for shape segments / steps, 4–40 (default 20) */
  segments?: number;
}

export interface ContainerData {
  variant: 'card' | 'panel' | 'glass' | 'outline';
  header: 'plain' | 'divided' | 'accent';
  padding: 'sm' | 'md' | 'lg';
  elevation: 0 | 1 | 2 | 3;
  collapsible: boolean;
}

/* ---------- system ---------- */

/** Settings interface asset: the settings page as data, shared by every app that loads it (engines/settingsui.ts). */
export type SettingsData = Pick<SettingsUi, 'layout' | 'header' | 'search' | 'descriptions'> & Partial<Pick<SettingsUi, 'tabs' | 'hide' | 'groups'>>;

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
  gauge: GaugeData;
  meter: MeterData;
  'tab-group': TabGroupData;
  container: ContainerData;
  banner: BannerData;
  clock: ClockData;
  'search-bar': SearchBarData;
  logo: LogoData;
  'action-button': ActionButtonData;
  label: LabelData;
  status: StatusData;
  counter: CounterData;
  progress: ProgressData;
  avatar: AvatarData;
  link: LinkData;
  'theme-switch': ThemeSwitchData;
  spacer: SpacerData;
  divider: DividerData;
  badge: BadgeData;
  settings: SettingsData;
  'uac-policy': UACPolicyData;
}

export type Asset<K extends AssetType> = AssetEnvelope<AssetDataMap[K]>;
/** Active asset id per slot. Optional control types added after apps already shipped (gauge, meter, settings) may be absent from an app's manifest. */
export type ActiveAssets = { [K in Exclude<AssetType, LateOptionalType>]: string } & { [K in LateOptionalType]?: string };
/** Types added after apps shipped manifests: their defaults may be missing (the engines fall back to built-in defaults). */
export type LateOptionalType = 'tab-group' | 'gauge' | 'meter' | 'settings';

export interface AxfManifest {
  $axf: 'manifest@1';
  app: { id: string; name: string; version: string };
  framework: { version: string; template: string };
  initializedAt?: string;
  targets: string[];
  startView?: string;
  defaults: ActiveAssets;
  /** Chrome slots hidden by default (hideable types only, e.g. `["toolbar"]`); the user can still show them in Settings → Appearance. */
  hidden?: string[];
  /**
   * Developer app (Brett's decision, Oct 20 2026): its appearance and settings documents live on the axHub data
   * server (`hub` = the hub's https origin); the app waits for the hub instead of running without it. Absent = an
   * ordinary app with its own local settings. Templates read it and attach the hub appearance source.
   */
  developer?: { hub: string };
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
  /** Developer apps: the appearance source's state (engines/appearance.ts); null = no source (ordinary app). */
  appearance?: import('./engines/appearance').AppearanceSourceState | null;
  role: string;
  view: string;
  dialog: { id: string; props?: Record<string, unknown> } | null;
  toasts: Toast[];
  context: { x: number; y: number; target: string; payload?: string } | null;
  /** increments on every state change */
  rev: number;
  /** increments on every successful hot-swap */
  swaps: number;
  /** A short message popping out of a banner attachment (key = `type:id`), e.g. a status badge on load. */
  bannerPopup?: { key: string; text: string; until: number } | null;
}

export type Gate = 'allow' | 'disable' | 'hide';
