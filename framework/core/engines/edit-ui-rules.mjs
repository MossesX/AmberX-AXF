/*
 * edit-ui@1 rules (spec/EDIT-UI.md): the constants, the settings block and the JSON Schemas of the Edit UI mode.
 *
 * Brett, Nov 17 2026: "I need a way to inline edit anything. We need an Edit UI. When Edit UI is on, it only works
 * when I'm also holding down Control."
 *
 * Plain ESM so the TS engine (engines/edit-ui.ts, edit-ui-undo.ts), the build engine (`axf schemas` → schemas/json),
 * the console server and the CLI all read one set of names. The registry snapshot is framework/schemas/edit-ui.json.
 */

export const EDIT_UI_CONTRACT = 'edit-ui@1';
export const EDIT_UI_TARGET_FRAME = 'edit-ui-target@1';
export const EDIT_UI_OP_FRAME = 'edit-ui-op@1';
export const EDIT_UI_UNDO_FRAME = 'edit-ui-undo@1';
export const EDIT_UI_STATE_FRAME = 'edit-ui-state@1';

/** The one setting: Edit UI on or off (per user, per app; never part of the look). */
export const EDIT_UI_ENABLED_KEY = 'axf.editUi.enabled';
/** The settings group id (Settings → General → Edit UI). */
export const EDIT_UI_SETTINGS_GROUP_ID = 'axf.editUi';

/** The gate's modes (spec → The gate). */
export const EDIT_UI_MODES = ['off', 'armed', 'held', 'editing'];
/** How the open edit was gated: Ctrl held (released = cancelled) or a long-press (stays until commit / cancel). */
export const EDIT_UI_GATES = ['ctrl', 'touch'];
/** Every event the reducer understands; anything else leaves the state as it was. */
export const EDIT_UI_EVENTS = ['enable', 'disable', 'ctrl-down', 'ctrl-up', 'window-blur', 'long-press', 'begin', 'commit', 'cancel'];

/** Target kinds (spec → Edit targets). */
export const EDIT_UI_TARGET_KINDS = ['text', 'cell', 'column', 'property', 'token'];
/** What a `property` target may change on an asset instance. */
export const EDIT_UI_PROPS = ['size', 'colour', 'icon', 'order', 'hide', 'label'];
/** What a `column` target may change on a column header. */
export const EDIT_UI_COLUMN_PROPS = ['label', 'width', 'order', 'hide'];
/** Props that are look tokens (owner asset-token). */
export const EDIT_UI_TOKEN_PROPS = ['size', 'colour'];
/** Props that go through the hide-any-asset contract (owner hidden-assets). */
export const EDIT_UI_HIDE_PROPS = ['hide'];

/** Owner kinds (spec → Owners). */
export const EDIT_UI_OWNERS = ['asset-token', 'asset-property', 'hidden-assets', 'data', 'read-only'];
/** Refusal reasons; the UI shows them as a toast, the API returns them as `reason`. */
export const EDIT_UI_REASONS = ['off', 'not-held', 'busy', 'bad-target', 'unknown-asset', 'unknown-source', 'no-writer', 'code-text', 'locked', 'permission', 'owner-unavailable', 'nothing-to-undo', 'nothing-to-redo'];

/** The hide-any-asset build this contract shares its hide / unhide with (spec → Hide / unhide). */
export const EDIT_UI_HIDE_BUILD = 'rebuild-fresh-main-hide-any-asset';
/** `by` on a hidden-assets entry written through the Edit UI. */
export const EDIT_UI_HIDE_BY = 'edit-ui';

/** Undo stack depth; older entries fall off the bottom. */
export const EDIT_UI_UNDO_MAX = 100;
/** The permission a look owner needs (asset-token, asset-property, hidden-assets). */
export const EDIT_UI_LOOK_PERMISSION = 'assets.swap';
/** Longest text an inline edit may save (a label, a cell); longer is refused as bad-target. */
export const EDIT_UI_TEXT_MAX = 4000;

/** The actions every transport reaches (spec → API). */
export const EDIT_UI_ACTIONS = ['editui.on', 'editui.off', 'editui.toggle', 'editui.state', 'editui.set', 'editui.undo', 'editui.redo'];

/** The settings-registry block: the group the runtime adds, with its one setting. */
export const EDIT_UI_SETTINGS_GROUP = {
  id: EDIT_UI_SETTINGS_GROUP_ID,
  label: 'Edit UI',
  icon: 'edit',
  tab: 'general',
  order: 45,
  description: 'Inline-edit anything on the screen. With Edit UI on, hold Ctrl (long-press on a phone) and click the thing to edit it; let go of Ctrl to stop. Every edit saves where that value lives (the look, a data source) and can be undone with Ctrl+Z.',
  settings: [
    { key: EDIT_UI_ENABLED_KEY, label: 'Edit UI', kind: 'toggle', default: false, scope: 'user', description: 'On: hold Ctrl and click anything to edit it inline. Off: Ctrl does nothing.' },
  ],
};

