# Source of apps/console-web/src/assets/help/console.json (hand-written Help mode entries for the Dev Console).
import json, sys
E = []
def e(target, title, text, tryIt=None, more=None, related=None, kind=None):
    d = {"target": target, "title": title, "text": text}
    if more: d["more"] = more
    if tryIt: d["tryIt"] = tryIt
    if related: d["related"] = related
    if kind: d["kind"] = kind
    E.append(d)
S = lambda *a, **k: e(*a, kind="screen", **k)

# ---------- screens (views)
S("view:home", "Home", "The console's front page: how the framework is doing, what's building, what needs you. Start here when you're lost.", "Tap any card to jump to its screen.")
S("view:tracker", "Tracker", "Every framework feature and where it's at: built, partial, planned. Green means done, kid.")
S("view:plan", "Plan", "The build plan: what gets built, in what order, and what's done.", related=["view:build", "view:pending"])
S("view:build", "Build queue", "The queue of build steps waiting their turn. The MCP tools build_next and build_step work through it.", related=["view:builds"])
S("view:pending", "Pending builds", "Builds parked until you say go (or until their model is around). 'Add it to the pending list' means it lands here, not built.", related=["view:builds", "view:build-orchestrator"])
S("view:standards-projects", "Projects", "Every project's manifest. Nothing gets loaded or built without a valid one.")
S("view:standards-rules", "Manifest rules", "The rules every project manifest is checked against. Locked rules can't be loosened.")
S("view:catalog", "Catalog", "Every feature the framework has or plans, with its status.")
S("view:libraries", "Libraries", "Installable libraries for apps on the framework (settings, alerts, hub…).")
S("view:demos", "Demos", "Demo apps showing the framework off.")
S("view:modules", "Modules", "The Android modules (on hold for now).")
S("view:boilerplates", "Boilerplates", "Starting points for new apps.")
S("view:components", "Components", "Every framework control, live, in the current theme. Handy to see what a swap does.")
S("view:assets", "Assets", "Every asset in the app (themes, layouts, menus…). Pick one, look at its JSON, activate it live.")
S("view:account", "Account", "Your role and what it lets you do. Switch roles to see the console as someone else.")
S("view:builds", "Builds", "Every build of the active profile in one place. Builds view: one row per build with a live progress bar. Steps view: every step on its own row.", "Double-tap a build's name to rename it.", "This is the one builds store (builds@1). Everything else — Pending builds, the build queue, the Build manager — is just a view of it, so they can't drift apart. Changes are drafts until you tap Apply; Discard throws them away. Every save is versioned, so Restore default or the history can always get you back.", ["view:build-orchestrator", "view:pending", "view:build-manager"])
S("view:build-orchestrator", "Build orchestrator", "Breaks every build into steps of 30 minutes or less, each pinned to Fable or Opus. When the model switches between phases it waits for your OK.", more="Tabs: Builds (like Pending builds, with more options), Approvals (phases waiting for your OK at a model switch) and Rules (the token rules: one session, no sub-agents, briefs carry only the current phase).", related=["view:builds"])
S("view:build-manager", "Build manager", "Everything building right now and everything left: model, status, time left, steps. Start a build from here and watch it live.", related=["view:builds"])
S("view:build-breaker", "Build Breaker", "Everything you ever asked for, in plain English, with what happened to each ask.")
S("view:feature-matrix", "Feature matrix", "Each build's list of pieces with minutes, model and why. Tick = keep, untick = skip, then Apply.")
S("view:ui-review", "UI Review", "Every new screen, dialog, menu or banner a build makes waits here for your OK, with phone and desktop shots. Approve, ask for changes or reject.", "Open one and swipe between the phone and desktop shots.", "A PR whose UI is waiting, has changes asked or is rejected is held: it won't merge until you approve it here. Screenshots that aren't for approval go to Screenshots instead.", ["view:ui-screenshots", "view:design-packs"])
S("view:ui-screenshots", "Screenshots", "Pictures Claude took while checking things — not for approval. Every shot sits in a named, timestamped group.", "Open a group, then Send to review if one should be approved after all.", related=["view:ui-review"])
S("view:design-packs", "Design packs", "Whole matched looks waiting for review.")
S("view:agent-swarm", "Agent swarm (the Breakroom)", "Your crew of specialist agents: who's working, on what, what it's costing, and their ID cards. The HR side lets you hire, suspend, rehire and top them up.", "Open Crew and look at an agent's card.", "Crew is the roster: on duty or not, salary, what they spent, jobs done. ID cards are the badge designs. Agents lists their skills and models. Jobs shows what a build was split into and which agent holds which files. Cost shows runs, tokens and dollars per agent — today, this week and all time. Group chat is where they talk.")
S("view:agent-manager", "Agent manager", "Your named agents (Molly and friends): who they are, what they know, what they may do.")
S("view:ai-assistant", "AI assistant", "Ask Claude about the console, the framework or your builds.")
S("view:plan-studio", "Plan Studio", "Every plan in one place. 'Put it in a plan for later' lands here, parked — it only becomes a build when you say Turn into a build.", "Switch between Tree, Grid, Board and Roadmap at the top.", related=["view:builds"])
S("view:plugin-manager", "Plugin Manager", "Every plugin: what it does, its switch, logs, settings and what it needs. Turn one off and it's gone from every screen.", "Tap a plugin, then its Settings.")
S("view:plugin-update", "Plugin Update", "New versions of your plugins, and replacing one built by another model.")
S("view:project-wizard", "New project", "Make a new project: an AXF app, a GitHub repo or a folder, with its manifest and Claude files.")
S("view:session-checkin", "Sessions", "Every Claude session that checked in: where it ran, what it's doing.")
S("view:theme-manager", "Theme manager", "Make and edit colour and style themes.")
S("view:todo-manager", "Todos", "Your to-do list.")
S("view:voice-notes", "Voice notes", "Record a note out loud; it's transcribed and kept.")
S("view:output-recorder", "Audio out", "Records what the phone plays (never the mic), in parts, grouped by session.")
S("view:audio-extract", "Audio Extract", "Pulls the audio out of a video.")
S("view:brand-library", "Brand library", "Logos, animated marks and icon packs for your apps.")
S("view:changes-grid", "Changes & features", "Every codebase change and the feature it belongs to, in one grid.")
S("view:claude-handoff", "Claude handoff", "Hands work to another Claude account with everything it needs.")
S("view:context-menu-designer", "Context menu designer", "Design what the right-click / long-press menu shows.")
S("view:fable-rebuilds", "Fable rebuilds", "Old rebuild items and their differences reports.")
S("view:mcp", "MCP servers", "The MCP servers the console talks to.")
S("view:approvals-log", "Approvals", "Every approval and veto call: who asked, what, when, and what happened.")
for v, t in {"apps": "Apps", "audit": "Audit", "devices": "Devices", "jobs": "Jobs", "services": "Services"}.items():
    S(f"view:{v}", t, f"The {t} screen of the hub, opened inside the console.")

