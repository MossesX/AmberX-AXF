// The whole-stack walkthrough (walkthrough-video@1, Brett Nov 1 2026): about 90 minutes on the AXF framework, the Dev
// Console, AmberX, axHub, the VPS and the MCP server, narrated by Amber in her own voice (Rhode Island and Boston street
// talk, cussing allowed; no slurs, nothing sexual). Chapters → scenes { say, act } like script.mjs, but chapters run on
// different apps and devices:
//   device 'desktop' (1920×1080, console + axHub read live, every write kept in the browser) or 'phone' (AmberX, demo data)
//   slide: '<id>'  an explainer slide (explainer.html) for the parts with no screen of their own
// Helpers (record.mjs): slide, step, steps, open, view, hl, click, type, scroll, wait, go, calm, settings, menu.
// Facts must match the code and docs; nothing unbuilt is promised (Android on hold, Patches paused are said as such).
// Narration is written to be spoken: letters spelled out (A-X-F, M-C-P, V-P-S), "ax hub" for axHub.
// Edit here, or edit lines in AmberX (Walkthrough → Edit the voice), then: WALKTHROUGH=stack bash walkthrough/rebuild.sh
import { walkthroughErrors as baseErrors } from './script.mjs';

export const CONSOLE = 'https://console.amberxai.com/';
export const AXHUB = 'https://axhub.amberxai.com/';
export const AMBERX = 'https://amberx.amberxai.com/';

export const WALKTHROUGH = {
  $axf: 'walkthrough-video@1',
  id: 'stack',
  title: 'The whole stack',
  app: 'amberx-droid',
  url: AMBERX,
  device: 'desktop',
  viewport: { width: 412, height: 915 },
  desktop: { width: 1920, height: 1080 },
  output: { width: 1920, height: 1080, crf: 26, preset: 'veryfast' },
  downloads: [720],
  voice: 'en_US-kristin-medium',
};

/** A scene: what Amber says and what's shown meanwhile. */
const sc = (say, act = async (h) => { await h.wait(400); }) => ({ say, act });
/** Explainer scene: the slide, then reveal `n` pieces through the line. */
const ex = (say, slide, n = 0) => sc(say, async (h) => { await h.slide(slide); if (n) await h.steps(n, 1500); });

export const CHAPTERS = [];
const ch = (c) => { CHAPTERS.push(c); };

/** The base checks, except that this one may swear (Brett asked for it). Slurs and sexual words are still refused. */
export function walkthroughErrors(meta = WALKTHROUGH, chapters = CHAPTERS) {
  const errors = baseErrors(meta, chapters).filter((e) => !e.endsWith('keep the narration clean'));
  for (const [i, c] of chapters.entries()) for (const [k, s] of (c.scenes ?? []).entries()) {
    if (/\b(fag\w*|retard\w*|n[i1]gg\w*|tranny|spic|kike|chink|sex\w*|porn\w*)\b/i.test(s?.say ?? '')) errors.push(`chapter ${i + 1} scene ${k + 1}: no slurs or sexual words`);
  }
  if (chapters.some((c) => c.device && !['phone', 'desktop'].includes(c.device))) errors.push('device must be phone or desktop');
  return errors;
}