const head = (name, title, description) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `axf/${name}.schema.json`,
  title: `AmberX AXF ${title} (${EDIT_UI_CONTRACT})`,
  description: `Generated from framework/core/engines/edit-ui-rules.mjs. ${description}`,
});

const id = { type: 'string', minLength: 1, maxLength: 200 };
const scalar = { description: 'a scalar value: text, number, boolean or null', type: ['string', 'number', 'boolean', 'null'] };

/** The target definition shared by the op and the undo entry. */
function targetSchema() {
  return {
    type: 'object', required: ['kind'],
    properties: {
      kind: { enum: EDIT_UI_TARGET_KINDS },
      id: { ...id, description: 'text: the element\'s console-control address when it has one (button:…, tab:…)' },
      assetType: id, assetId: id, instance: id,
      path: { type: 'string', maxLength: 300, description: 'a dotted path inside the asset data or token map (menus.0.items.2.label, accent)' },
      source: { ...id, description: 'cell / text: the data source id' }, record: id, field: id,
      grid: { ...id, description: 'column: the grid instance' }, column: id,
      prop: { enum: [...new Set([...EDIT_UI_PROPS, ...EDIT_UI_COLUMN_PROPS])], description: 'property: size, colour, icon, order, hide, label; column: label, width, order, hide' },
      slot: { ...id, description: 'token: the control@1 token target (tokens.theme, tokens.style, …)' },
    },
  };
}

function ownerSchema() {
  return {
    type: 'object', required: ['kind'],
    properties: {
      kind: { enum: EDIT_UI_OWNERS },
      key: { type: 'string', maxLength: 200, description: 'the settings key, look path or data source the owner writes' },
      reason: { enum: EDIT_UI_REASONS, description: 'read-only: why' },
      detail: { type: 'string', maxLength: 300, description: 'read-only: the reason in words' },
    },
  };
}

/** JSON Schemas `axf schemas` writes to framework/schemas/json. */
export function jsonSchemas() {
  const target = { ...head('edit-ui-target', 'edit-ui target', 'What one inline edit is about: a text label, a grid cell, a column header, an asset property or a look token.'), ...targetSchema() };
  const op = {
    ...head('edit-ui-op', 'edit-ui op', 'One committed edit: the target, the owner it saves through, the value before and after.'),
    type: 'object', required: ['$axf', 'target', 'owner', 'before', 'after'],
    properties: { $axf: { const: EDIT_UI_OP_FRAME }, target: targetSchema(), owner: ownerSchema(), before: scalar, after: scalar, gate: { enum: EDIT_UI_GATES } },
  };
  const undo = {
    ...head('edit-ui-undo', 'edit-ui undo entry', 'One record on the undo stack: a committed edit with its id and time; undo re-applies before, redo re-applies after, through the same owner.'),
    type: 'object', required: ['$axf', 'id', 'at', 'target', 'owner', 'before', 'after'],
    properties: {
      $axf: { const: EDIT_UI_UNDO_FRAME }, id: { type: 'string', pattern: '^e-[0-9]+$' }, at: { type: 'string', format: 'date-time' },
      by: { type: 'string', maxLength: 120 }, target: targetSchema(), owner: ownerSchema(), before: scalar, after: scalar,
    },
  };
  return { 'edit-ui-target.schema.json': target, 'edit-ui-op.schema.json': op, 'edit-ui-undo.schema.json': undo };
}

/** The registry snapshot (framework/schemas/edit-ui.json): every list above, the settings block and the actions. */
export function editUiRegistry() {
  return {
    $axf: EDIT_UI_CONTRACT,
    frames: { target: EDIT_UI_TARGET_FRAME, op: EDIT_UI_OP_FRAME, undo: EDIT_UI_UNDO_FRAME, state: EDIT_UI_STATE_FRAME },
    modes: EDIT_UI_MODES, gates: EDIT_UI_GATES, events: EDIT_UI_EVENTS,
    targetKinds: EDIT_UI_TARGET_KINDS, props: EDIT_UI_PROPS, columnProps: EDIT_UI_COLUMN_PROPS, tokenProps: EDIT_UI_TOKEN_PROPS, hideProps: EDIT_UI_HIDE_PROPS,
    owners: EDIT_UI_OWNERS, reasons: EDIT_UI_REASONS,
    hide: { build: EDIT_UI_HIDE_BUILD, by: EDIT_UI_HIDE_BY },
    limits: { undoMax: EDIT_UI_UNDO_MAX, textMax: EDIT_UI_TEXT_MAX },
    lookPermission: EDIT_UI_LOOK_PERMISSION,
    actions: EDIT_UI_ACTIONS,
    settings: { enabledKey: EDIT_UI_ENABLED_KEY, group: EDIT_UI_SETTINGS_GROUP },
  };
}
