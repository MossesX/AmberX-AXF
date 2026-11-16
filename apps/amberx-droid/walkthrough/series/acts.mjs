// What the camera does in every scene of the series (step s3): each scene's `shot` becomes an `act` for the recorder
// (../record.mjs helpers). Three sources, in order:
//   1. ACTS[videoId]['<chapter>-<n>']   a hand-written act where the shot needs specific clicks
//   2. the scene itself: camera 'story' → a b-roll card; staged with `mock` → that designer-mock scene in the video's skin;
//      staged without one → a Preview card; a terminal shot → a terminal card; an end card → the end card
//   3. ROUTES: the first rule whose pattern matches the shot opens that screen of the scene's app (live, real data)
// `planOf(video, scene)` says which one a scene got, so check.mjs --acts can list them and a reviewer can see the
// difference between a recorded screen and a card.

/** The live apps a scene can be recorded on, and the device that shows them. */
export const APPS = {
  'console-web': { url: 'https://console.amberxai.com/', device: 'desktop' },
  'axhub-web': { url: 'https://axhub.amberxai.com/', device: 'desktop' },
  'amberx-droid': { url: 'https://amberx.amberxai.com/', device: 'phone' },
  // the Android hub app isn't a web page: its scenes are cards that say so
  'axhub-android': { url: null, device: 'phone' },
};

// h.view takes the nav title (the console's nav items are titled; the banner search is the fallback)
const MAIN = 'main h1, main h2, main';
const view = (title, label) => async (h) => { await h.view(title, label); await h.hl(MAIN, label); };
const go = (title, sel, label) => async (h) => { await h.go(title); if (sel) await h.hl(sel, label ?? title); };

/** Shot text → screen, per app. First match wins; the last rule of each app is its home. */
export const ROUTES = {
  'console-web': [
    [/feature matrix/i, view('Feature matrix', 'Feature matrix')],
    [/\bcrew\b/i, view('Crew', 'Crew, live')],
    [/swarm/i, view('Agent swarm', 'Agent swarm')],
    [/ui review/i, view('UI Review', 'UI Review')],
    [/theme editor/i, view('Theme editor', 'Theme editor')],
    [/theme manager|roll/i, view('Theme manager', 'Theme manager')],
    [/hot-swap|stress test/i, async (h) => { await h.settings('Appearance'); await h.hl(MAIN, 'Hot-swap studio'); }],
    [/context menu designer|chunk/i, view('Context menu designer', 'Context menu designer')],
    [/toolbar customizer|customize toolbars/i, async (h) => { await h.view('Home', 'Home'); await h.hl('[role=toolbar]', 'Right-click to customize'); }],
    [/appearance|skin|tab group card/i, async (h) => { await h.settings('Appearance'); await h.hl(MAIN, 'Appearance'); }],
    [/settings/i, async (h) => { await h.view('Settings', 'Settings'); await h.hl(MAIN, 'Settings'); }],
    [/plan studio|plan\b|plans tab|catalog tab|categories|turn into a build/i, view('Plan Studio', 'Plan Studio')],
    [/orchestrator|pending|queue|active tab|complete tab|build note|steps/i, view('Build orchestrator', 'Build orchestrator')],
    [/codebase changes|changes log/i, view('Codebase changes', 'Codebase changes')],
    [/shipped/i, view('Shipped features', 'Shipped features')],
    [/plugin/i, view('Plugin Manager', 'Plugin Manager')],
    [/banner/i, async (h) => { await h.view('Home', 'Home'); await h.hl('.fx-banner', 'The banner'); }],
    [/./, async (h) => { await h.view('Home', 'Home'); await h.hl(MAIN, 'The Dev Console'); }],
  ],
  'axhub-web': [
    [/\bapps\b/i, async (h) => { await h.view('Apps', 'Apps'); await h.hl(MAIN, 'Apps'); }],
    [/audit|manage/i, async (h) => { await h.view('Audit log', 'Audit log'); await h.hl(MAIN, 'Manage'); }],
    [/hub tab|sign-in|signed in|security|shared memory|project data/i, async (h) => { await h.view('Hub', 'Hub'); await h.hl(MAIN, 'Hub'); }],
    [/look|theme|re-renders/i, async (h) => { await h.hl('.fx-banner', 'Same look as the console'); }],
    [/./, async (h) => { await h.view('Approvals', 'Approvals'); await h.hl(MAIN, 'Approvals'); }],
  ],
  'amberx-droid': [
    [/command center|four tabs|record-your-own|chains|wizard|developer tab|ai snippets|molly/i, go('Command center', '[role=tablist] >> nth=0', 'Command center')],
    [/ask my notes/i, async (h) => { await h.go('Ask my notes'); await h.type('textarea, input[type=text]', "What's due for work this week?"); await h.click('role=button[name="Ask"]', 'Ask'); }],
    [/dictate|review card/i, go('Dictate', 'main', 'Dictate')],
    [/\bnotes?\b|tasks?|list/i, go('Notes', 'main', 'Notes')],
    [/voice|wake|overlay|listening|transcript|hands-free/i, go('Voice', 'role=button[name="Speak"] >> nth=0', 'Speak')],
    [/settings|sensitivity|skin picker|permission/i, go('Settings', 'main', 'Settings')],
    [/held call|countdown|approv|deny/i, async (h) => { await h.openHeld(); await h.hl('[role=dialog]', 'Waiting on you'); }],
    [/./, go('Approvals', '.fx-banner', 'AmberX')],
  ],
  'axhub-android': [],
};