// 1 ─────────────────────────────────────────────────────────────── cold open
ch({ id: 'open', title: 'What the hell this is', device: 'desktop', slide: 'stack', scenes: [
  ex("Yo, what's good. It's Amber. Grab a coffee milk, pull up a chair, and get comfortable, kid, because for the next hour and a half I'm gonna show you the whole wicked pissah machine. Not one app. The whole damn stack.", 'stack'),
  ex("This is A-X-F, the AmberX framework, and everything that's been built on top of it. Six pieces. They look like separate things, but they work like one machine, and that's the part nobody else on the planet has, I swear to God.", 'stack', 2),
  ex("First, the framework itself. Every single thing you see on a screen, a theme, a menu, a button, a slider, a dialog, is a hot swappable piece of data. Then the Dev Console, where apps and plugins and builds get made.", 'stack', 2),
  ex("Then AmberX, the control room in your pocket. Then ax hub, the hub that ties every service together and holds the keys. Then the V-P-S, the box that runs all of it. And the M-C-P server, which lets Claude drive the whole thing like it owns the place.", 'stack', 2),
  ex("Here's the pitch, straight up, no bullshit. Most shops build an app, then build another app, then spend the next five years keeping the two from drifting apart. Different colours, different buttons, different bugs. It's a friggin mess.", 'why'),
  ex("Here, there's one look, one format, one set of engines, and every app reads from it. Change the look once and every app changes with it, live. Build a plugin once and it fits every app like it was born there.", 'why', 1),
  ex("And the whole thing is Claude native. Claude doesn't just write the code here. Claude plans the builds, splits them into steps, logs every change, asks for your veto before touching anything that matters, and reports back to your phone.", 'why', 1),
  ex("And the boss built all of this mostly from his phone, on the couch, talking to it. Think about that for a second. That's not a toy. That's a factory you can run from a packie parking lot.", 'why', 1),
  ex("Here's how this goes. We start at the bottom with assets and engines, the guts. Then the build engine and the Dev Console. Then plugins, builds, the safety rails and the agents. Then ax hub, the veto system, AmberX, the V-P-S and the M-C-P server.", 'stack'),
  ex("Every chapter's skippable. Tap the chapter list in the player and bang a uey to whatever you care about. And if you don't like how I sound, you can change my voice and rewrite any line right in AmberX. Yeah, really. Wicked smart, right?", 'stack'),
  ex("Alright. Enough yappin. Let's get into the guts of it.", 'stack'),
] });

// 2 ─────────────────────────────────────────────────────────────── asset@1
ch({ id: 'assets', title: 'Everything is an asset', device: 'desktop', url: CONSOLE, scenes: [
  ex("Rule number one of this whole operation: everything visible is an asset. Not most things. Everything. If you can see it, it's a chunk of JSON in one shared format called asset at one.", 'assets'),
  ex("A theme is an asset. A layout is an asset. The application menu, the toolbar, a dialog, a popup, a button, a slider, a container, even who's allowed to see what. All the same format, all swappable while the app is running.", 'assets', 2),
  ex("There's one file that says what every asset type looks like, asset types dot json. That's the single source of truth. The validators, the JSON schemas, the editors, they're all generated from it, so nothing can drift.", 'assets', 2),
  ex("The engines read the assets and compile them into tokens, plain variables like the accent colour, the spacing, the corner radius, the border width. And the UI reads only those tokens. Never a hard coded colour. Never a hard coded size.", 'assets', 2),
  sc("This is the Dev Console, and this is its asset studio. Every asset the framework ships, one folder per type. Click one and you see what it is, what it sets, and what uses it.", async (h) => { await h.view('assets', 'Assets'); await h.hl('main', 'Every asset, by type'); }),
  sc("Look at that list, kid. Themes, styles, scales, layouts, menus, toolbars, banners, dialogs, buttons, sliders. Every one of those is a file you can swap without rebuilding a God damn thing.", async (h) => { await h.scroll(500); await h.wait(1500); await h.scroll(500); }),
  sc("Why does that matter? Because the usual way, the look is baked into the code. Some dude hard codes a hex colour in a component, somebody else hard codes a different one, and now you've got forty shades of almost orange. Here, that can't happen.", async (h) => { await h.scroll(-1000); }),
  sc("It's not just a nice idea, either. It's enforced. There are checks in C-I that read every style sheet and every component, web and Kotlin, and fail the build on any colour, size, font or radius that isn't a token. They even tell you the file, the line, and which token to use instead.", async (h) => { await h.view('standards-rules', 'Standards'); }),
  sc("Handwritten code is fine, but it has to play by the asset rules. And the build engine flat out refuses to finish creating an app whose output doesn't conform. No suh. You don't get to sneak junk in.", async (h) => { await h.scroll(400); }),
  sc("Transparency is themed too. Hover tints, scrims, the glass effect, disabled controls. Those are opacity tokens in the style theme, so even how see through something is follows the look. Most frameworks never even think about that.", async (h) => { await h.scroll(-400); }),
  sc("And the scale. Typography, density, spacing, compact by default but big enough to tap on a phone. One scale asset, every app follows it. Swap it and every screen tightens up or opens up, all at once.", async (h) => { await h.view('components', 'Components'); }),
  sc("These are the framework controls. Buttons, chips, switches, segmented pickers, fields, sliders. Apps and plugins build from these, not their own home made junk, so when the button style changes, every button everywhere changes with it.", async (h) => { await h.hl('main', 'Framework controls'); await h.scroll(500); }),
  sc("That's the foundation. Everything that comes next sits on it: one format, one source of truth, engines in the middle, and UI that only reads tokens. Wicked simple to say. Wicked hard to pull off. And it's done.", async (h) => { await h.scroll(-500); }),
] });