# ---------- banners
e("banner:approvals", "Approvals banner", "Shows up whenever axHub is holding a call on its 90-second countdown, or waiting on you. It runs by itself when the countdown ends unless you Deny it.", "Tap a row to open the full call.", "Deny = it never runs. Approve = run it now. Shelve = pause the countdown until you decide. The banner rings (Settings → Plugins → Approvals banner) so you don't miss one.", ["approval-deny", "approval-approve", "approval-details"], "banner")
e("banner:build-manager", "Build manager banner", "What's building right now, with progress and time left. Tap it for the Build manager.", kind="banner", related=["view:build-manager"])
e("banner:codebase-changes", "Codebase changes banner", "Every change Claude made that you haven't closed yet. Closing one clears it on every device; it stays in the log.", kind="banner")
e("banner:keys-needed", "Keys needed", "A key or token is missing or dead. Tap Fix for the exact steps.", kind="banner")
e("banner:push-banner", "Push banner", "Every branch not on main yet, with its PR and CI. Ready PRs merge by themselves; you don't have to do a thing.", kind="banner")
e("banner:systems-check", "Systems check", "Something's broken: what broke, what it breaks and since when, with a Fix button. Green means you're good.", kind="banner")

# ---------- approvals (rows everywhere)
e("open-the-approvals-page", "Open the approvals page", "Opens every approval on axHub.")
e("call-waiting-for-your-approval-in-axhub", "Waiting on axHub", "A call is waiting for your OK on axHub. Tap to see it.")
e("hide-until-something-new-is-waiting", "Hide until something new", "Hides the banner until another call shows up.")
e("alarm", "Alarm", "How the approvals banner rings: tone, volume and repeats.", kind="field")
e("test-the-alarm", "Test the alarm", "Plays the alarm so you know what it sounds like.")
e("notices-timer-started-s-left-running", "Notices", "Which moments of a countdown push a notice to the AmberX app.", kind="toggle")
e("action:approvals.check", "Check approvals now", "Asks axHub right now instead of waiting for the next check.")