const TERMINAL = /^\s*terminal\b|`[^`]+`/i;
const END = /end card/i;

/** Hand-written acts for the shots the rules can't do on their own (keys are '<chapter>-<scene index>'). */
export const ACTS = {
  'voice-control': {
    'intro-0': async (h) => { await h.calm(); await h.hl('.fx-banner', 'AmberX'); await h.wait(1200); await h.hl('.fx-region--nav', 'Every page'); },
    'intro-1': async (h) => { await h.go('Voice'); await h.hl('text=/wake/i', 'Wake word'); },
    'intro-2': async (h) => { await h.hl('role=button[name="Speak"] >> nth=0', 'Listening'); },
    'commands-1': async (h) => { await h.go('Command center'); await h.type('main input[type=search], main input[placeholder*=earch]', 'pin'); await h.wait(900); await h.hl('main [role=grid], main table, main [role=list]', 'Its phrases'); },
    'developer-1': async (h) => { await h.go('Approvals'); await h.openHeld(); await h.hl('[role=dialog] button:has-text("Deny")', 'Deny or Approve'); },
  },
  'orchestrator-agents': {
    'intro-1': async (h) => { await h.view('Build orchestrator', 'Build orchestrator'); await h.click('main [role=row] >> nth=1', 'One build'); await h.hl(MAIN, 'Steps, minutes, models'); },
    'queue-0': async (h) => { await h.view('Build orchestrator', 'Build orchestrator'); await h.click('role=tab[name=/Queue/]', 'Queue'); },
    'queue-1': async (h) => { await h.click('role=tab[name=/Active/]', 'Active'); await h.hl(MAIN, 'Ticked as it goes'); },
    'crew-1': async (h) => { await h.view('Crew', 'Crew'); await h.click('main [role=row] >> nth=1', 'What it is doing now'); },
    'checks-1': async (h) => { await h.view('Build orchestrator', 'Build orchestrator'); await h.click('role=tab[name=/Complete/]', 'Complete'); },
  },
  'plan-studio': {
    'intro-1': async (h) => { await h.view('Plan Studio', 'Plan Studio'); for (const v of ['Board', 'Roadmap', 'Reader']) { await h.click(`role=button[name=/${v}/] >> nth=0, role=tab[name=/${v}/]`, v); await h.wait(900); } },
    'intro-2': async (h) => { await h.click('role=tab[name=/Categories/]', 'Categories'); },
    'catalog-0': async (h) => { await h.click('role=tab[name=/Catalog/]', 'Catalog'); },
    'catalog-1': async (h) => { await h.scroll(500); await h.hl(MAIN, 'New and gone'); },
  },
  'skins-tokens': {
    'intro-1': async (h) => { await h.settings('Appearance'); await h.hl(MAIN, 'Skins'); await h.mock('skin', { skin: 'atelier' }); await h.steps(4, 1800); },
    'intro-2': async (h) => { await h.skin('newsroom'); await h.wait(2500); await h.skin('atelier'); },
  },
};

/** How a scene is recorded: { kind: 'act' | 'mock' | 'route' | 'card', act, why }. */
export function planOf(video, scene, key) {
  const app = scene.app ?? video.app;
  const own = ACTS[video.id]?.[key];
  if (own) return { kind: 'act', app, act: own, why: 'hand-written' };
  if (scene.camera === 'story') return { kind: 'card', app, why: 'story b-roll', act: (h) => h.card({ kind: 'story', title: video.title, text: scene.shot, skin: video.skin }) };
  if (scene.staged && scene.mock) return { kind: 'mock', app, why: `mock ${scene.mock}`, act: async (h) => { await h.mock(scene.mock, { skin: video.skin }); await h.steps(4, 1600); } };
  if (scene.staged) return { kind: 'card', app, why: 'staged, no mock', act: (h) => h.card({ kind: 'preview', title: video.title, text: scene.shot.replace(/^Staged:\s*/i, ''), skin: video.skin }) };
  if (END.test(scene.shot)) return { kind: 'card', app, why: 'end card', act: (h) => h.card({ kind: 'end', title: video.title, text: video.hook ?? '', skin: video.skin }) };
  if (TERMINAL.test(scene.shot)) return { kind: 'card', app, why: 'terminal', act: (h) => h.card({ kind: 'terminal', title: video.title, text: scene.shot, skin: video.skin }) };
  if (!APPS[app]?.url) return { kind: 'card', app, why: `${app} is not a web app`, act: (h) => h.card({ kind: 'device', title: video.title, text: scene.shot, skin: video.skin }) };
  const rule = (ROUTES[app] ?? []).find(([re]) => re.test(scene.shot));
  return { kind: 'route', app, why: String(rule[0]), act: rule[1] };
}

/** The device a scene is recorded on: cards and mocks stay on the device around them (null), screens on their app's. */
export function deviceOf(plan) {
  if (plan.kind === 'card') return null;
  if (plan.kind === 'mock') return 'desktop';
  return APPS[plan.app]?.device ?? 'desktop';
}