// 3 ─────────────────────────────────────────────────────────────── engines + hot swap
ch({ id: 'engines', title: 'The engines and hot swap', device: 'desktop', url: CONSOLE, scenes: [
  ex("Alright, so assets are the what. Engines are the how. An engine takes a pile of assets, a theme, a style, a scale, a layout, and compiles them down into tokens the screen can read. Same input, same output, every time, on every app. That's the deal.", 'assets', 3),
  ex("And here's the magic trick. Because the UI only ever reads tokens, you can swap the asset underneath while the app is running. One call, runtime dot swap, the type and the id. That's it. No rebuild, no redeploy, no reload, nothing.", 'swap', 2),
  ex("Swap the colour theme, every button, menu, slider and dialog repaints. Swap the style, every corner and shadow and border changes. Swap the layout, the whole app rearranges itself. Live, while you're looking at it. It's friggin beautiful, kid.", 'swap', 3),
  sc("Let me show you on the real thing. This is the console's settings, the appearance tab. These are the colour themes and the style themes the framework ships. Pick one and the whole console follows, right now, in front of you.", async (h) => { await h.view('settings', 'Settings'); await h.hl('main', 'Appearance'); }),
  sc("Now, I'm not actually gonna save a new look on this recording, because the look is shared, and I'd be changing it on every app the boss has. Yeah, every app. Hold that thought, because that's the next big idea.", async (h) => { await h.scroll(400); }),
  sc("The look comes from ax hub, period. There's one appearance document on the hub. The design package, the theme, the style, the spacing, what chrome is hidden. Every app on the framework reads it live. Change it in any app and it changes in all of them.", async (h) => { await h.scroll(400); }),
  sc("And every app ships every asset that can be shared, baked right in. The Dev Console, the ax hub web app, AmberX. So when you pick a design package on your phone, the console on your desktop flips to match. No exceptions, no local fallback, no bullshit.", async (h) => { await h.scroll(-800); }),
  sc("Now, a bunch of tools can edit the same values, the theme manager, the style editor, the layout designer. So there's a rule: last save wins, per key, and every editor reloads the current values whenever it opens or comes back into focus. Nobody ever stomps on anybody else's change.", async (h) => { await h.wait(1500); }),
  sc("Settings themselves are built by the framework too. Every app gets a settings interface for free, and every settings interface has a level toolbar on top: Simple, Basic, Developer, Administrator. Pick a level and only the settings for that level show up front. The rest tuck away.", async (h) => { await h.hl('main', 'Settings, by level'); }),
  sc("Administrator shows you everything. And there's a level editor, two trees side by side, where you decide which setting shows at which level, and the settings page updates live while you drag stuff around. For a normal person, it stays clean. For you, the whole engine room is right there.", async (h) => { await h.scroll(300); }),
  sc("There are more engines under the hood than I can count on one hand. Banners and widgets, help tooltips, the hide engine that decides which chrome shows, the embed engine for apps inside other apps, the plugin inventory. Every one of them is pure logic, tested against golden outputs.", async (h) => { await h.scroll(-300); }),
  ex("And that word, golden, is the key to the next chapter. Because this isn't one framework. It's one design, written twice. Hold onto your Del's lemonade.", 'ports'),
] });