# ---------- builds page / orchestrator / profiles / manager
e("action:builds.view", "Builds / Steps", "Switches the Builds page between one row per build and one row per step.")
e("action:builds.view:steps", "Steps view", "Every step of every build on its own row: expand, multi-select, divide or move them.")
e("steps", "Steps", "Every step on its own row.", kind="tab")
e("builds", "Builds", "One row per build with a live progress bar.", kind="tab")
e("divide", "Divide", "Splits the picked step into smaller steps (each 30 minutes or less).")
e("harvest", "Harvest", "Pulls the open steps out of several builds into one new build, so related work is built together.")
e("split-into-n-builds", "Split into N builds", "Breaks one big build into several smaller ones.")
e("restore-default", "Restore default", "Puts the order and names back the way the orchestrator had them.")
e("add-to-orchestrator", "Add to orchestrator", "Sends this to the Build orchestrator, which splits it into Fable / Opus steps and puts it on every list.")
e("add-to-draft", "Add to draft", "Adds it to your draft; nothing is saved until Apply.")
e("copy-next-brief", "Copy next brief", "Copies the brief for the next phase, ready to paste into a session on the right model.")
e("copy-resume-prompt", "Copy resume prompt", "Copies a message another Claude session can start from to carry on this work.")
e("approve-switch-to", "Approve the model switch", "OKs the next phase on the other model (Fable ↔ Opus).")
e("approve-switch-from", "Approve the model switch", "OKs the next phase on the other model (Fable ↔ Opus).")
e("build-orchestrator", "Build orchestrator", "Its settings: how builds are split and when it asks you.", kind="tab")
e("build-profiles", "Build profiles", "Which set of work the console is on (Main framework, Refactor, Angel…). Switching changes it on every device.", kind="tab")
e("switch-or-manage-profiles", "Build profile", "The profile in force. Tap to switch or manage profiles.", more="A build profile is one whole set of work data: plan, queue, pending builds, tracker and orchestrator builds. Main framework is the base. Sessions can use another one for one command with AXF_BUILD_PROFILE.")
e("new-profile", "New profile", "Makes a new, empty build profile.")
e("show-the-profile-on-the-banner", "Show the profile on the banner", "Shows which profile is in force as a chip on the banner.", kind="toggle")
e("reload-the-console-after-switching", "Reload after switching", "Reloads the console after a profile switch, so every screen shows the new profile's data.", kind="toggle")
e("action:build-manager.live", "Building now", "Opens the Build manager on what's running right now.")
e("action:build-manager.built", "Built", "What's been built, with its cost and time.")
e("open-in-build-manager", "Open in Build manager", "Opens this build in the Build manager.")
e("follow-it-in-the-build-manager", "Follow it in the Build manager", "Opens the Build manager so you can watch this build.")
e("open-the-build-manager", "Open the Build manager", "Opens the Build manager.")
e("build-manager", "Build manager", "Its settings.", kind="tab")
e("banner-while-a-build-runs", "Banner while a build runs", "Shows the Build manager banner whenever a build is running.", kind="toggle")
e("banner-on-every-load", "Banner on every load", "Shows the banner every time the console opens.", kind="toggle")
e("refresh-the-list-live-builds-and-history", "Refresh", "Reloads the list, the live builds and the history.")
e("one-build", "One build", "Shows the steps of one build only.", kind="tab")
e("already-built", "Already built", "This is already on main; nothing to do.")
e("fable-rebuild", "Fable rebuild", "An old rebuild item. New Fable work is built on Fable in the first place.")

