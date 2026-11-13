/**
 * console-control@1 rules (spec/CONSOLE-CONTROL.md; build full-api-and-voice-control, Nov 13 2026): the address grammar
 * (kinds, which kind may follow which), the ten verbs with their effects and permissions, the wire codes, the JSON Schemas
 * for the address, the command, the answer and the target / scroll state, and the registry snapshot
 * (framework/schemas/console-control.json). Pure and dependency-free, so the build engine (axf schemas), the console
 * server, the CLI and the TS engine (console-control.ts) all read one definition.
 *
 * Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */

export const CONSOLE_CONTROL_FRAME = 'console-control@1';
export const CONSOLE_CONTROL_TARGETS_FRAME = 'console-control-targets@1';

/** Address segment kinds, outermost first in an address. Append-only. */
export const CONSOLE_CONTROL_KINDS = ['view', 'tab', 'subtab', 'setting', 'button', 'function', 'plugin', 'grid', 'row', 'step', 'panel', 'scroll'];

/** Which kinds a segment may follow (`null` = may open an address). Order inside an address is outermost first. */
export const CONSOLE_CONTROL_PARENTS = {
  view: [null],
  tab: [null, 'view', 'panel'],
  subtab: ['tab', 'subtab'],
  setting: [null, 'view', 'tab', 'subtab', 'panel'],
  button: [null, 'view', 'tab', 'subtab', 'panel', 'row', 'step'],
  function: [null, 'view', 'tab', 'subtab', 'panel'],
  plugin: [null, 'view', 'tab', 'subtab'],
  grid: [null, 'view', 'tab', 'subtab', 'panel'],
  row: [null, 'grid'],
  step: [null, 'row', 'grid'],
  panel: [null, 'view', 'tab', 'subtab'],
  scroll: [null, 'view', 'tab', 'subtab', 'panel'],
};

/** Kinds whose id has the `<row>=<value>` form (a tab row, or one tab of it). */
export const CONSOLE_CONTROL_VALUED_KINDS = ['tab', 'subtab'];

/** The ten verbs, their effect and the control@1 permission each needs. Append-only. */
export const CONSOLE_CONTROL_VERBS = {
  open: { effect: 'navigate', requires: 'control.console.navigate', takes: ['address', 'options'], doc: 'Bring the target onto the screen: navigate, switch the tab, open the settings tab scrolled to it, expand the row, flash it.' },
  state: { effect: 'read', requires: 'control.console.read', takes: ['address'], doc: 'Read the target: value, type, options, label, disabled, enabled, rows, selection, step status, scroll position.' },
  press: { effect: 'write', requires: 'control.console.write', takes: ['address', 'value'], doc: 'Press a button or run a function (value = its argument).' },
  set: { effect: 'write', requires: 'control.console.write', takes: ['address', 'value'], doc: 'Set a setting, a tab row, or a grid selection to a value.' },
  scroll: { effect: 'navigate', requires: 'control.console.navigate', takes: ['address', 'scroll'], doc: 'Scroll the named (or active) container: up, down, page-up, page-down, top, bottom, or to an address inside it.' },
  focus: { effect: 'navigate', requires: 'control.console.navigate', takes: ['address', 'options'], doc: 'Scroll the target into view, select it, expand it if asked, highlight it, give it keyboard focus. Works on virtualised rows.' },
  search: { effect: 'read', requires: 'control.console.read', takes: ['query'], doc: 'Search every registered target and the search index; answers ranked hits with addresses.' },
  list: { effect: 'read', requires: 'control.console.read', takes: ['address'], doc: 'List every target on the screen in front (or under an address).' },
  'plugin.enable': { effect: 'write', requires: 'control.plugins.write', takes: ['address'], doc: 'Turn a plugin on through the Plugin Manager.' },
  'plugin.disable': { effect: 'write', requires: 'control.plugins.write', takes: ['address'], doc: 'Turn a plugin off; one that cannot be disabled answers invalid and says why.' },
};
export const CONSOLE_CONTROL_VERB_IDS = Object.keys(CONSOLE_CONTROL_VERBS);

/** Verbs that must carry an address (the others may leave it out: the screen / container in front, or words). */
export const CONSOLE_CONTROL_ADDRESS_REQUIRED = ['open', 'press', 'set', 'focus', 'plugin.enable', 'plugin.disable'];

