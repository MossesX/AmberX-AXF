# Source of apps/axhub-web/src/assets/help/axhub.json (hand-written Help mode entries for axHub web).
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
S("view:home", "Approvals", "Everything waiting on you: held calls counting down (they run by themselves unless you Deny) and straight approvals (they only run if you Approve).", "Tap a row's caret to see the exact code before you decide.", "Each row says who asked (Claude.ai, Claude Code, headless build, console, agent), what it wants to do and why. Deny drops it for good; Approve now runs it at once; Shelve pauses a countdown until you make up your mind.", ["view:approvals-log", "view:approval"])
S("view:hub", "Hub", "Your hub at a glance: services, jobs, devices and what's connected.")
S("view:approval", "Request", "One call in full: the reason, the exact code, who asked, the tool and its risk, the timeline and the result.", related=["view:home"])
S("view:go-pass", "Go pass", "Lets a Claude session that can't reach the hub work anyway, for the hours you pick. When it ends, they stop.", "Pick the hours, add a note, tap Go.")
S("view:approvals-log", "Approvals log", "Every call the hub ever held or asked about: decided, denied, timed out — with who asked and what ran.")
S("view:apps", "Apps", "Your apps on the hub, each with its page.")
S("view:users", "Users", "Who can sign in to the hub, their role and their permissions.")
S("view:handoff", "Handoff", "Hands a job to another Claude account with everything it needs, and shows the runs.")
S("view:handoff-run", "Handoff run", "One handoff run: what was sent, what came back.")
S("view:assets", "Assets", "Every asset this app uses; pick one to look at it or swap it in.")
S("view:account", "Account", "Your hub account: name, password, signed-in devices.")
S("view:services", "Services", "Every service the hub connects to, and its tools.")
S("view:jobs", "Jobs", "Slow calls the hub is running for you, and their results.")
S("view:audit", "Audit log", "Everything that changed on the hub, who did it and when.")
S("view:vault", "Vault", "Secrets the hub keeps. They're never shown back in full.")
S("view:projects", "Projects", "Every project's files on the hub (/projects).")
S("view:devices", "Devices", "Phones and computers paired with the hub.")
e("action:axhub.search", "Search everything", "Finds any page, approval, app or setting by what you type.")
e("action:axhub.check", "Check the hub now", "Asks the hub right now instead of waiting for the next check.")
e("action:hub.open", "Hub page", "Opens that hub page.")
e("action:hub.open:approvals", "Approvals", "Opens what's waiting on you.")
e("action:hub.open:log", "Approvals log", "Opens the full history of approvals.")
e("action:axhub.signout", "Sign out of axHub", "Signs this browser out of the hub. Approvals stop showing here until you sign back in.")
e("indent-size", "Indent size", "How far the JSON is indented.", kind="field")
e("keep-it", "Keep it", "Keeps it as it is.")
e("all-requests", "All requests", "Back to every request.")
e("how-long", "How long", "How long to put it off.", kind="field")
e("amount", "Amount", "How many (minutes, hours…).", kind="field")
e("unit", "Unit", "Minutes, hours or days.", kind="field")
e("date-and-time-your-time", "Date and time", "When it should run, in your time.", kind="field")
e("wait-for", "Wait for", "Put it off for a while, or until a set time.", kind="field")
e("postpone", "Postpone", "Puts the call off until the time you picked. It still needs your OK then.")
e("requests", "Requests", "The calls in this log.", kind="tab")
e("download-json", "Download JSON", "Saves the whole log as a JSON file.")
e("decided", "Decided", "How it ended: approved, denied, timed out.", kind="column")
e("column:decided", "Decided", "How it ended: approved, denied, timed out. Tap to sort.", kind="column")
e("tool", "Tool", "The tool the call uses (vps.run, github.pulls/create…).", kind="column")
e("column:tool", "Tool", "The tool the call uses. Tap to sort.", kind="column")
e("the-request", "The request", "Opens this call's own page.")
e("newer", "Newer", "Shows newer calls.")
e("older", "Older", "Shows older calls.")
e("stop-now", "Stop now", "Stops this running call.")
e("every-source", "Every source", "Shows calls from everyone: Claude.ai, Claude Code, headless builds, the console, agents.", kind="field")
e("open-the-request", "Open the request", "Opens this call's own page with everything about it.")
e("hub-page", "Hub page", "Opens this app's page on the hub.")
e("sign-in-to-axhub", "Sign in to axHub", "Signs you in, so approvals and your look show here.")
e("apps-page", "Apps page", "Opens the app's own page.")
e("note-optional-shown-in-the-pass", "Note", "Optional: what the pass is for. Shown in the pass.", kind="field")
e("go-for-h", "Go", "Starts the pass for the hours you picked. Sessions without the hub may work until it ends.")
e("all-runs", "All runs", "Every handoff run.")
e("continue-installation-and-handoff", "Continue", "Carries on installing and hands the job over.")
e("ive-sent-it", "I've sent it", "Tells the hub you've sent the message, so it waits for the reply.")
e("sign-out-the-others", "Sign out the others", "Signs out every other device using your account. This one stays signed in.")
e("current-password", "Current password", "Your password now.", kind="field")
e("new-password", "New password", "The one you want.", kind="field")
e("new-password-again", "New password again", "Same again, to catch typos.", kind="field")
e("change-password", "Change password", "Saves the new password.")
e("settings-appearance", "Settings → Appearance", "Opens the look settings.")
e("username", "Username", "What they sign in with.", kind="field")
e("temporary-password", "Temporary password", "A password they must change the first time they sign in.", kind="field")
e("save-name-and-email", "Save name and email", "Saves the user's name and email.")
e("change-role", "Change role", "Gives the user another role (admin, member…).")
e("another-permission", "Another permission", "Adds a permission to this user.", kind="field")
e("save-permissions", "Save permissions", "Saves what this user may do.")
e("set-a-temporary-password", "Set a temporary password", "Gives the user a password they must change on first sign-in.", kind="toggle")
e("set-password", "Set password", "Saves the password.")
e("the-hubs-approvals-page", "The hub's approvals page", "Opens the approvals page on the hub.")
e("pick-a-password", "Pick a password", "Choose the password for this account.", kind="field")
intros = [
 {"screen": "home", "title": "Approvals", "steps": [
   {"say": "Everything waiting on you. Held calls count down and run by themselves unless you Deny them.", "target": ""},
   {"say": "Each row says who asked and what it wants. The caret opens the exact code in place.", "target": "approval-details"},
   {"say": "Deny drops it for good. Approve now runs it right away. That's it — you're the boss.", "target": "approval-deny"}]},
 {"screen": "approvals-log", "title": "Approvals log", "steps": [
   {"say": "Every call the hub ever held or asked about, newest first.", "target": ""},
   {"say": "Filter by source or tool, tap a row for the full request.", "target": ""}]},
 {"screen": "go-pass", "title": "Go pass", "steps": [
   {"say": "When a Claude session can't reach the hub, it stops and asks for a go. This is where you give one.", "target": ""},
   {"say": "Pick the hours, tap Go. When it runs out, the sessions stop again.", "target": ""}]},
 {"screen": "users", "title": "Users", "steps": [
   {"say": "Who can sign in, their role and what they may do.", "target": ""},
   {"say": "Tap a user to change their role, permissions or set a temporary password.", "target": ""}]},
]
pack = {"$axf": "asset@1", "type": "help", "id": "axhub", "name": "axHub web help", "version": "1.0.0",
 "description": "Help mode entries for axHub web: approvals (who asked, Approve now / Deny / details), the request page, the log, Go pass, users, account, handoff and the hub pages, plus screen intros. Hand-written.",
 "author": "AmberX AXF", "tags": ["help", "axhub"], "data": {"scope": "axhub-web", "entries": E, "intros": intros}}
seen=set()
for x in E:
    assert x["target"] not in seen, x["target"]; seen.add(x["target"])
json.dump(pack, open(sys.argv[1], "w"), indent=2, ensure_ascii=False); open(sys.argv[1], "a").write("\n")
print(len(E), "entries,", len(intros), "intros")