# ---------- UI review + screenshots
e("send-to-review", "Send to review", "Moves this screenshot into the UI Review queue, waiting for your Approve / Reject.")
e("ask-changes", "Ask for changes", "Sends it back with your comment. The PR stays held until it's approved.")
e("all-groups", "All groups", "Back to the list of screenshot groups.")
e("group-name", "Group name", "What this group of shots is called. Same name the same day = the same group.", kind="field")
e("group-by-day", "Group by day", "Groups the shots by the day they were taken.", kind="toggle")
e("before-after", "Before / After", "Drag the slider to compare the before and after shots.")
e("next-screenshot", "Next screenshot", "Next picture in this group.")
e("previous-screenshot", "Previous screenshot", "Previous picture.")
e("reload-screenshots", "Reload screenshots", "Reads the screenshots again.")
e("copy-link", "Copy link", "Copies a link straight to this.")
e("pick-pictures", "Pick pictures", "Choose the screenshots to upload.")
e("name-what-the-pictures-show", "Name", "Say what the pictures show, so you can find them later.", kind="field")
e("screen-or-route", "Screen", "Which screen (or route) the pictures are of.", kind="field")
e("ui-review", "UI Review", "Its settings.", kind="tab")
e("grid", "Grid", "Shows them as a grid of pictures.", kind="tab")
e("list", "List", "Shows them as a list.", kind="tab")
e("move-to", "Move to", "Moves the picked shots into another group.")

# ---------- agent swarm / Breakroom / HR
e("swarm", "Swarm", "The jobs a build was split into, who holds which files, and what's running.", kind="tab")
e("crew", "Crew", "The roster: every agent with its status, salary, spend and jobs done.", kind="tab")
e("id-cards", "ID cards", "The badge designs agents wear. Make default picks the one everyone wears.", kind="tab")
e("agents", "Agents", "Each agent's skills, model and rules.", kind="tab")
e("jobs", "Jobs", "What each build was split into, who holds which files, and what's running.", kind="tab")
e("cost", "Cost", "Runs, tokens and dollars per agent: today, this week, all time.", kind="tab")
e("cards", "Cards", "The ID-card designs. Make default picks the one every agent wears.", kind="tab")
e("group-chat", "Group chat", "Where the agents talk to each other (and you).", kind="tab")
e("rehire", "Rehire", "Brings a suspended or fired agent back on the crew.")
e("suspend", "Suspend", "Benches an agent: it takes no new jobs until you rehire it.")
e("top-up", "Top up", "Gives an agent more budget to spend.")
e("make-default", "Make default", "Every agent wears this card design from now on.")
e("new-design", "New design", "Opens the card designer on a fresh card.")
e("save-card-details", "Save card details", "Saves the name, photo and fields on this agent's card.")
e("save-as-new", "Save as new", "Saves your changes as a new one and leaves the original alone.")
e("edit-as-new", "Edit as new", "Starts a copy you can change without touching the original.")
e("agent-swarm", "Agent swarm", "Its settings.", kind="tab")
e("color-by-vibe", "Color by vibe", "Colours each chat message by how it reads (happy, stressed…).", kind="toggle")
e("color-every-message-by-its-vibe-score", "Color by vibe", "Colours each chat message by how it reads.", kind="toggle")
e("use-the-room", "Use the room", "Puts the agents in the shared room so they can see each other's work.")
for col, t in {"runs": "How many jobs it ran.", "tokens": "Tokens used.", "dollars": "What it cost.", "today": "Today only.", "week": "This week.", "all-time": "Since the start."}.items():
    e(f"column:{col}", col.replace("-", " ").capitalize(), f"{t} Tap the header to sort.", kind="column")

