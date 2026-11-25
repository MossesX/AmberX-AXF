/**
 * Where the Hidden list (HiddenAssetsPanel.tsx, hidden-assets@1) is mounted in the settings library:
 *   - Settings → Appearance → Hidden: a panel of the Appearance tab (it sits with the rest under "Everything else",
 *     anchor `settings-panel:axf.appearance.hidden`, deep link `view:settings/tab:appearance#hidden`);
 *   - the dialog `axf.hidden-assets`: the same list on its own (the Assets menu's Hidden items…, `dialog:axf.hidden-assets`).
 *
 * The settings library (index.tsx) spreads both into what it registers, so every app that installs it has them.
 */
import type { SettingsPanel } from '../../core';
import type { DialogMap } from '../../react';
import { HIDDEN_ASSETS_DIALOG, HiddenAssetsPanel } from './HiddenAssetsPanel';

/** Settings → Appearance → Hidden. */
export const HIDDEN_ASSETS_PANEL_ID = 'axf.appearance.hidden';

/** The Appearance tab's panels that belong to hidden-assets@1 (right after the skin panel, order 0). */
export const hiddenAssetsSettingsPanels: SettingsPanel[] = [
  { id: HIDDEN_ASSETS_PANEL_ID, tab: 'appearance', title: 'Hidden', icon: 'eye', order: 5, render: () => <HiddenAssetsPanel /> },
];

/** The Hidden list as a dialog. Searchable: "hidden" in the app search opens it. */
export const hiddenAssetsDialogs: DialogMap = {
  [HIDDEN_ASSETS_DIALOG]: { title: 'Hidden items', icon: 'eye', searchable: true, render: () => <HiddenAssetsPanel /> },
};
