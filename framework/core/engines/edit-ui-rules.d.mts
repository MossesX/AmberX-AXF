// Types for edit-ui-rules.mjs (edit-ui@1; shared by the TS engines, the build engine and the console server).
export type EditUiMode = 'off' | 'armed' | 'held' | 'editing';
export type EditUiGate = 'ctrl' | 'touch';
export type EditUiEventType = 'enable' | 'disable' | 'ctrl-down' | 'ctrl-up' | 'window-blur' | 'long-press' | 'begin' | 'commit' | 'cancel';
export type EditUiTargetKind = 'text' | 'cell' | 'column' | 'property' | 'token';
export type EditUiProp = 'size' | 'colour' | 'icon' | 'order' | 'hide' | 'label';
export type EditUiColumnProp = 'label' | 'width' | 'order' | 'hide';
export type EditUiOwnerKind = 'asset-token' | 'asset-property' | 'hidden-assets' | 'data' | 'read-only';
export type EditUiReason = 'off' | 'not-held' | 'busy' | 'bad-target' | 'unknown-asset' | 'unknown-source' | 'no-writer' | 'code-text' | 'locked' | 'permission' | 'owner-unavailable' | 'nothing-to-undo' | 'nothing-to-redo';
export type EditUiAction = 'editui.on' | 'editui.off' | 'editui.toggle' | 'editui.state' | 'editui.set' | 'editui.undo' | 'editui.redo';

export interface EditUiSettingSpec { key: string; label: string; kind: 'toggle'; default: boolean; scope: 'user'; description: string }
export interface EditUiSettingsGroup { id: string; label: string; icon: string; tab: string; order: number; description: string; settings: EditUiSettingSpec[] }

export const EDIT_UI_CONTRACT: 'edit-ui@1';
export const EDIT_UI_TARGET_FRAME: 'edit-ui-target@1';
export const EDIT_UI_OP_FRAME: 'edit-ui-op@1';
export const EDIT_UI_UNDO_FRAME: 'edit-ui-undo@1';
export const EDIT_UI_STATE_FRAME: 'edit-ui-state@1';
export const EDIT_UI_ENABLED_KEY: 'axf.editUi.enabled';
export const EDIT_UI_SETTINGS_GROUP_ID: 'axf.editUi';
export const EDIT_UI_MODES: readonly EditUiMode[];
export const EDIT_UI_GATES: readonly EditUiGate[];
export const EDIT_UI_EVENTS: readonly EditUiEventType[];
export const EDIT_UI_TARGET_KINDS: readonly EditUiTargetKind[];
export const EDIT_UI_PROPS: readonly EditUiProp[];
export const EDIT_UI_COLUMN_PROPS: readonly EditUiColumnProp[];
export const EDIT_UI_TOKEN_PROPS: readonly EditUiProp[];
export const EDIT_UI_HIDE_PROPS: readonly EditUiProp[];
export const EDIT_UI_OWNERS: readonly EditUiOwnerKind[];
export const EDIT_UI_REASONS: readonly EditUiReason[];
export const EDIT_UI_HIDE_BUILD: string;
export const EDIT_UI_HIDE_BY: 'edit-ui';
export const EDIT_UI_UNDO_MAX: number;
export const EDIT_UI_LOOK_PERMISSION: string;
export const EDIT_UI_TEXT_MAX: number;
export const EDIT_UI_ACTIONS: readonly EditUiAction[];
export const EDIT_UI_SETTINGS_GROUP: EditUiSettingsGroup;
export function jsonSchemas(): Record<string, Record<string, unknown>>;
export function editUiRegistry(): Record<string, unknown>;