# ---------- keys / systems check / push banner / codebase changes
e("action:ai-keys.open", "AI keys", "Your Anthropic keys: API keys and Claude subscription tokens. Every key is tested before it's saved and only the last 4 characters ever come back to the browser.")
e("ai-keys", "AI keys", "Its settings.", kind="tab")
e("open-ai-keys", "Open AI keys", "Opens the AI keys dialog.")
e("api-key", "API key", "Paste an Anthropic API key (sk-ant-api…). It's tested before it's saved.", kind="field")
e("access-token", "Access token", "The token this connection uses. It's stored on the server, never shown again.", kind="field")
e("refresh-token", "Refresh token", "Lets the connection get a new access token when the old one runs out.", kind="field")
e("claude-code-credentials", "Claude Code credentials", "The login headless Claude Code uses on the VPS.")
e("set-token", "Set token", "Saves a new token (tested first).")
e("test-again", "Test again", "Re-tests the key against its service.")
e("use-this-one", "Use this one", "Makes this key the active one.")
e("stop-using", "Stop using", "This key isn't used any more (it stays saved).")
e("action:system-check.open", "Systems check", "Every key and connection, tested live. Red = broken, with what it breaks and a Fix.")
e("systems-check", "Systems check", "Its settings, including Fix it yourself per check.", kind="tab")
e("open-the-systems-check", "Open the systems check", "Opens the systems check.")
e("check-all-again", "Check all again", "Tests every key and connection right now.")
e("fix", "Fix", "Runs the fix for this check, or shows exactly what to do.")
e("auto-fix-with-vinny", "Auto fix with Vinny", "Hands the fix to Vinny (axHub's agent) to run as a veto call.")
e("action:keys-needed.open", "Keys needed", "The keys and tokens that are missing or dead, with how to fix each.")
e("open-keys-needed", "Open Keys needed", "Opens the list of missing keys.")
e("push-banner", "Push banner", "Its settings: auto-merge, PR for every branch, who fixes failed pulls.", kind="tab")
e("open-pr", "Open PR", "Opens a pull request for this branch (a veto call).")
e("merge-ready-pull-requests-by-themselves", "Auto-merge", "Merges ready PRs by themselves: not a draft, no conflicts, up to date with main, CI green.", kind="toggle")
e("open-a-pull-request-for-every-branch", "PR for every branch", "Opens a pull request for every branch ahead of main, so nothing reaches main except through a PR.", kind="toggle")
e("run-a-round-now", "Run a round now", "Checks every branch and PR right now instead of in 3 minutes.")
e("codebase-changes", "Codebase changes", "Its settings.", kind="tab")
e("codebase-change", "Codebase change", "One change Claude made: what was asked, the steps, the result.")
e("close-everywhere", "Close (everywhere)", "Takes it off the banner on every device. It stays in the log.")
e("open-the-log", "Open the log", "Opens the full log of changes on axHub.")
e("open-in-the-log", "Open in the log", "Opens this entry in the full log.")

# ---------- plan studio
e("view:plan-studio.reader", "Reader", "Read a plan like a document.")

