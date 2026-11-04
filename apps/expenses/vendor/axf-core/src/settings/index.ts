/**
 * @file Module settings — the barrel. `decl.ts` is the Node leaf (types +
 * pure validation), `store.ts` the runtime (one generic store, the registry,
 * the dialog's UI store), `SettingsDialog.tsx` the one shell-owned surface.
 */
export { validateSettingsDecl, settingsDefaults } from "./decl";
export type {
  ModuleSettingsDecl,
  SettingKind,
  SettingOption,
  SettingRow,
  SettingValue
} from "./decl";

export {
  ModuleSettingsStore,
  SettingsRegistry,
  SettingsRegistryError,
  settings,
  registerModuleSettings,
  getModuleSettings,
  useModuleSettings,
  settingsUi,
  setHostedModule,
  hostedModule
} from "./store";
export type { SettingsValues } from "./store";

export {
  SettingsGateRegistry,
  settingsGates,
  registerSettingsGate,
  useSettingsGates
} from "./gates";
export type { SettingsGate } from "./gates";

export { SettingsDialog, InlineSettings, PopsUpInRow, SettingsBody, settingsTitle } from "./SettingsDialog";

// settings-placement@1 (Nov 4 2026): where each screen's settings open — dialog, side panel, bottom sheet, inside, page, window
export { PLACEMENT_CHOICES, CHOICE_LABELS, SYSTEM_DEFAULT, PLACEMENT_NS, PlacementStore, settingsPlacement, useSettingsPlacement, resolvePlacement, isChoice } from "./placement";
export type { PlacementChoice, PlacementDoc } from "./placement";