export const CONSOLE_CONTROL_SCROLL_DIRS = ['up', 'down', 'page-up', 'page-down', 'top', 'bottom', 'to'];
/** Default scroll step for up / down: a third of the visible height. */
export const CONSOLE_CONTROL_SCROLL_DEFAULT = 1 / 3;
export const CONSOLE_CONTROL_HIGHLIGHT_MS = 1800;
export const CONSOLE_CONTROL_SEARCH_LIMIT = 12;
export const CONSOLE_CONTROL_SEARCH_MAX = 50;
export const CONSOLE_CONTROL_NEAREST_MAX = 5;
export const CONSOLE_CONTROL_ID_MAX = 160;
export const CONSOLE_CONTROL_ADDRESS_MAX_DEPTH = 8;

/** Wire codes (INTEROP.md; `ambiguous` added by this contract). */
export const CONSOLE_CONTROL_WIRE = {
  INVALID: 'invalid', NOT_FOUND: 'not_found', AMBIGUOUS: 'ambiguous', DENIED: 'denied', VALIDATION: 'validation', UNAVAILABLE: 'unavailable',
  CONFIRMATION_REQUIRED: 'confirmation_required', NOT_IMPLEMENTED: 'not_implemented', UNEXPECTED: 'unexpected',
};
export const CONSOLE_CONTROL_CODES = Object.values(CONSOLE_CONTROL_WIRE);

/** The verbs a target of each kind answers by default (a target may narrow or widen its own `can`). */
export const CONSOLE_CONTROL_DEFAULT_CAN = {
  view: ['open', 'state', 'list', 'scroll'],
  tab: ['open', 'state', 'set', 'focus'],
  subtab: ['open', 'state', 'set', 'focus'],
  setting: ['open', 'state', 'set', 'focus'],
  button: ['open', 'state', 'press', 'focus'],
  function: ['state', 'press'],
  plugin: ['open', 'state', 'plugin.enable', 'plugin.disable'],
  grid: ['open', 'state', 'set', 'focus', 'list', 'scroll'],
  row: ['open', 'state', 'focus', 'set'],
  step: ['open', 'state', 'focus'],
  panel: ['open', 'state', 'focus', 'scroll'],
  scroll: ['state', 'scroll'],
};

export const isConsoleControlKind = (k) => CONSOLE_CONTROL_KINDS.includes(k);
export const isConsoleControlVerb = (v) => Object.prototype.hasOwnProperty.call(CONSOLE_CONTROL_VERBS, v);
export const consoleControlEffect = (verb) => CONSOLE_CONTROL_VERBS[verb]?.effect ?? null;
export const consoleControlPermission = (verb) => CONSOLE_CONTROL_VERBS[verb]?.requires ?? null;

/* ================================================================== JSON Schemas */

const head = (name, title, description) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: `axf/${name}.schema.json`,
  title: `AmberX AXF ${title} (${CONSOLE_CONTROL_FRAME})`,
  description: `Generated from framework/core/engines/console-control-rules.mjs. ${description}`,
});

const KIND_RE = `(${CONSOLE_CONTROL_KINDS.join('|')})`;
/** One segment: `kind:id`, id without `/`. */
export const CONSOLE_CONTROL_SEGMENT_PATTERN = `^${KIND_RE}:[^/]{1,${CONSOLE_CONTROL_ID_MAX}}$`;
/** A whole text address. */
export const CONSOLE_CONTROL_ADDRESS_PATTERN = `^${KIND_RE}:[^/]{1,${CONSOLE_CONTROL_ID_MAX}}(/${KIND_RE}:[^/]{1,${CONSOLE_CONTROL_ID_MAX}}){0,${CONSOLE_CONTROL_ADDRESS_MAX_DEPTH - 1}}$`;