intros = [
 {"screen": "home", "title": "Home", "steps": [
   {"say": "This is the console's front page. The cards show how the framework's doing and what needs you.", "target": ""},
   {"say": "The banners up top are live: approvals waiting, builds running, anything broken. Tap one to deal with it.", "target": ".fx-frame__banners"},
   {"say": "Everything is also in the app menu at the top, even when the nav is hidden. The ? next to it turns this help on and off.", "target": "action:help.mode"}]},
 {"screen": "builds", "title": "Builds", "steps": [
   {"say": "Every build of the active profile, one row each, with a live progress bar and the time left.", "target": ""},
   {"say": "Switch to Steps to see every step on its own row — expand, select, divide or move them.", "target": "action:builds.view:steps"},
   {"say": "Your edits are a draft until you hit Apply. Discard throws them away; every save can be restored.", "target": ""}]},
 {"screen": "build-orchestrator", "title": "Build orchestrator", "steps": [
   {"say": "Every build gets broken into steps of 30 minutes or less, each pinned to Fable or Opus.", "target": ""},
   {"say": "When the model switches between phases, it stops and asks you. That's the only time it asks.", "target": ""},
   {"say": "Rules shows the token rules every session follows: one session, no sub-agents, short briefs.", "target": ""}]},
 {"screen": "pending", "title": "Pending builds", "steps": [
   {"say": "Builds parked until you say go. Each step shows [Fable] or [Opus].", "target": ""},
   {"say": "It's a view of the one builds store, so it always matches the Builds page and the orchestrator.", "target": ""}]},
 {"screen": "build-manager", "title": "Build manager", "steps": [
   {"say": "What's building right now and what's left, with model, status and time left.", "target": ""},
   {"say": "Watch live on a running build pops up the screen it's changing, hot-rendering.", "target": "watch-live"}]},
 {"screen": "ui-review", "title": "UI Review", "steps": [
   {"say": "Every new screen, dialog or banner a build makes waits here for your OK, with phone and desktop shots.", "target": ""},
   {"say": "Approve, Ask for changes or Reject. A PR stays held until its UI is approved.", "target": ""},
   {"say": "Plain screenshots that don't need approval live next door in Screenshots.", "target": "view:ui-screenshots"}]},
 {"screen": "ui-screenshots", "title": "Screenshots", "steps": [
   {"say": "Pictures Claude took while checking things, each in a named, timestamped group.", "target": ""},
   {"say": "Open a group to swipe through it; Send to review moves one into the approval queue.", "target": ""}]},
 {"screen": "agent-swarm", "title": "The Breakroom", "steps": [
   {"say": "Your crew of specialist agents. Crew is the roster: who's on duty, salary, spend, jobs done.", "target": "crew"},
   {"say": "Suspend, Rehire and Top up are the HR buttons on each card. ID cards is where you pick their badge design.", "target": "id-cards"},
   {"say": "Jobs shows what a build was split into and which agent holds which files.", "target": "jobs"},
   {"say": "Cost shows what each agent spent today, this week and all time. Group chat is where they talk.", "target": "cost"}]},
 {"screen": "plan-studio", "title": "Plan Studio", "steps": [
   {"say": "Every plan in one place. 'Put it in a plan for later' lands here, parked.", "target": ""},
   {"say": "Switch views at the top: Tree, Grid, Board, Roadmap, Reader.", "target": ""},
   {"say": "A plan only becomes a build when you hit Turn into a build.", "target": ""}]},
 {"screen": "plugin-manager", "title": "Plugin Manager", "steps": [
   {"say": "Every plugin with what it does, its switch, logs and settings.", "target": ""},
   {"say": "Turn one off and it's gone from every screen. Each one can be uninstalled completely.", "target": ""}]},
 {"screen": "tracker", "title": "Tracker", "steps": [
   {"say": "Every framework feature and where it's at: built, partial or planned.", "target": ""},
   {"say": "It's generated from the catalog and status files, so it never lies about what's done.", "target": ""}]},
 {"screen": "plan", "title": "Plan", "steps": [
   {"say": "The build plan: what gets built and in what order.", "target": ""},
   {"say": "Tap a feature to see its steps and what it depends on.", "target": ""}]},
]

pack = {"$axf": "asset@1", "type": "help", "id": "console", "name": "Dev Console help", "version": "1.0.0",
 "description": "Help mode entries for the Dev Console: every screen, the banners, approvals (Approve / Deny / details / Watch live), Builds + Steps, the orchestrator, build profiles, UI Review + Screenshots, the Breakroom (agent swarm + HR), keys, systems check, push banner, Plan Studio, plus screen intros. Hand-written; plugin drafts live in each plugin's help.json.",
 "author": "AmberX AXF", "tags": ["help", "console"], "data": {"scope": "console-web", "entries": E, "intros": intros}}
seen = set()
for x in E:
    assert x["target"] not in seen, x["target"]; seen.add(x["target"])
json.dump(pack, open(sys.argv[1], "w"), indent=2, ensure_ascii=False); open(sys.argv[1], "a").write("\n")
print(len(E), "entries,", len(intros), "intros")