// 4 ─────────────────────────────────────────────────────────────── two ports
ch({ id: 'ports', title: 'One design, two ports', device: 'desktop', slide: 'ports', scenes: [
  ex("Here's something most people never pull off. A-X-F has a web port and an Android port, and they're not two frameworks that kind of look alike. They're the same design, file for file. Same engines, same names, same answers.", 'ports'),
  ex("On the web side, the reference engines are TypeScript, in framework slash core, framework agnostic, with the React layer on top: the provider, the app shell, the controls, the windows. That's the reference. When there's a question about how something should behave, the TypeScript answers it.", 'ports', 1),
  ex("Then there are the fixtures. Golden outputs. For every engine, a set of inputs and the exact output the reference engine gives. Those fixtures are the contract. Change a reference engine, regenerate the fixtures, and every port has to match them again.", 'ports', 2),
  ex("On the Android side there's the kernel, pure Kotlin, no Android imports at all. The platform stuff, the screens, the storage, the network, all of it sits behind seams in separate modules. So the brain runs anywhere a JVM runs, and the conformance tests run in C-I on every push.", 'ports', 3),
  ex("Why bother? Because when the engines agree, a theme you make on the web looks the same on the phone. A layout you design once lays out the same everywhere. A plugin's model behaves the same. You're not porting an app. You're porting a design that already proved itself.", 'ports'),
  ex("Now, straight talk, because I don't sugarcoat. All Android framework work is on hold right now. The boss parked it. The code that's there still compiles in C-I, the kernel tests still run, but new Kotlin features wait until he picks it back up himself.", 'ports'),
  ex("The exceptions are AmberX's Capacitor shell, which you'll see later, and Voice Vault. Patches, the app that held the other apps in tabs, is paused completely. I'm telling you what's real, not selling you a dream.", 'ports'),
  ex("Then there's interop. The kernel never knows a protocol. Protocols are modules that plug in an adapter. Exposure is default deny, so nothing gets out unless it's switched on, and a remote caller can never get more power than the local role allows. Never.", 'path'),
  ex("And the wire error codes never change meaning. Once a code means something, it means it forever. That's how you build stuff that other stuff can trust for years, not weeks. Boring? Maybe. But boring is what keeps the lights on, kid.", 'path'),
  ex("There's even a planned Python port down the road. Same deal: the fixtures say what's right, the new port proves it matches. That's the beauty of a contract you can actually run.", 'ports', 3),
] });

// 5 ─────────────────────────────────────────────────────────────── build engine + CLI
ch({ id: 'cli', title: 'The build engine', device: 'desktop', slide: 'cli', scenes: [
  ex("Now let's talk about how an app actually gets made. There's a build engine, plain Node, no install needed, and a command line called axf. You point it at a folder and it does the heavy lifting. No forty step setup guide, no copy pasting config from some blog.", 'cli', 1),
  ex("First thing it does is validate. Every asset in the framework, every asset in the app, checked against the one source of truth. Bad colour value, missing field, wrong type, it tells you exactly where and exactly why. Nothing half broken gets through.", 'cli', 2),
  ex("Then axf init. This is the good part. It bakes the framework right into the app: the core engines, the React layer, the base style sheet, the schemas, copied into the app's own folder, with a lock file that records a hash of every single piece.", 'cli', 4),
  ex("So an app always knows exactly which framework it was built with. And there's a re-bake tool that tells you which apps are behind the framework and brings them up to date in one shot. Change the framework, never the baked copies. That's the rule.", 'cli', 4),
  ex("Every project has to have a manifest, project dot manifest dot json. Its name, its repo, its shared data. And here's the hard line: the build engine will not load or compile anything without a valid manifest. Not the console, not the templates, nothing. No manifest, no build. Period.", 'cli'),
  ex("The rules those manifests are checked against live in one file, managed in the Dev Console under Standards. Some rules are locked, so nobody can quietly remove them or loosen them. Not Claude, not a plugin, not some sleepy session at three in the morning.", 'cli'),
  ex("Then there are the build options, and they're switches. Dash dash wrap groups, for example. Every switch is defined in one registry, every one sets an asset token, and every new build starts with all of them off. Same switches work from the command line, the console, the M-C-P server, everywhere.", 'cli'),
  ex("You don't start an app from scratch, either. There are templates: React with TypeScript, Next, a web app with a FastAPI back end behind the hub's wall, Android Compose. And boilerplates, ready made starting points for whole kinds of apps.", 'cli'),
  ex("Every app the engine builds gets a landing and loading screen, and a full settings interface, by default. You don't have to remember. It's just there, styled from the assets like everything else.", 'cli'),
  ex("And then the conformance checks. Check theme reads every style sheet and every component and fails on anything that isn't a token. Check controls fails on raw buttons and home made controls where a framework control belongs. Both run in C-I, both point at the exact line.", 'cli', 6),
  ex("Got an old screen full of hard coded pixels? There's a tool called scale adopt that moves most of the literals onto tokens for you. Clean up a legacy mess in seconds instead of a week of find and replace. That's a wicked time saver, kid.", 'cli'),
  ex("There's a tracker too. Every feature in the catalog with its status, generated into one file, checked in C-I so it can't fall out of sync. And the demo app gets built and deployed by itself every time main moves. Push to main, and a couple of minutes later it's live.", 'cli'),
  ex("Think about what that adds up to. A new app is validated, styled, settings ready, conformance checked and hashed from the first minute. Most teams spend months building that kind of scaffolding. Here it's one command.", 'cli', 6),
] });

