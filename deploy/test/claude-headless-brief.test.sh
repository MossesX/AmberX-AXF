#!/usr/bin/env bash
# Launch brief tests: bash deploy/test/claude-headless-brief.test.sh
#  1. deploy/claude-headless.sh hands the prompt to claude on stdin, never as an argv string: a 300 KB brief (over the
#     128 KB MAX_ARG_STRLEN that made exec fail with E2BIG) launches, and the fake claude reads all of it from stdin.
#  2. the temp prompt file is removed once the run ends.
#     AXF_BUILD_STEP (a Pipeline 2.0 step) reaches the session: its exit call names the step.
#     A launch outside the orchestrator gets its model from the VPS triage gate, and the decision is logged.
#  3. the dispatcher's brief builder (pipeline.mjs fitBriefFor) trims a brief over builds.briefMaxBytes and keeps
#     "## Brett said (verbatim)" and the pipeline paragraph.
# Real tmux and a fake claude in HOME/.local/bin (the launcher puts ~/.local/bin first on PATH). Skips 1–2 without tmux.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/axf-brief-test.XXXXXX")"
pass=0 fail=0
ok() { if eval "$1"; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "✗ $2" >&2; fi; }
tag="brieftest-$$"
cleanup() { tmux kill-session -t "axf-$tag" 2>/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT

if command -v tmux >/dev/null && command -v node >/dev/null; then
  home="$tmp/home"; mkdir -p "$home/.local/bin" "$tmp/run" "$tmp/tmpdir" "$tmp/headless"
  cat > "$home/.local/bin/claude" <<'EOF'
#!/usr/bin/env bash
# fake claude: records how many bytes came on stdin and the longest argument, then answers like stream-json
longest=0; for a in "$@"; do (( ${#a} > longest )) && longest=${#a}; done
got="$(cat | wc -c)"
# the prompt file on stdin (its path, not a count in TMPDIR: a shared tmux server may not carry the test's TMPDIR)
src="$(readlink "/proc/$$/fd/0" 2>/dev/null)"; printf '%s\n' "$src" > "$PWD/claude-prompt-path.txt"
[[ "$(basename "$src")" == axf-brief.* && -f "$src" ]] && echo 1 > "$PWD/claude-tmpfiles.txt" || echo 0 > "$PWD/claude-tmpfiles.txt"
printf '%s\n' "${AXF_BUILD_STEP:-}" > "$PWD/claude-step.txt"   # the Pipeline 2.0 step reaches the session inside tmux
printf '%s\n' "$*" > "$PWD/claude-args.txt"   # the model the triage gate assigned reaches claude
printf 'stdin=%s longest_arg=%s\n' "$got" "$longest" > "$PWD/claude-got.txt"
echo '{"type":"result","subtype":"success","result":"done"}'
EOF
  chmod +x "$home/.local/bin/claude"
  { printf '# Brief test\n\n## Brett said (verbatim)\n> launch a big one\n\n'; head -c 300000 /dev/zero | tr '\0' 'x' | fold -w 200; printf '\n'; } > "$tmp/run/brief.md"
  ok '(( $(wc -c < "$tmp/run/brief.md") > 300000 ))' 'the test brief is over 300 KB'
  (cd "$tmp/run" && env HOME="$home" TMPDIR="$tmp/tmpdir" AXF_HEADLESS_DIR="$tmp/headless" AXF_SLOTS=off AXF_WATCH_LIVE=off AXF_AGENT_BOOK=off \
      AXF_OWN_LOGIN=off AXF_WORKERS=off AXF_LOOK_GATE=off AXF_ORIGIN=off AXF_BUILD_SLICE=off AXF_LOGIN_NOTE=off AXF_BUILD_LIMIT=off \
      AXF_BRIEF_ONLY=off AXF_CREW_SAY=off AXF_BUILD_ID= AXF_BUILD_STEP=s7 AXF_AGENT= AXF_AGENT_NAME= AXF_DISPATCH_TOKEN= \
      AXF_MODEL= AXF_SURFACE= AXF_MODEL_TRIAGED= AXF_MODEL_TRIAGE_DIR="$tmp/triage" AXF_CLAUDE_SETTINGS_FILE="$tmp/no-settings.json" AXF_FABLE_UPGRADE_APPROVAL= \
      bash "$ROOT/deploy/claude-headless.sh" --name "$tag" --brief brief.md --log run.log -- --model opus > "$tmp/launch.out" 2>&1)
  st=$?
  ok '(( st == 0 ))' "the launch starts (exit $st): $(tail -3 "$tmp/launch.out")"
  # the launcher runs several node gates before claude; on a loaded VPS each can take a minute (AXF_BRIEF_TEST_WAIT seconds)
  for _ in $(seq 1 $(( ${AXF_BRIEF_TEST_WAIT:-180} * 5 ))); do [[ -s "$tmp/run/claude-got.txt" ]] && break; sleep 0.2; done
  got="$(cat "$tmp/run/claude-got.txt" 2>/dev/null)"
  stdin_bytes="$(sed -n 's/^stdin=\([0-9]*\).*/\1/p' <<<"$got")"; longest="$(sed -n 's/.*longest_arg=\([0-9]*\).*/\1/p' <<<"$got")"
  ok '[[ -n "$got" ]]' "claude ran (no E2BIG): $(cat "$tmp/run/run.log" 2>/dev/null | tail -3)"
  ok '(( ${stdin_bytes:-0} >= 300000 ))' "claude read the whole brief on stdin (${stdin_bytes:-0} bytes)"
  ok '(( ${longest:-999999} < 131072 ))' "no argument reached 128 KB (longest ${longest:-?})"
  ok '! grep -qi "argument list too long" "$tmp/run/run.log" "$tmp/launch.out" 2>/dev/null' 'no "Argument list too long" anywhere'
  ok '[[ "$(cat "$tmp/run/claude-tmpfiles.txt" 2>/dev/null)" == 1 ]]' 'the prompt file existed while claude ran'
  ok '[[ "$(cat "$tmp/run/claude-step.txt" 2>/dev/null)" == s7 ]]' "AXF_BUILD_STEP reaches the session (tmux starts it in the server's env; the exit call needs --step): '$(cat "$tmp/run/claude-step.txt" 2>/dev/null)'"
  # the hand lane of the model triage gate (model-triage@1): the launch asked for Opus, nothing in the brief says the work
  # is simple, so the gate's default (Fable) stands over the request (a floor); the decision is logged with its rule
  ok 'grep -q -- "--model claude-fable-5-2" "$tmp/run/claude-args.txt" 2>/dev/null' "the hand launch runs on the model the triage gate assigned: $(cat "$tmp/run/claude-args.txt" 2>/dev/null | cut -c1-120)"
  ok 'grep -q "model triage: Fable" "$tmp/launch.out"' "the launcher says what the gate decided: $(grep 'model triage' "$tmp/launch.out")"
  ok 'grep -q "\"lane\":\"hand\"" "$tmp/triage/decisions.jsonl" 2>/dev/null && grep -q "\"rule\":\"default\"" "$tmp/triage/decisions.jsonl" && grep -q "\"name\":\"$tag\"" "$tmp/triage/decisions.jsonl"' "the decision is in the gate's log (lane, rule, session): $(cat "$tmp/triage/decisions.jsonl" 2>/dev/null)"
  for _ in $(seq 1 $(( ${AXF_BRIEF_TEST_WAIT:-180} * 5 ))); do tmux has-session -t "axf-$tag" 2>/dev/null || break; sleep 0.2; done
  prompt_path="$(cat "$tmp/run/claude-prompt-path.txt" 2>/dev/null)"
  ok '[[ -n "$prompt_path" && ! -e "$prompt_path" ]]' "the prompt file is removed after the run: ${prompt_path:-none}"
else
  echo '(tmux or node missing: skipped the launcher end-to-end checks)'
fi

# 3. the brief builder's byte cap
out="$(cd "$ROOT" && AXF_BUILDS_STORE="$tmp/store.json" AXF_BUILDS_LIVE=0 AXF_BUILD_HOOKS=off AXF_SHIPPED=off AXF_DATA_DIR=off AXF_PIPELINE_DIR="$tmp/pipe" AXF_PIPELINE_CONSOLE=off \
  node --input-type=module -e '
const P = await import("./apps/console-web/plugins/build-orchestrator/pipeline.mjs"); // axf-plugin:build-orchestrator
const core = await import("./framework/plan/builds-store-core.mjs");
const steps = Array.from({ length: 3000 }, (_, i) => ({ id: `s${i + 1}`, text: `Step ${i + 1}: ${"do the thing carefully ".repeat(4)}`, estimate: "5 min", done: i < 100 }));
const b = core.normBuild({ id: "big", title: "Big", status: "queued", steps, origin: { said: "Make it work, every time.", at: "2026-11-17T00:00:00Z", by: "Brett" } });
const rules = core.projectOrchestrator(core.normalizeStore({ ...core.emptyStore(), builds: [b] }), "all").rules;
const opts = { account: "a", model: "Opus" }; const blocks = { blocks: { rules: "## Rules for this job\n" + "- a rule line that goes on\n".repeat(8000) } };
const plain = P.fitBriefFor(b, rules, { ...opts, maxBytes: 1024 * 1024 }, { blocks });
const cut = P.fitBriefFor(b, rules, { ...opts, maxBytes: 64 * 1024 }, { blocks });
const tiny = P.fitBriefFor(b, rules, { ...opts, maxBytes: 16 * 1024 }, { blocks: null });
console.log(JSON.stringify({
  listed: (plain.text.match(/^\[ \] s\d+/gm) || []).length, more: /2860 more steps in the store/.test(plain.text), doneLine: /\[x\] 100 steps done/.test(plain.text),
  cutBytes: cut.bytes, cutTrimmed: cut.trimmed, cutSaid: cut.text.includes("## Brett said (verbatim)") && cut.text.includes("Make it work, every time."), cutPipeline: cut.text.includes("## Pipeline"),
  tinyBytes: tiny.bytes, tinySaid: tiny.text.includes("## Brett said (verbatim)"), tinyPipeline: tiny.text.includes("## Pipeline"),
}));' 2>&1)"
j() { node -e 'const o=JSON.parse(process.argv[1]);const v=process.argv[2].split(".").reduce((a,k)=>a?.[k],o);console.log(Array.isArray(v)?v.join(","):v)' "$out" "$1" 2>/dev/null; }
ok '[[ "$(j listed)" == 40 ]]' "a 3,000-step phase lists 40 open steps ($out)"
ok '[[ "$(j more)" == true && "$(j doneLine)" == true ]]' 'with the done count and the "N more steps in the store" line'
ok '(( $(j cutBytes) <= 65536 ))' "over the cap it is trimmed to fit ($(j cutBytes) bytes; $(j cutTrimmed))"
ok '[[ "$(j cutSaid)" == true && "$(j cutPipeline)" == true ]]' "the trimmed brief still carries Brett said (verbatim) and the Pipeline paragraph"
ok '(( $(j tinyBytes) <= 16384 )) && [[ "$(j tinySaid)" == true && "$(j tinyPipeline)" == true ]]' "the smallest cap still fits with his words ($(j tinyBytes) bytes)"

echo "claude-headless-brief: $pass passed, $fail failed"
(( fail == 0 ))
