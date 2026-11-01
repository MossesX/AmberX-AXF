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