// 6 ─────────────────────────────────────────────────────────────── Dev Console tour
ch({ id: 'console', title: 'The Dev Console', device: 'desktop', url: CONSOLE, scenes: [
  sc("Welcome to the Dev Console. This is the shop floor, kid. It's a web app built on the framework itself, React and TypeScript up front, a Python FastAPI server in the back, running in a container on the V-P-S. Everything gets made, tracked and shipped from right here.", async (h) => { await h.view('home', 'Home'); }),
  sc("And here's the first thing to notice: the console is held to every rule it enforces. Every size in it is a token, every colour is a token. It eats its own cooking. If the console can't pass the checks, nobody can.", async (h) => { await h.hl('.fx-banner', 'The banner'); }),
  sc("Up top is the banner. Search on one side, widgets on the other: the clock, the build status, counters for what's waiting on you, the alerts bell. Every one of those widgets is contributed by a plugin, and the banner itself is an asset.", async (h) => { await h.hl('.fx-banner', 'Widgets from plugins'); }),
  sc("And the banner follows a rule the boss laid down: attached things snap, they never overlap. Sides size to their content, the search bar shrinks first, and when it's full it scrolls sideways with snap. Nothing ever draws over anything else. Small detail. Huge difference.", async (h) => { await h.wait(1200); }),
  sc("The search finds anything. Pages, settings, commands, plugins. Type a word, hit enter, you're there. When you've got a few dozen plugins installed, that's how you stay sane.", async (h) => { await h.hl('.fx-search', 'Search everything'); }),
  sc("Down the side is the nav. The pages the console ships, and every page a plugin adds. Projects, assets, components, libraries, the catalog, the plan, standards, builds. Each one is a view the app shell knows how to show.", async (h) => { await h.hl('.fx-region--nav, nav', 'The nav'); }),
  sc("The nav, the application menu, the toolbar, the context menus, they're all assets too. And plugins add to them at runtime, they don't edit somebody else's menu file. That's how a plugin can show up in three places without touching anything it doesn't own.", async (h) => { await h.view('catalog', 'Catalog'); }),
  sc("This is the catalog. Every feature of the framework, what's built, what's planned, which port has it. It's generated from the status files, so it's always the truth, not somebody's guess from last month.", async (h) => { await h.scroll(500); }),
  sc("These are the libraries. Settings, logging, the hub client, data grids, the hub sync, and a lot more. Installable pieces any app can pull in, each one built to the same theme rules as everything else.", async (h) => { await h.view('libraries', 'Libraries'); }),
  sc("Projects. Every project has its manifest, and the console validates every one of them. The framework, the demo, the console itself on web and Android, Voice Vault, the ax hub apps, AmberX and the rest. Each with its repo, its shared data and its rules.", async (h) => { await h.view('standards-projects', 'Projects'); }),
  sc("Standards is where the rules live. The project rules, which ones are locked, what every manifest must have. The boss manages them right here, and the build engine reads them from here. Edit a rule once, every project is checked against it.", async (h) => { await h.view('standards-rules', 'Standards'); }),
  sc("The console has windows, too. Pages pop out into floating windows, there's a real terminal you can open on the server, and a tab group for anything with sub pages. Desktop power, but still all from tokens and framework controls.", async (h) => { await h.scroll(300); }),
  sc("And right click anywhere. The context menu knows what you clicked: a nav item, a banner widget, a row. Plugins add their own items to it, like Banner settings or Open in a window. One menu, many contributors, zero clashing.", async (h) => { await h.scroll(-300); }),
  sc("Here's the wild part. Most of what you see on this console didn't come from the console. It came from plugins. The builds pages, the systems check, the changes log, the review queue, the agents, the push banner, the voice stuff. Dozens of them.", async (h) => { await h.view('home', 'Home'); }),
  sc("Which means the console is really a host. A clean shell with a strict set of rules, and a whole crowd of plugins living inside it, each one removable, each one in its own folder, each one styled by the same engines. That's the next chapter, and it's a big one.", async (h) => { await h.wait(1000); }),
] });