export function jsonSchemas() {
  const segment = { type: 'object', required: ['kind', 'id'], additionalProperties: false, properties: { kind: { enum: CONSOLE_CONTROL_KINDS }, id: { type: 'string', minLength: 1, maxLength: CONSOLE_CONTROL_ID_MAX } } };
  const addressText = { type: 'string', pattern: CONSOLE_CONTROL_ADDRESS_PATTERN, description: 'Text form: kind:id segments joined by /, outermost first (view:builds/tab:pipeline/grid:queue/row:<id>).' };
  const addressObject = { type: 'object', required: ['path'], additionalProperties: false, properties: { path: { type: 'array', minItems: 1, maxItems: CONSOLE_CONTROL_ADDRESS_MAX_DEPTH, items: segment } } };
  const address = { ...head('console-control-address', 'console-control address', 'One address for anything the console shows: text or object form.'), anyOf: [addressText, addressObject], $defs: { segment } };
  const scrollState = {
    type: 'object', required: ['container', 'top', 'left', 'height', 'extent', 'atTop', 'atBottom', 'fraction'], additionalProperties: false,
    properties: {
      container: { type: 'string', description: 'the scroll container address (scroll:main for the main pane)' },
      top: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 },
      height: { type: 'number', minimum: 0, description: 'visible height (px)' }, extent: { type: 'number', minimum: 0, description: 'scrollable height (px)' },
      atTop: { type: 'boolean' }, atBottom: { type: 'boolean' },
      fraction: { type: 'number', minimum: 0, maximum: 1, description: 'top / max(1, extent - height), three decimals' },
    },
  };
  const target = {
    type: 'object', required: ['address', 'kind', 'label'], additionalProperties: false,
    properties: {
      address: addressText, kind: { enum: CONSOLE_CONTROL_KINDS }, label: { type: 'string', maxLength: 200 },
      detail: { type: 'string', maxLength: 200 }, icon: { type: 'string', maxLength: 60 },
      keywords: { type: 'array', maxItems: 24, items: { type: 'string', maxLength: 80 } },
      requires: { type: 'string', maxLength: 120, description: 'UAC permission the target itself needs' },
      can: { type: 'array', uniqueItems: true, items: { enum: CONSOLE_CONTROL_VERB_IDS } },
      parent: addressText,
      value: { description: 'current value as text (a setting, a tab row, a selection); never for secrets' },
      disabled: { type: 'boolean' }, destructive: { type: 'boolean', description: 'pressing it deletes something: the confirm flow applies' },
      virtual: { type: 'boolean', description: 'a grid row not materialised yet; focus asks the grid to render it first' },
    },
  };
  const scrollSpec = {
    type: 'object', required: ['dir'], additionalProperties: false,
    properties: {
      dir: { enum: CONSOLE_CONTROL_SCROLL_DIRS },
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000, description: 'px, or a fraction of the visible height when <= 1 (default 1/3)' },
      to: { anyOf: [addressText, addressObject], description: 'dir to: the address to scroll to inside the container' },
    },
  };
  const options = {
    type: 'object', additionalProperties: false,
    properties: { select: { type: 'boolean', default: true }, expand: { type: 'boolean' }, highlight: { type: 'boolean', default: true }, highlightMs: { type: 'integer', minimum: 0, maximum: 60000, default: CONSOLE_CONTROL_HIGHLIGHT_MS } },
  };
  const query = {
    type: 'object', required: ['q'], additionalProperties: false,
    properties: { q: { type: 'string', minLength: 1, maxLength: 200 }, kinds: { type: 'array', maxItems: CONSOLE_CONTROL_KINDS.length, items: { enum: CONSOLE_CONTROL_KINDS } }, limit: { type: 'integer', minimum: 1, maximum: CONSOLE_CONTROL_SEARCH_MAX, default: CONSOLE_CONTROL_SEARCH_LIMIT } },
  };
  const command = {
    ...head('console-control-command', 'console-control command', 'One verb on one address, the same on REST, MCP, the CLI and voice.'),
    type: 'object', required: ['verb'], additionalProperties: false,
    properties: {
      $axf: { const: CONSOLE_CONTROL_FRAME },
      verb: { enum: CONSOLE_CONTROL_VERB_IDS },
      address: { anyOf: [addressText, addressObject] },
      value: { description: 'set: the new value (true / false / "toggle", a number, a choice, text, a list); press: the function argument' },
      scroll: scrollSpec,
      query,
      options,
      confirm: { type: 'string', maxLength: 200, description: 'the confirm token a destructive press sends on its second call' },
      by: { type: 'string', maxLength: 80 }, reason: { type: 'string', maxLength: 400 },
    },
    allOf: CONSOLE_CONTROL_ADDRESS_REQUIRED.map((v) => ({ if: { properties: { verb: { const: v } } }, then: { required: ['verb', 'address'] } }))
      .concat([{ if: { properties: { verb: { const: 'search' } } }, then: { required: ['verb', 'query'] } }, { if: { properties: { verb: { const: 'scroll' } } }, then: { required: ['verb', 'scroll'] } }]),
    $defs: { segment, scrollSpec, options, query },
  };
  const hit = { type: 'object', required: ['address', 'kind', 'label', 'score'], properties: { address: addressText, kind: { type: 'string' }, label: { type: 'string' }, detail: { type: 'string' }, score: { type: 'number' } } };
  const result = {
    ...head('console-control-result', 'console-control answer', 'What a console-control command answers: ok with data per verb, or a wire code with the extras that explain it.'),
    type: 'object', required: ['$axf', 'ok'],
    properties: {
      $axf: { const: CONSOLE_CONTROL_FRAME }, ok: { type: 'boolean' }, verb: { enum: CONSOLE_CONTROL_VERB_IDS }, address: addressText,
      opened: addressText, focused: addressText, pressed: addressText, changed: { type: 'array', items: addressText }, value: {}, result: {}, view: { type: 'string' },
      state: {}, scroll: scrollState, hits: { type: 'array', items: hit }, targets: { type: 'array', items: target },
      plugin: { type: 'string' }, enabled: { type: 'boolean' },
      audit: { type: 'object', required: ['by', 'reason', 'at'], properties: { by: { type: 'string' }, reason: { type: 'string' }, at: { type: 'string', format: 'date-time' } } },
      code: { enum: CONSOLE_CONTROL_CODES }, message: { type: 'string' },
      field: { type: 'string' }, segment: { type: 'string' }, nearest: { type: 'array', maxItems: CONSOLE_CONTROL_NEAREST_MAX, items: addressText },
      candidates: { type: 'array', items: addressText }, requires: { type: 'string' }, because: { type: 'string' }, confirm: { type: 'string' }, can: { type: 'array', items: { enum: CONSOLE_CONTROL_VERB_IDS } },
      problems: { type: 'array', items: { type: 'string' } },
    },
    allOf: [
      { if: { properties: { ok: { const: true } } }, then: { required: ['$axf', 'ok', 'verb'] } },
      { if: { properties: { ok: { const: false } } }, then: { required: ['$axf', 'ok', 'code', 'message'] } },
    ],
    $defs: { scrollState, target, hit },
  };
  const targets = {
    ...head('console-control-targets', 'console-control target snapshot', 'What an open console has on screen right now: every addressable target; what the engine resolves against and what list answers.'),
    type: 'object', required: ['$axf', 'view', 'targets'], additionalProperties: false,
    properties: { $axf: { const: CONSOLE_CONTROL_TARGETS_FRAME }, app: { type: 'string', maxLength: 80 }, view: { type: 'string', maxLength: 160 }, at: { type: 'string', format: 'date-time' }, scroll: scrollState, targets: { type: 'array', maxItems: 5000, items: target } },
    $defs: { target, scrollState },
  };
  return {
    'console-control-address.schema.json': address,
    'console-control-command.schema.json': command,
    'console-control-result.schema.json': result,
    'console-control-targets.schema.json': targets,
  };
}

