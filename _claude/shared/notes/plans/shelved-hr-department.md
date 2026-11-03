# SHELVED: Breakroom HR department (Brett, Nov 1 2026 ~2:35 AM ET)

Brett said: shelve the plan, we'll finish it later. All four builds were stopped with vps.build_stop. Their worktrees, briefs and any partial work stay on the VPS (nothing pushed, nothing deleted):

1. swarm-hr - /root/axf-builds/swarm-hr/.brief.md (branch claude/swarm-hr). 40+ fun HR rules as hr-rule@1 assets, evaluated in code (0 LLM tokens), discipline ladder (warning -> write-up -> probation -> final -> fired), layoffs with severance, Ghostbuster violation for broken hooks, employee of the week, raises/bonuses/promotions, exit-interview roasts, HR bot memos, hall of fame/shame, Boss one-tap overrule. Agents only get one short line when their HR status is active.
2. swarm-raises - /root/axf-builds/swarm-raises/.brief.md. Agents demand raises when they earn it; case built from their stats; Boss Approve/Counter/Deny; sulk, ask again, threaten to quit to a competitor; comes out of the weekly budget; auto mode.
3. school-loans - /root/axf-builds/school-loans/.brief.md (v3; replaces swarm-school + agent-school). Agent school: a course = lessons card built from the agent's own failures (max ~300 tokens, loaded only on matching tasks), course@1 assets, graduation exam, diploma + specialty + raise. Money: company pays HALF, the other half is a student loan repaid from salary. Agents IN DEBT CANNOT BE FIRED, LAID OFF OR QUIT: 'Working it off' (grunt work, extra garnishment, no raises) until paid, then the firing runs ('Paid in full. Now get out.') unless they cleaned up. Only Boss can forgive or pay off.
4. hr-panel - /root/axf-builds/hr-panel/.brief.md. One HR Control Panel (Breakroom > HR): dashboard, employees, cases, raises, school, loans, payroll, hiring, handbook (rules editable as assets), settings, audit log; one-tap boss actions + bulk.

Order to resume: swarm-hr -> swarm-raises -> school-loans -> hr-panel (each brief already waits for the ones before it). Resume = vps.build_start with a new name (folders exist) and the same brief, or delete the old folders first.

Tone rules: Amber-style, work-only roasts; no identity jokes, no slurs, no sexual stuff.