// 7 ─────────────────────────────────────────────────────────────── plugins
ch({ id: 'plugins', title: 'Plugins that come and go clean', device: 'desktop', url: CONSOLE, scenes: [
  sc("Plugins. This is where the framework goes from neat to nasty good. A plugin is a folder. It can add pages, banner widgets, menu items, settings, server routes, background jobs. And the host picks it up without anybody editing the host. Drop it in, switch it on, done.", async (h) => { await h.view('Plugins', 'Plugin Manager'); }),
  sc("This is the Plugin Manager, and it's a plugin itself. Every plugin installed, what it is, its version, its switch, its logs, its settings. Open one and you see what it needs, whether that's met, who provides it, and who needs it back. All the dependencies, in plain words.", async (h) => { await h.hl('main', 'Every plugin'); }),
  sc("The model behind this page is an engine, plugin inventory, and it exists three times: in TypeScript, in Kotlin, and in the console's Python server. One fixture keeps all three honest. That's the two port discipline paying off again.", async (h) => { await h.scroll(400); }),
  sc("Every plugin wears a little badge saying which model built it and when. Opus or Fable. And there's a hard rule: one instance per plugin. If a different model rebuilds a plugin, the new one replaces the old one in its folder, through a confirmed swap. Never two copies fighting each other.", async (h) => { await h.scroll(400); }),
  sc("Now here's the one I love. Every plugin can be removed completely. Completely, kid. Its code lives only in its own folder. Its data lives only in its own data folder. Any line it adds to a shared doc is tagged with its name.", async (h) => { await h.scroll(-800); }),
  sc("Every plugin ships an install script and an uninstall script, and an install and uninstall panel in its settings. Uninstall with dash dash all, and then a checker walks the whole repo to prove nothing was left behind. Not a file, not a setting, not a stray line in a readme.", async (h) => { await h.wait(1500); }),
  sc("How do plugins work together without tangling? Capability services. One plugin offers something, like the language model service or the agents service, by name and version. Another plugin asks for that capability. Nobody ever reaches into another plugin's folder by name.", async (h) => { await h.wait(1500); }),
  sc("So you can pull the plugin that provides a capability, put in a different one that offers the same thing, and everything that used it just keeps working. That's real modularity, not the kind people put on slides.", async (h) => { await h.view('settings', 'Settings'); }),
  sc("Plugin settings never get their own screen and never get a top level tab. Every plugin's settings are a sub tab of Settings, then Plugins. One place to look, every time. When you've got fifty plugins, that rule saves your sanity.", async (h) => { await h.hl('main', 'Settings, Plugins'); }),
  sc("And plugins inherit the app's style. A plugin builds its controls only from the framework's components, never its own fancy buttons. So if the app changes its button style, every plugin's buttons change with it. Sliders, switches, fields, dialogs, all of it.", async (h) => { await h.scroll(400); }),
  sc("A plugin's style sheet is allowed to lay things out. It is not allowed to restyle a control or define its own theme variables. The theme checker enforces that in C-I. A plugin that wants its own look has to ship it as assets, through the engines, like everybody else.", async (h) => { await h.scroll(400); }),
  sc("Plugins can even be smart about where they run. When an app is shown inside another app, a plugin that would only draw chrome the host already draws just doesn't load there, and the console logs why. Standalone, everything loads.", async (h) => { await h.scroll(-800); }),
  sc("And plugins can cross over. Some console plugins are built into AmberX too, served through AmberX's server, so the same plugin shows up on your phone. Build it once, run it in the console and in your pocket.", async (h) => { await h.wait(1200); }),
  sc("There's a plugin generator, a plugin update flow, a plugin switch board, a plugins menu. The whole lifecycle is handled. Add, update, swap for a rebuild, remove without a trace. That's how you grow a system to a hundred features without it turning into a junk drawer.", async (h) => { await h.view('Plugins', 'Plugin Manager'); }),
] });

