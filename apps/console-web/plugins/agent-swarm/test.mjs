// Self-test: node apps/console-web/plugins/agent-swarm/test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as c from './web/swarm-core.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n += 1; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const here = (p) => new URL(p, import.meta.url);
const roster = c.normRoster(JSON.parse(readFileSync(here('./agents/roster.json'), 'utf8')));
const skills = Object.fromEntries(readdirSync(here('./agents/skills/')).filter((f) => f.endsWith('.md')).map((f) => { const s = c.parseSkill(readFileSync(here(`./agents/skills/${f}`), 'utf8')); return [s.id, s]; }));

// s1 roster + skills
t('roster and skills are valid', () => assert.deepEqual(c.checkRoster(roster, skills), []));
t('the eight specialist skills exist', () => assert.deepEqual(Object.keys(skills).sort(), ['assets-themes', 'docs', 'kotlin-compose', 'merge-fixer', 'plugin-manifests', 'python-server', 'react-ui', 'tests']));
t('every skill is under one page', () => { for (const s of Object.values(skills)) assert.ok(s.lines <= c.SKILL_MAX_LINES && s.chars <= c.SKILL_MAX_CHARS, s.id); });
t('models sort cheapest first', () => assert.deepEqual(c.normAgent({ id: 'x', models: ['opus', 'haiku', 'nope'] }).models, ['haiku', 'opus']));
t('bad roster is reported', () => { const r = c.normRoster({ agents: [{ id: 'A b', skill: 'none' }, { id: 'A b' }] }); const p = c.checkRoster(r, skills); assert.ok(p.some((x) => /lowercase/.test(x)) && p.some((x) => /twice/.test(x)) && p.some((x) => /no skill file/.test(x))); });
t('long skill is flagged', () => { const s = c.parseSkill(`---\n$axf: agent-skill@1\nid: big\n---\n${'line\n'.repeat(80)}`); assert.match(c.checkRoster({ agents: [] }, { big: s })[0], /one page/); });

console.log(`agent-swarm: ${n} checks passed`);
