# assignment@1 — the orchestrator hands a build or step to an employee agent

Status: v1, Nov 10 2026. Code: `framework/core/build-assignment.mjs` (pure). Schema: `assignment@1.schema.json` next to
this file (a generated copy of `framework/schemas/json/assignment.schema.json`; registry `framework/schemas/assignment.json`;
regenerate with `node framework/cli/axf.mjs schemas`). Check: `node framework/spec/check-build-assignment.mjs`
(fixture `framework/spec/fixtures/build-assignment.json`). Kotlin twin deferred (`framework/spec/PORTING.md`).

## What Brett said (Nov 10 2026, verbatim)

> When the orchestrator assigns builds or steps they are sent to the right employee who has its own set of briefs to
> send back to the orchestrator and uses the employee data in the brief. In the group chat the orchestrator asks if
> anyone can do something, if they have skills or tools or capabilities; the first one to take it opens a dialog listing
> all the matching agents with a percentage of each one being the best choice for the job. After the 90 second veto it
> chooses the best probable one by default.

## The envelope: the group chat message, not a new one

Every assignment line is a swarm chat message (`swarm-state@1` `messages`, `normMessage` in
`framework/core/engines/swarm-rules.mjs`): `id`, `at`, `from`, `kind`, `text`, `jobId`, `vibe`, `toned`. The one addition
is a chat kind, `assignment`, whose messages carry an `assignment` payload (below). Nothing else about the chat changes:
the room and per-agent switches, the vibe filter, the message cap and the `post()` ids all apply as they do to a
`handoff` or an `assign` line. Boss (the orchestrator), any agent on the roster and Brett may post the kind; which
payload *type* each may post is the payload's own rule (table below), checked by `messageErrors` in `swarm-chat.mjs`.

`jobId` names the work the way `swarm-job@1` does: `<buildId>` for a whole build, `<buildId>.<stepId>` for one step
(`jobIdOf`, `parseJobId`). A message whose `jobId` names other work than its payload is refused.

`text` is the human line (`messageFor` builds it, in the names the roster shows); the payload is the contract.

## Payload types

| type | who posts | fields (besides `type`, `buildId`, `stepId`, `ask`, `at`) | meaning |
|---|---|---|---|
| `ask` | boss | `need { skills[], tools[], capabilities[] }` (at least one) | "Who can take this?" `ask` is blank here; every later payload carries this message's id as `ask`. |
| `claim` | an agent | `by` | The first taker. A second claim on the same ask is refused ("rio already took it"). The claimer opens the dialog. |
| `candidates` | the claimer (or boss) | `by`, `candidates[] { employee, match, reasons[] }`, `vetoDeadline` | The dialog: every matching agent with the chance (%) it is the best choice, percentages adding up to 100, and the veto deadline = claimed at + 90 s. |
| `veto` | brett | `employee` (optional), `note` | Inside the window only. `employee` set = Brett's pick (assigned, pickedBy `brett`); blank = declined (back to the orchestrator). |
| `pick` | brett \| boss | `employee`, `pickedBy: brett \| default` | `brett` any time after the ask (even before a claim). `default` only once the window closed, and only the top candidate. |
| `brief` | the assigned employee | `by`, `ref`, `kind: brief \| report \| handoff \| question`, `employee { id, name, role, skill }` | A brief from the employee's own set, sent back to the orchestrator. `employee` is the agent data the brief was written with; `ref` points at the brief (a path or an id). |

Skills, tools and capabilities come from the agent's own record (`agent@1`: `skill` / `skills`, `tools`, and for
capabilities its `keywords`, `specialty`, `role`, `models`, `paths`). `candidatesFor(need, agents, { text, fallback })`
scores each agent: a needed skill it has × 3 (an all-rounder with `*` counts, reason `all-rounder: <skill>`), a needed
tool × 2, a capability word found × 1, plus one per roster keyword found in the step text. A tool everybody has is no
match on its own when the need names skills or capabilities. Agents scoring 0 are left out; when nobody scores, the
roster's `fallback` agent is the one candidate at 100 % with a reason saying so. Match % = the agent's score over the sum
of all scores, rounded so the list adds up to 100. Ties go to the cheaper salary. The caller passes only agents whose
status allows work (on duty, probation for small jobs; never off duty, injured, suspended, fired, quit, broke).

## The record: `assignment` on a build and on a step

Lives on `builds@1` records (`framework/plan/builds-store-core.mjs`): `build.assignment` for a whole build and
`step.assignment` for one step, each with its own `assignedEmployee` column. The column is the orchestrator table's
employee field (absent = none) and always equals the record's `assignedEmployee`; the normalizer keeps them equal: the
record wins when it exists (changing who has it is a `pick`, never a bare column write), and a build or step that only
ever had the column reads as `status: assigned` with that employee. Records from before this contract carry neither
field, and nothing is written to them until an assignment happens, so the 580 builds in the store are not rewritten or
republished by this contract (`node framework/cli/build-assignment.mjs migrate [--apply]` reads the raw store, carries
any older column into the record, and reports what it did).

```
{ status: '' | asked | claimed | veto | assigned | returned | declined,
  ask, askedAt, need { skills, tools, capabilities },
  candidates [ { employee, match, reasons[] } ],
  claimedBy, claimedAt, vetoDeadline,
  pickedBy: '' | brett | default, pickedAt,
  assignedEmployee,
  briefs [ { ref, kind, by, at, employee { id, name, role, skill }, message } ],
  messages [ chat message ids that built this record ],
  updatedAt }
```

`apply(record, payload, { at, from, messageId })` is the one state machine (returns `{ record, error }`; a refused payload
leaves the record unchanged and says why). `fold(messages, { buildId, stepId })` replays a chat into a record and lists the
refused lines. `defaultPick(record, now)` gives the boss's `pick` payload once the window closed (null while open or
when there is nothing to pick); `vetoLeft(record, now)` counts the seconds down.

```
ask ──claim──▶ claimed ──candidates──▶ veto ──(90 s pass)──▶ pick(default) ──▶ assigned ──brief──▶ returned
 │                │                      ├──veto(employee)──▶ assigned (pickedBy brett)
 │                │                      └──veto(blank)─────▶ declined
 └──pick(brett)───┴──────────────────────────────────────────▶ assigned (pickedBy brett)
```

A new `ask` may follow `assigned`, `returned` or `declined` (it resets the flow and keeps the briefs); it is refused while
an ask is claimed or in its veto window.

## Merging (two sessions, the live publish, the git merge driver)

`mergeAssignment(a, b)` (used by `framework/plan/builds-merge-core.mjs` on builds and on steps): the record changed later
wins its fields; `briefs` and `messages` are the union; an employee is never blanked by a copy that has none, unless that
copy declined. The column follows the same rule.

## Surfaces (later phases; the contract is the same on all four)

The group chat (agent-swarm plugin) posts and shows the lines; the dialog opens on the `candidates` line with its
countdown; the orchestrator table shows `assignedEmployee` and the record. Every action is a payload, so REST, MCP, the
CLI and AmberX voice post the same thing: `ask`, `claim`, `candidates`, `veto`, `pick`, `brief`; the record is read by
build / step id. Deep link target: the chat line's `jobId`. Nothing here needs a UI to run.
