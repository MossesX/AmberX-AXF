/**
 * The seed project: "AmberX AXF — the complete walkthrough". Every framework area, setting, switch, engine, plugin and
 * flow as a narrated piece with its cue track and the example of its effect to show on screen. Written as a compact
 * outline (T = section, P = piece) and expanded into a walkthrough-project@1 by `seedProject()`.
 *
 * Cue shorthand, one string per cue: `nav <url>` · `click <target>` · `type <target> = <text>` · `key <key>` ·
 * `hl <target>` (highlight) · `scroll <target>` · `wait <sec>` · `say <caption>` · `move <target>`.
 */
import { newPiece, newProject, newSection, uid, type Cue, type CueKind, type Piece, type Project, type Section } from './model';

const C = 'https://console.amberxai.com';
const HUB = 'https://axhub.amberxai.com';
const PILOT = 'https://pilot.amberxai.com';
const PATCHES = 'https://patches.amberxai.com';
const GH = 'https://github.com/MossesX/AmberX-AXF';

interface P { t: string; k: string; n: string; c?: string[]; u?: string; e?: string; tags?: string[] }
interface T { t: string; i?: string; s: (T | P)[] }
const isT = (x: T | P): x is T => 's' in x;
const p = (t: string, k: string, n: string, c: string[] = [], u = '', e?: string, tags?: string[]): P => ({ t, k, n, c, u, e, tags });
const t = (title: string, icon: string, s: (T | P)[]): T => ({ t: title, i: icon, s });

const DUR: Record<CueKind, number> = { navigate: 1.5, move: 0.8, click: 0.4, type: 1.6, key: 0.3, scroll: 0.8, highlight: 1.5, wait: 1, say: 2.5 };
function cue(s: string): Cue {
  const [verb = '', ...rest] = s.split(' ');
  const arg = rest.join(' ');
  const kind: CueKind = ({ nav: 'navigate', click: 'click', type: 'type', key: 'key', hl: 'highlight', scroll: 'scroll', wait: 'wait', say: 'say', move: 'move' } as Record<string, CueKind>)[verb] ?? 'say';
  if (kind === 'navigate') return { id: uid('c'), kind, text: arg, dur: DUR.navigate };
  if (kind === 'type') { const [target, text] = arg.split(' = '); return { id: uid('c'), kind, target, text, dur: Math.max(1, (text?.length ?? 8) * 0.07) }; }
  if (kind === 'wait') return { id: uid('c'), kind, dur: Number(arg) || 1 };
  if (kind === 'say' || kind === 'key') return { id: uid('c'), kind, text: arg, dur: DUR[kind] };
  return { id: uid('c'), kind, target: arg, dur: DUR[kind] };
}

/* ======================================================================================================== */

