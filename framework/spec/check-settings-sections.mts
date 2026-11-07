/**
 * The ungrouped-settings rule (framework/cli/check-settings-sections.mjs): its scanner against sources it must flag and
 * sources it must pass, and FoldPanel's pure helpers. `npx -y tsx framework/spec/check-settings-sections.mts`
 */
import { scan, standardSections, MAX_GROUP } from '../cli/check-settings-sections.mjs';
import { SETTINGS_SECTIONS } from '../core/engines/settingsui';

let bad = 0;
const ok = (name: string, cond: boolean, got?: unknown) => { if (!cond) { bad++; console.error(`FAIL ${name}`, got ?? ''); } };
const ids = (src: string) => scan(src).map((x) => `${x.kind}:${x.id}:${x.section ?? '-'}`);

ok('panel with no section is found', ids(`const p = { settingsPanels: [{ id: 'a', tab: 't', title: 'A', render: () => null }] };`).join() === 'panel:a:-');
ok('panel with a section passes', ids(`const p = { settingsPanels: [{ id: 'a', section: 'look', tab: 't', title: 'A', render: () => null }] };`).join() === 'panel:a:look');
ok('group with no section is found, its settings are not', ids(`const l = { settings: [{ id: 'g', label: 'G', settings: [{ key: 'k', label: 'K', kind: 'toggle' }] }] };`).join() === 'group:g:-');
ok('group in a constant is found', ids(`const G: SettingsGroup = { id: 'g', label: 'G', settings: [{ key: 'k', label: 'K', kind: 'toggle' }] };`).join() === 'group:g:-');
ok('a wrapper over entries is left alone', ids(`rt.settings.addGroup({ module: l.id, ...g }); const x = { settingsPanels: lib.settingsPanels.map((p) => ({ ...p, render: () => 1 })) };`).length === 0);
ok('a list named in a .map is followed', ids(`const panels: { id: string }[] = [{ id: 'a', title: 'A', render: () => null }]; const l = { settingsPanels: panels.map((p) => ({ ...p, tab: 't' })) };`).join() === 'panel:a:-');
ok('an expression section counts', ids(`const p = { settingsPanels: [...G.map((g) => ({ id: g.id, section: S[g.id], tab: 't', title: 'x', render: () => 1 }))] };`).length > 0);
ok('addGroup literal is found', ids(`rt.settings.addGroup({ id: 'g', label: 'G', settings: [] });`).join() === 'group:g:-');
ok('specs are counted', scan(`const l = { settings: [{ id: 'g', label: 'G', settings: [{ key: 'a' }, { key: 'b' }] }] };`)[0]?.specs === 2);
ok('group cap is sane', MAX_GROUP >= 8);
const std = standardSections();
ok('the CLI reads every standard section', SETTINGS_SECTIONS.every((s) => std.has(s.id)) && std.size === SETTINGS_SECTIONS.length, [...std]);
ok('standard ids are unique', new Set(SETTINGS_SECTIONS.map((s) => s.id)).size === SETTINGS_SECTIONS.length);

if (bad) process.exit(1);
console.log('settings sections rule: ok');