/** The registry snapshot (framework/schemas/console-control.json): what every port and every transport reads. */
export function consoleControlRegistry() {
  return {
    $axf: CONSOLE_CONTROL_FRAME,
    targetsFrame: CONSOLE_CONTROL_TARGETS_FRAME,
    kinds: CONSOLE_CONTROL_KINDS,
    parents: CONSOLE_CONTROL_PARENTS,
    valuedKinds: CONSOLE_CONTROL_VALUED_KINDS,
    verbs: CONSOLE_CONTROL_VERBS,
    addressRequired: CONSOLE_CONTROL_ADDRESS_REQUIRED,
    defaultCan: CONSOLE_CONTROL_DEFAULT_CAN,
    scroll: { dirs: CONSOLE_CONTROL_SCROLL_DIRS, defaultFraction: CONSOLE_CONTROL_SCROLL_DEFAULT },
    limits: { idMax: CONSOLE_CONTROL_ID_MAX, depthMax: CONSOLE_CONTROL_ADDRESS_MAX_DEPTH, searchDefault: CONSOLE_CONTROL_SEARCH_LIMIT, searchMax: CONSOLE_CONTROL_SEARCH_MAX, nearestMax: CONSOLE_CONTROL_NEAREST_MAX, highlightMs: CONSOLE_CONTROL_HIGHLIGHT_MS },
    codes: CONSOLE_CONTROL_CODES,
    patterns: { segment: CONSOLE_CONTROL_SEGMENT_PATTERN, address: CONSOLE_CONTROL_ADDRESS_PATTERN },
    schemas: jsonSchemas(),
  };
}