const OUTLINE: T[] = [
  t('Welcome', 'play', [
    p('Cold open: one framework, every app', 'intro', 'This is AmberX AXF. One framework, several ports, and every piece of the screen you are looking at is a hot-swappable asset. In the next hour we will click through every setting, every engine and every plugin, and follow one click all the way from a button to axHub and back.', ['nav ' + C, 'wait 1', 'hl .fx-banner', 'hl .fx-menubar', 'hl .fx-nav', 'say Everything you see is an asset'], C, 'Swap the colour theme live while the narrator speaks: the whole console repaints in one frame.'),
    p('The family of apps', 'concept', 'Four developer apps run on the framework: the Dev Console, Build Pilot, the AXHub web and phone apps, and Patches, which hosts the others in tabs. All of them read their look and settings from one document on axHub, so a change in one shows up in all of them.', ['nav ' + PATCHES, 'click Console tab', 'click Pilot tab', 'click axHub tab'], PATCHES, 'Change spacing in the Console tab, then switch to the Pilot tab: Pilot already uses the new spacing.'),
    p('How this video is organised', 'intro', 'We start with the asset model and the engines, then every settings tab, then the Dev Console and each of its plugins, then the data flows through axHub, MCP, GitHub automation, Coolify, Hostinger and Moshi. Chapter markers let you jump straight to any part.', ['say Chapters'], ''),
  ]),

  t('The asset model', 'layers', [
    p('asset@1: one format for everything', 'concept', 'Every visible piece is a JSON document in one shared format, asset at one. It has a type, an id, a name, a version and a data block. Themes, layouts, menus, toolbars, dialogs, popups, buttons, sliders, containers, banners, widgets and the access policy are all assets.', ['nav ' + C + '/#assets', 'click Assets', 'click color-theme · arctic-daylight', 'hl JSON view'], C, 'Open an asset\'s JSON next to the screen it styles.'),
    p('asset-types.json: the single source of truth', 'concept', 'One file defines every asset type: its fields, limits, which region slot it fills, whether it can be hidden, rolled or attached to a banner. The engines, the three validators and the generated JSON schemas all read it, so a new type appears everywhere at once.', ['nav ' + GH + '/blob/main/framework/schemas/asset-types.json', 'scroll layout.slots', 'hl hideable'], GH),
    p('Hot swap: runtime.swap(type, id)', 'actionflow', 'Swapping an asset is one call. The runtime validates it, checks your access role, compiles it through its engine into CSS variables, and every component re-renders from the compiled tokens. Nothing in the UI hard-codes a colour or a size.', ['click Settings', 'click Appearance', 'click Color theme', 'click midnight-ink'], C + '/#settings', 'Pick Midnight ink: the background, text, borders and accent change in a single frame.'),
    p('Import and export an asset', 'workflow', 'Any asset can be exported as a file and imported into another app. Imports are validated against asset-types.json first; a uac-policy import is refused while you are signed in through axHub, so nobody can raise their own role.', ['click Assets', 'click Import an asset', 'type paste box = {"$axf":"asset@1",…}', 'click Import'], C + '/#assets'),
    p('Starter assets and app defaults', 'concept', 'The framework ships starter assets for every type and a defaults file that names the one each new app starts with. New apps start with the arctic daylight colours, the glass orbit style and the toolbar hidden.', ['nav ' + GH + '/blob/main/framework/defaults.json'], GH),
  ]),

  t('Engines', 'zap', [
    t('Look engines', 'palette', [
      p('Theme engine: colours to tokens', 'engine', 'The theme engine compiles a colour theme and a style theme into CSS variables: background, surfaces, text, muted, border, accent, danger, success, warning, info and focus, plus radii, borders, shadows and transparency. Plugins may only read these tokens.', ['click Settings', 'click Appearance', 'hl Color theme', 'click coral-studio'], C + '/#settings', 'Coral studio: every plugin, banner and dialog follows at once, because none of them has its own colours.'),
      p('Transparency is themed too', 'engine', 'Style themes carry six opacity levels: disabled, muted, hover, tint, scrim and glass. Translucent colours are mixed from those, never fixed percentages, so a glass theme and a flat theme both look right.', ['click Style theme', 'click glass-orbit', 'hl dialog backdrop'], C + '/#settings', 'Open a dialog in glass orbit, then in a flat theme: the backdrop scrim changes strength.'),
      p('Spacing engine: Super tight, Compact, Regular', 'setting', 'Settings, Appearance, Display, Spacing is a three-way switch. Super tight is the default. The engine scales space, row height and radii of the active style theme at compile time; font sizes and touch targets never shrink.', ['click Settings', 'click Display', 'click Spacing · Regular', 'wait 1', 'click Spacing · Super tight'], C + '/#settings', 'Flip Super tight to Regular: every list row grows, cards get room, text stays the same size.'),
      p('Component engine: buttons, sliders, containers', 'engine', 'Button, slider and container assets are compiled the same way. Change the button asset and every button in every plugin changes, because plugins build controls only from framework components.', ['click Button', 'click pill-outline', 'hl every button'], C + '/#settings', 'Switch the button asset: the plugin buttons in the Systems check dialog restyle too.'),
      p('Gauges and progress meters', 'engine', 'Two control assets draw measures: gauge has arc, ring, bar and digital shapes; meter has bar, segments, steps and line shapes, with stripes and gradient fills. Any view showing progress uses them.', ['click Gauge', 'click ring', 'click Meter', 'click segments'], C + '/#settings'),
      p('Randomize rolls', 'switch', 'Appearance, Randomize rolls a new look over the slots you allow. Each slot has a toggle, each asset has an in-rolls toggle, the access policy is never rolled, and hidden slots are skipped.', ['click Randomize', 'click Roll'], C + '/#settings', 'Roll three times: colour, style and layout change; the context menu stays because rolls skip it by default.'),
    ]),
    t('Layout and chrome', 'layout', [
      p('Layout engine and region slots', 'engine', 'A layout asset places nine regions: menubar, toolbar, nav, main, inspector, status bar and more. Each region has a slot contract naming the asset types it accepts; a menu bar only renders where the layout accepts an app menu.', ['click Layout', 'click studio-dock', 'wait 1', 'click classic-ide'], C + '/#settings', 'Studio dock moves the navigation; classic IDE adds an inspector on the right.'),
      p('Hidden slots', 'switch', 'Chrome types can be hidden: application menu, toolbar, navigation, context menu and banner. The Hidden choice in Appearance drops the region like a refusing slot, and settings about a hidden slot grey out.', ['click Assets', 'click Toolbar · Hidden'], C + '/#settings', 'Hide the navigation: the main area widens; the Randomize toggle for nav greys out.'),
      p('Collapsible toolbar', 'switch', 'A toolbar asset with collapsible set gets a chevron that folds it to a thin handle. The fold is remembered per device.', ['click toolbar chevron'], C),
      p('Wrap groups build option', 'switch', 'The wrap groups build option gives every titled group a collapse toggle at the top right. Build options are switches on every build driver and default to off for new apps.', ['nav ' + GH + '/blob/main/framework/schemas/build-options.json'], GH),
    ]),
    t('Banner and widgets', 'bell', [
      p('Banner asset', 'engine', 'The banner is a thin permanent bar above the layout. It has a height, a surface, a logo and a divider, and it hosts other assets on its left, centre and right.', ['hl .fx-banner', 'click Settings', 'click Banner · amberx-accent'], C, 'Switch to the accent banner: the bar takes the accent colour, the attached widgets keep their places.'),
      p('Widgets: eleven attachable kinds', 'engine', 'Clock, search bar, logo, action button, label, status, counter, progress, avatar, link, theme switch, spacer and divider all attach to banners and toolbars through one host engine. Counters and status dots are bound to runtime counters.', ['hl clock', 'hl search bar', 'click theme switch'], C, 'Tap the day night switch on the banner: the light and dark themes trade places.'),
      p('Live banners and banner settings', 'setting', 'Plugins add live banners under the menu bar. Right-click any banner for Banner settings: one tab per banner with its colour, density, icon, maximum height, launch open or minimised, auto hide, order, and the plugin\'s own settings.', ['move Activity banner', 'click right button', 'click Banner settings', 'click Look', 'click Behaviour'], C, 'Set the Activity banner to Warning colour and Compact density: it shrinks and turns amber.'),
    ]),
    t('Menus, search and windows', 'menu', [
      p('Application menu engine', 'engine', 'The application menu merges the asset with contributions from every library and plugin: ordering, before and after, badges bound to counters, check marks bound to settings or slots, live lists filled when a submenu opens, and access gating.', ['click Builds menu', 'move Open pending items', 'wait 1'], C, 'Open Builds, Open pending items: the live list loads the current pending builds.'),
      p('Context menus and contributions', 'engine', 'Right-click or long-press anything. The context-menu asset gives the base items per target, and plugins add their own through contributions, never by editing the asset.', ['click right button on canvas', 'hl Open terminal'], C),
      p('Search engine', 'engine', 'One index holds actions, settings tabs and switches, assets, windows, views, dialogs and words on pages. Ctrl K or slash focuses it; picking a result navigates, opens, or scrolls to it and flashes it.', ['key Ctrl+K', 'type search = spacing', 'key Enter'], C, 'Search "spacing": the Settings page opens scrolled to the switch, which flashes.'),
      p('Window manager', 'engine', 'Floating windows hold tabs, can be grouped, dragged out, minimised to the cursor and docked. The terminal plugin uses it for its tabs.', ['click Plugins', 'click New terminal', 'move window title', 'click minimise'], C),
    ]),
    t('Access and runtime', 'shield', [
      p('UAC engine: roles and permissions', 'security', 'The uac-policy asset maps roles to permissions. Every action, menu item and setting can name the permission it needs; without it the item is hidden or locked. A remote caller can never exceed the local role.', ['click Account', 'click role · viewer', 'hl locked items'], C + '/#account', 'Switch to the viewer role: theme pickers lock and the Save item disappears.'),
      p('Actions registry', 'actionflow', 'Menus, toolbars, context menus and widgets never call code directly; they name an action spec like swap colon colour-theme colon next. The registry resolves it to a handler with its label and permission.', ['click Help', 'click Keyboard shortcuts'], C),
      p('Settings registry: last save wins', 'dataflow', 'Settings are saved per key and merged into what storage holds now, so two editors never revert each other. Editors reload current values whenever they open or regain focus.', ['say Last save wins, per key'], ''),
      p('Diagnostics and alerts engine', 'engine', 'The runtime reports conflicts, duplicate settings keys and crashes as diagnostics. The alerts engine keeps one alert per key: repeats bump the count, a worse severity escalates, a resolved one reopens.', ['click alerts bell', 'click an alert', 'click Acknowledge'], C),
      p('Embed engine: one banner on screen', 'engine', 'When an app runs inside a host such as Patches it hides the chrome the host shows, and the host can take its settings, notifications, app menu, banners and plugins. The user\'s own saved choice is never touched.', ['nav ' + PATCHES, 'hl one banner'], PATCHES, 'Open the console alone, then inside Patches: its banner disappears because Patches shows one.'),
      p('Work engine: background jobs', 'engine', 'Jobs are data: an interval with bounds, a rule per outcome, back-off, one-time notices and conditions. The state machine decides; the host only runs, sleeps and stops.', ['say work@1'], ''),
    ]),
  ]),

  t('Settings, tab by tab', 'settings', [
    t('Appearance', 'palette', [
      p('Assets: a picker per slot', 'setting', 'Appearance, Assets has a drop-down per slot: colour theme, style theme, layout, app menu, toolbar, navigation, context menu, dialog, popup, button, slider, container, gauge, meter and banner. Chrome slots also offer Hidden.', ['click Settings', 'click Appearance', 'scroll Assets'], C + '/#settings'),
      p('Display: Spacing, Text size, Animations', 'setting', 'Display holds Spacing, Text size from 80 to 140 percent, and Animations. Animations off reduces motion everywhere, including the AI activity icon.', ['click Text size', 'move slider 120'], C + '/#settings', 'Drag Text size to 120: every label grows, the layout reflows.'),
      p('Randomize and Assets in rolls', 'setting', 'Randomize lists a toggle per slot, Assets in rolls a toggle per asset. Overrides are saved as settings, and Reset assets puts everything back.', ['click Randomize'], C + '/#settings'),
      p('Look from axHub', 'dataflow', 'In a developer app the Look from axHub panel shows where the look comes from: the appearance document on axHub\'s data server, its version, and the live connection.', ['click Look from axHub', 'hl version'], C + '/#settings'),
    ]),
    t('Account & security', 'shield', [
      p('Your account', 'setting', 'Shows who you are signed in as through the axHub wall: name, role, and the plugins you were granted, with links to your hub account and sign out.', ['click Account & security', 'hl Your account'], C + '/#settings'),
      p('Console token and Reset token', 'security', 'Machines use the console token. Reset token issues a new 32-character token, rewrites the env file, closes open terminals and shows the token once.', ['click Reset token', 'type confirm = reset'], C + '/#settings'),
      p('Account management', 'security', 'Admins see every grantable permission with a copy button, like console dot plugin dot theme-manager, and a link to the hub\'s users page.', ['click Account management'], C + '/#settings'),
    ]),
    p('Connections', 'setting', 'Connections lists the servers this app talks to and the MCP servers it can call as a client, each with its status.', ['click Connections'], C + '/#settings'),
    t('Plugins', 'package', [
      p('All plugins: health, needs, needed by', 'plugin', 'Settings, Plugins lists every library and plugin from the plugin inventory engine: health, what each one needs and whether it is met, who provides it, who needs it, and clashes.', ['click Plugins', 'click All plugins', 'click ai-assistant row'], C + '/#settings'),
      p('Banners: one settings for every banner', 'setting', 'Plugins, Banners is one interface with a tab per banner holding its look, behaviour and its plugin\'s own settings.', ['click Banners', 'click Build manager tab'], C + '/#settings'),
      p('Every plugin is a sub-tab', 'concept', 'Plugins never get their own settings screen or a top-level tab: each plugin\'s settings are a sub-tab of Plugins, enforced by the console.', ['hl sub-tab row'], C + '/#settings'),
    ]),
    p('About', 'setting', 'About shows the app, framework and asset versions and links to help.', ['click About'], C + '/#settings'),
  ]),

  t('The Dev Console', 'monitor', [
    p('Home and the application menu', 'demo', 'The console hides its toolbar and side navigation because its application menu reaches everything: Console, Builds, Framework, Plugins, Apps, Tools, View and Help.', ['nav ' + C, 'click Console menu', 'click Framework menu', 'click View menu'], C),
    p('Plan, Tracker and feature status', 'workflow', 'The Plan holds every feature with dependencies, ports and acceptance. The tracker summarises built, partial, placeholder and planned per area.', ['click Builds', 'click Plan', 'click Tracker'], C),
    p('Build queue', 'workflow', 'The build queue orders epics with estimates, small steps of thirty minutes or less, time left and price per model. Reprocess reorders by dependencies.', ['click Build queue', 'click Reprocess'], C, 'Tick a small step: time left and price drop in the Progress card.'),
    p('Pending builds', 'workflow', 'Builds parked until their model is available. Statuses pending, unsafe, broken, failed and complete, sub prompts with estimates and ticks, and Copy brief.', ['click Pending builds', 'click walkthrough-studio', 'click Copy brief'], C),
    p('Libraries, modules and boilerplates', 'concept', 'Framework lists every library with its ports and parameters, every Android module with what it depends on, and every boilerplate with screens and screenshots.', ['click Framework', 'click Libraries', 'click Boilerplates'], C),
    p('Standards: projects and manifest rules', 'security', 'Every project has a validated manifest. Standards shows every project with its hub folder and repo, and the manifest rules with severities; locked rules can\'t be loosened.', ['click Standards', 'click Manifest rules', 'type try pad = {"name":"x"}'], C, 'Paste a manifest with an uppercase name: the pad shows the pattern rule failing.'),
    p('New app and build options', 'workflow', 'New app runs axf init from a template with build options as switches; every new app starts each option off and ships the settings interface.', ['click Build…', 'click New app', 'click wrap groups'], C),
  ]),

  t('Plugins, one by one', 'package', [
    t('How plugins work', 'info', [
      p('plugin@1: manifest, web library, server router', 'concept', 'A console plugin is a folder: a plugin@1 manifest, a web part exporting an AXF web library, and an optional Python router mounted at slash api slash plugins slash its folder. Server routes always need the console token and answer 404 when the plugin is off.', ['nav ' + GH + '/tree/main/apps/console-web/plugins/_template'], GH),
      p('What a library contributes', 'concept', 'A web library can contribute views, dialogs, nav sections, settings groups and tabs, app-menu items and live lists, context-menu items, banners, page slots and search providers. installLibraries wires them in and removes them when the plugin is switched off.', ['say AxfWebLibrary'], ''),
      p('Capability services between plugins', 'dataflow', 'Plugins never import each other. They meet through capability services like axf.llm at 1 or axf.agents at 1: one provides, others require, and the Plugin Manager shows who needs whom.', ['click Plugin Manager', 'click Dependencies'], C),
      p('Lifecycle: install, uninstall, nothing left', 'workflow', 'Code lives only in the plugin folder, data only in its data folder. Uninstall with all leaves nothing behind, and a check proves it.', ['click Install & uninstall', 'click Uninstall'], C),
      p('Plugins inherit the app\'s style', 'concept', 'Every plugin control is a framework control, so the app\'s button, style theme and spacing restyle every plugin. A CI check enforces it.', ['click Button · pill', 'hl plugin buttons'], C),
      p('Plugins in any framework app', 'integration', 'The same library contract works in every AXF web app: install it in App.tsx and its settings join Settings, Plugins. Inside a host, plugins that would draw what the host already draws are not loaded and are listed with the reason.', ['say Any framework app'], ''),
    ]),
    t('Build tools', 'hammer', [
      p('Build manager', 'plugin', 'Everything still to build in one list: pending items, queue steps and plan features, with source, model, time left, steps, needs-split, a live tracker of running builds, the Built history with cost, and Start build now.', ['click Builds', 'click Build manager', 'click Filter & sort', 'click Live'], C, 'Toggle From a prompt: only builds started from a chat stay.'),
      p('Codebase changes', 'plugin', 'Every request to build, edit, remove or fix is an entry with steps and a result, stored on axHub. A banner shows open entries; stuck ones get a trash can.', ['click Codebase changes', 'click an entry'], C),
      p('Fable rebuilds', 'plugin', 'Every item parked for Fable: what it replaces, its branch, its differences report and screenshots, and Copy Fable brief.', ['click Fable rebuilds'], C),
      p('Feature assistant', 'plugin', 'Describe a feature and the AXF expert drafts plan entries; Build with Mosses plans and orders an unbuilt feature and opens the chat.', ['click Plan', 'click Describe a feature'], C),
      p('Push banner', 'plugin', 'Every branch ahead of main and every open pull request: Ready to merge, Needs main pulled in, Open PR, Merge after every check passed, and a Done group.', ['hl Push banner', 'click a PR title'], C),
      p('Main build status', 'plugin', 'A status widget on the banner: green tick, red cross, or spinning while main builds, with the failed jobs one tap away.', ['click main ✓'], C),
      p('Activity', 'plugin', 'A banner whenever anything is in progress: GitHub runs, console updates, AI replies, VPS fixes and Claude Code sessions, each with steps.', ['click Activity banner'], C),
    ]),
    t('AI', 'sparkles', [
      p('AI assistant', 'plugin', 'Eighteen providers, profiles with stored keys never returned, streaming with tool rounds, conversations with tags, model comparison, budgets, and approval cards when it wants to change something.', ['click Ask the assistant', 'type message = what does the spacing engine do?', 'key Enter'], C),
      p('Agent manager and Mosses', 'plugin', 'Agents are persona plus lingo, skills, tools, delegates, model and memory. Mosses writes code through approval cards; the AXF expert trains daily on the repo docs.', ['click Agents', 'click Mosses'], C),
      p('Claude badge', 'plugin', 'Tests the AI connection on load and shows Powered by Claude, or AI unavailable with the reason.', ['hl Claude badge'], C),
      p('Live sessions', 'dataflow', 'A session is owned by its host, never the browser: close the tab and the reply keeps going; any device reattaches and replays.', ['click live pill'], C),
    ]),
    t('Containers and VPS', 'terminal', [
      p('Container access', 'security', 'The only console code that touches other containers, through a filtering Docker proxy. Protected containers are locked; agents only propose change batches you approve.', ['click Container access'], C),
      p('Snapshot Manager', 'plugin', 'A snapshot per container before every change batch; diff, restore, retention.', ['click Snapshots'], C),
      p('Terminal', 'plugin', 'Floating terminal tabs: container, console, VPS host root over SSH, and Claude Code. Mosh mode keeps sessions on the server.', ['click New terminal', 'click VPS'], C),
      p('Systems check', 'plugin', 'Checks every credential, service and host item on every load. Issues show a banner; Auto fix runs safe fixes or sends a VPS command for approval through axHub.', ['click Systems check', 'click Guided setup', 'click Auto fix'], C, 'Auto fix on the mosh item: an approval pops up on axHub showing the exact command.'),
    ]),
    t('Look and layout', 'palette', [
      p('Theme manager', 'plugin', 'Roll colour, style and layout over a token tree with locks and presets, preview live, and save as your own assets.', ['click Theme manager', 'click Roll'], C),
      p('App tabs', 'plugin', 'A tab bar across the page, one tab per AmberX app. Inside Patches it contributes nothing.', ['hl App tabs'], C),
      p('Plugin switches', 'plugin', 'A plain on and off switch per plugin, asking first when a running plugin needs the one you turn off.', ['click Plugin switches'], C),
      p('Plugin Manager', 'plugin', 'Cards, table, detail and dependency graph for every plugin; install from the catalog, logs, files and lifecycle.', ['click Plugin Manager', 'click Table'], C),
    ]),
    t('Projects and hand-off', 'folder', [
      p('Project wizard', 'plugin', 'Five steps from a source to a project with a manifest, Claude files and homes on GitHub, the VPS or this device.', ['click New project'], C),
      p('Session check-in', 'plugin', 'Every new Claude Code session opens with grouped questions and is logged.', ['click Sessions'], C),
      p('Claude handoff', 'plugin', 'Assemble prompt builds the handoff kit, publishes it and copies the one prompt that moves the project to a new Claude account; the installation page on axHub ticks off live.', ['click Tools', 'click Assemble prompt'], C),
      p('MCP client', 'plugin', 'Connect to any MCP server, list its tools, resources and prompts, call one with JSON arguments, confirm destructive tools.', ['click MCP servers', 'click Connect'], C),
      p('Approvals banner and alerts bell', 'plugin', 'axHub approvals waiting show as a banner and open by themselves; the bell counts unread alerts.', ['hl approvals', 'click bell'], C),
    ]),
  ]),

  t('Follow one click', 'arrow-right', [
    p('From the toolbar button to the handler', 'actionflow', 'Follow one click. The button names an action; the runtime checks the UAC role; the registry calls the handler with the context target and payload.', ['click Systems check · Auto fix', 'say button → action → UAC → handler'], C),
    p('Into the plugin server', 'actionflow', 'The handler posts to the plugin route with the console token. The server checks the token, the plugin is enabled, and the route is in its fix table.', ['say POST to the systems check autofix route for mosh'], ''),
    p('Out to axHub', 'actionflow', 'The plugin calls axHub\'s vps dot run through the MCP front door. The policy gate sees a destructive tool and creates an approval bound to this caller, tool and arguments.', ['nav ' + HUB + '/auth/admin/approvals', 'hl pending approval'], HUB),
    p('Approved on the phone', 'actionflow', 'The approval pops up in the console and on the phone. Approving runs the command once over SSH, under a server-side timeout, with secrets redacted from the output.', ['click Approve'], HUB),
    p('Back to the console', 'actionflow', 'The job result returns to the plugin, the check re-runs, the banner item shows Fixed for three seconds and leaves. The Activity banner showed every step on the way.', ['hl Fixed', 'wait 3'], C, 'Watch the item turn green and leave the drop-down.'),
  ]),

  t('Data on axHub', 'cloud', [
    p('The projects tree', 'dataflow', 'axHub has its own volume: slash projects. Each project has underscore claude for memory, instructions and rules, and underscore data with its shared files at the same paths as in the repo.', ['say /projects/<name>/_claude · /_data'], ''),
    p('Shared data: pending list, plan, queue', 'dataflow', 'The root manifest names the shared files. The console reads and writes them on axHub; the repo copies are synced snapshots.', ['nav ' + GH + '/blob/main/project.manifest.json', 'hl data.shared'], GH),
    p('The data API and appearance@1', 'dataflow', 'Developer apps read slash data slash shared slash settings slash appearance dot json with their hub session. Writes carry If-Match; a conflict answers 409 with the current version; every change is pushed through slash data-events.', ['say GET /data · PUT If-Match · SSE /data-events'], '', 'Change the colour theme in the console: Build Pilot\'s open tab repaints within a second.'),
    p('Hub down means waiting', 'concept', 'A developer app does not run without the hub: it shows Waiting for axHub with retries, never a stale copy.', ['say Waiting for axHub'], ''),
    p('claude-sync', 'workflow', 'claude-sync three-way syncs every project\'s Claude files and shared data with the hub, and holds conflicts for you to pick.', ['type terminal = claude-sync status', 'key Enter'], ''),
  ]),

  t('Credentials, connections, subscriptions', 'key', [
    p('The vault: write-only', 'security', 'Credentials live in axHub\'s envelope-encrypted vault. They go in through a hidden prompt, never as arguments, and never come back out to Claude or any app.', ['type terminal = axhub vault set hostinger-token', 'say hidden prompt'], ''),
    p('Services and policy', 'security', 'Each service has a connector, a policy and a token reference: allow, confirm or deny. Destructive tools are never below confirm; disabled services are never contacted.', ['say list_services · describe_service · call'], ''),
    p('Accounts and the sign-in wall', 'security', 'Hub accounts are admins or users with permissions. Other apps sit behind the wall: Traefik asks slash auth slash verify, and only signed headers are trusted.', ['nav ' + HUB + '/auth/login'], HUB),
    p('Subscriptions: approvals feed and data events', 'integration', 'Apps subscribe instead of polling blindly: the approvals feed, the data-events stream, and the app catalog, each with the browser\'s own hub session.', ['say /auth/admin/approvals.json · /data-events'], ''),
  ]),

  t('MCP', 'code', [
    p('The console as an MCP server', 'integration', 'The console serves slash mcp with tools for the plan, build queue, pending list, projects, libraries and app builds, plus resources and prompts.', ['nav ' + C + '/api/mcp'], C),
    p('axHub: one MCP server for everything', 'integration', 'To Claude, axHub is one remote MCP server. Behind it: MCP proxies, REST and OpenAPI connectors like GitHub and Hostinger, and the SSH shell.', ['say axhub → github · hostinger · vps · console'], ''),
    p('lib-mcp: any app as an MCP client', 'integration', 'Any AXF app can call MCP servers through one contract on web, Android and Python, with an outbound gate: the local role must hold mcp dot call, and destructive tools need a person to confirm.', ['click MCP servers', 'click a destructive tool'], C),
  ]),

  t('GitHub automation', 'github', [
    p('Workflows', 'integration', 'android.yml builds the framework, the console and every app APK, and posts build errors to one issue. deploy.yml publishes the demo. pilot-apk, rebuild-shots and boilerplate-shots run on demand.', ['nav ' + GH + '/actions'], GH),
    p('App catalog from CI', 'dataflow', 'Every green run on main uploads the app APKs; the console files them on axHub; the hub serves them at slash apps.', ['nav ' + HUB + '/apps'], HUB),
    p('Branches, PRs, push banner', 'workflow', 'Work happens on branches; the push banner opens a draft PR, shows CI, and merges only when every check passed.', ['say branch → PR → CI → merge'], ''),
  ]),

  t('Coolify, Hostinger and Moshi', 'rocket', [
    p('Coolify and Traefik', 'integration', 'Coolify runs every app as a container behind Traefik, which owns ports 80 and 443. Labels add HTTPS redirects and the axHub wall middleware.', ['say Coolify → Traefik → app'], ''),
    p('Auto-update cron', 'workflow', 'The console and Build Pilot rebuild from main every five minutes when GitHub has moved.', ['say /etc/cron.d/axf-console'], ''),
    p('Hostinger: VPS and DNS', 'integration', 'The VPS runs on Hostinger. New subdomains are A records to the VPS, changed through the Hostinger connector and logged on axHub.', ['nav https://hpanel.hostinger.com'], 'https://hpanel.hostinger.com'),
    p('Moshi: mosh from the phone', 'integration', 'Moshi keeps a mosh session to the VPS from the phone. UDP ports 60000 to 61000 must be open; claude-pick asks for the model and sign-in at launch.', ['say mosh · ufw 60000-61000 · claude-pick'], ''),
  ]),

  t('Wrap-up', 'star', [
    p('What you can do next', 'outro', 'Open the console, pick a look, build an app with Build Pilot, and watch it arrive on your phone through the app catalog.', ['nav ' + PILOT], PILOT),
  ]),
];

function build(project: Project, node: T, parent: Section) {
  const sec = newSection(node.t, { icon: node.i });
  parent.children.push(sec);
  for (const x of node.s) {
    if (isT(x)) { build(project, x, sec); continue; }
    const piece: Piece = newPiece({ title: x.t, kind: x.k, narration: x.n, cues: (x.c ?? []).map(cue), url: x.u ?? '', effect: x.e, tags: x.tags ?? [x.k] });
    project.pieces[piece.id] = piece;
    sec.pieces.push(piece.id);
  }
}

/** the complete framework walkthrough as a project */
export function seedProject(): Project {
  const prj = newProject('AmberX AXF — the complete walkthrough');
  prj.description = 'Every setting, switch, engine, workflow, data flow and plugin of the framework, narrated, with the effect of each shown on screen.';
  prj.root.title = prj.name;
  for (const node of OUTLINE) build(prj, node, prj.root);
  return prj;
}