// 8 ─────────────────────────────────────────────────────────────── builds
ch({ id: 'builds', title: 'Builds, orchestrated', device: 'desktop', url: CONSOLE, scenes: [
  ex("Now we get to how work actually gets done around here. Every build, every edit, every removal that changes how something works, goes through the Build orchestrator first. No cowboy coding. Nobody just starts typing and hopes.", 'builds', 1),
  ex("The orchestrator takes a build and splits it into small steps, thirty minutes or less each. Some builds the boss wants even smaller, ten minute steps, so if a session dies halfway, nothing's lost and the next session picks up at the exact step.", 'builds', 2),
  ex("Every step gets pinned to a model. Fable for the foundation stuff: schemas, asset types, data models, engines, anything that changes how screens work across apps. Opus for everything else. No Sonnet, no Haiku, anywhere. One policy file says so and every picker reads it.", 'builds', 2),
  ex("And here's the slick part. There's one builds store. One file, every build of every profile, one record each. The orchestrator view, the pending list, the build queue, the Build manager, they're all just views of that one store. They can't drift apart, because there's nothing to drift.", 'builds', 4),
  ex("Every write to that store is versioned in a journal. Every single one. So you can see the history of any build, and restore any earlier version of it. Somebody fat fingers a change at midnight? Roll it back. Done.", 'builds', 4),
  sc("Here it is in the console. The Build orchestrator, every build with its steps, its progress bar, the model on each step and the time left. Tap a build and you get the brief for its current phase, ready to hand to a fresh session.", async (h) => { await h.view('Build orchestrator', 'Build orchestrator'); }),
  sc("Approval only happens at a model switch. If one phase runs on Opus and the next needs Fable, the boss gets a card, taps approve, and the next phase gets its brief. Otherwise the build just rolls. No pointless are you sure prompts every five minutes.", async (h) => { await h.scroll(400); }),
  sc("Build profiles. Right now there's Main framework and Refactor. Every build, the pending list, the queue, they all belong to a profile, and you switch the active one from the banner. Two whole streams of work, kept apart, never mixed by accident.", async (h) => { await h.scroll(-400); }),
  sc("This is the pending list. Builds parked until their model's free or the boss says go. Each one shows its steps as sub prompts with the model in brackets. Add to the pending list means park it, not build it. Claude knows the difference.", async (h) => { await h.view('pending', 'Pending builds'); }),
  sc("Before anything gets built, the session has to check this list and the queue for clashes. If another item touches the same files or the same contract, they get built together, or the clash gets a note. Nothing gets built twice. Nothing undoes something else next week.", async (h) => { await h.scroll(400); }),
  sc("The plan. When the boss says put it in a plan for later, it doesn't become a build. It becomes a parked plan in Plan Studio, with a category, until he says turn it into a build. Ideas don't clog the build lists.", async (h) => { await h.view('plan', 'The plan'); }),
  sc("And the Build manager pulls it all together. What's running, what's next, progress and time left across every build. Plus the live list of sessions working right now, so two sessions never grab the same build or stomp on the same folders.", async (h) => { await h.view('build', 'Build manager'); }),
  sc("There's even a Fable review. When Opus built something that's really foundation work, Fable reviews it first, and only what the review flags gets rebuilt. Use the big brain where it matters, not on everything.", async (h) => { await h.scroll(400); }),
  sc("You know what this adds up to? A build system that remembers everything, splits everything, and can be picked up by any session on any machine on any account, from the repo alone. Chat history means nothing here. The store is the truth.", async (h) => { await h.scroll(-400); }),
] });
