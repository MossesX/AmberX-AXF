#!/usr/bin/env node
// Toolbar widgets: the CLI maps every op to the console-control command the REST plan sends, refuses bad input with a
// usage error, and every voice phrase becomes a press on function:toolbar.widget whose value the action grammar
// (toolbar-widgets@1 parseToolbarWidgetArgs) reads back as the same toolbar, widget and op.
//   node apps/console-web/plugins/toolbar-widgets/test.mjs
import { toRequest, widgetCommand } from '../../../../framework/cli/toolbar-widgets.mjs';
import { intentCommand, voiceIntent } from '../../../../framework/core/engines/console-control-voice.mjs';
import { readFileSync } from 'node:fs';

let n = 0; let fails = 0;
const check = (name, ok, detail = '') => { n++; if (!ok) { fails++; console.error(`✗ ${name}${detail ? `\n  ${JSON.stringify(detail)}` : ''}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// CLI → REST shape
const req = (argv) => toRequest(argv);
check('list one toolbar = state on widget:all', eq(req(['list', 'app']), { method: 'GET', path: '/state?address=toolbar%3Aapp%2Fwidget%3Aall' }));
check('list every toolbar = widget targets', req(['list']).path === '/targets?kinds=widget&source=console');
check('attach', eq(req(['attach', 'settings-toolbar', 'status:cpu', '--side', 'start']).body, { verb: 'press', address: 'toolbar:settings-toolbar/widget:status:cpu', value: 'attach:start', by: 'cli' }));
check('detach without --confirm has no confirm', !('confirm' in req(['detach', 'app', 'status:cpu']).body));
check('detach --confirm presses the Detach button with confirm', eq(req(['detach', 'app', 'status:cpu', '--confirm']).body, { verb: 'press', address: 'toolbar:app/widget:status:cpu/button:detach', by: 'cli', confirm: true }));
check('move', req(['move', 'app', 'status:cpu', 'end', '2']).body.value === 'move:end:2');
check('style with no value = default', req(['style', 'app', 'status:cpu', 'size']).body.value === 'style:size:default');
check('open = the dialog deep link', eq(req(['open', 'gate.auto-lander']).body, { verb: 'open', address: 'toolbar:gate.auto-lander/widget:all', by: 'cli' }));
for (const bad of [['attach', 'app', 'cpu'], ['attach', 'app', 'status:cpu', '--side', 'middle'], ['move', 'app', 'status:cpu'], ['style', 'app', 'status:cpu', 'colour'], ['explode', 'app'], ['attach', 'Bad Toolbar!', 'status:cpu']]) {
  let threw = null; try { req(bad); } catch (e) { threw = e; }
  check(`refused: ${bad.join(' ')}`, threw && /^usage:/.test(threw.message), threw?.message);
}
check('widgetCommand passes to / reason', eq(widgetCommand('open', { toolbar: 'app', to: 'all', reason: 'look' }), { verb: 'open', address: 'toolbar:app/widget:all', to: 'all', reason: 'look' }));

// voice → the action grammar
const voice = JSON.parse(readFileSync(new URL('./voice.json', import.meta.url), 'utf8'));
check('voice.json lists the four intents', voice.commands.map((c) => c.id).join() === 'toolbar.widget.attach,toolbar.widget.detach,toolbar.widget.move,toolbar.widget.style');
const said = {
  'attach the CPU widget to the settings toolbar': 'settings:cpu:add',
  'add the clock to the main toolbar at the start': 'main:clock:start',
  'put the search bar at the start of the build toolbar': 'build:search bar:start',
  'detach the clock from the UI review toolbar': 'ui-review:clock:remove',
  'take the cpu off the settings toolbar': 'settings:cpu:remove',
  'make the clock on the main toolbar icon only': 'main:clock:icon',
  'move the search bar to the end of the build toolbar': 'build:search bar:end',
};
for (const [phrase, value] of Object.entries(said)) {
  const i = voiceIntent(phrase);
  const c = i && intentCommand(i);
  check(`voice "${phrase}"`, c && c.verb === 'press' && c.address === 'function:toolbar.widget' && c.value === value, c);
}
check('press … on the … toolbar is still a toolbar button', voiceIntent('press run now on the auto-lander toolbar')?.find?.kinds?.[0] === 'button');

console.log(`${fails ? '✗' : '✓'} toolbar-widgets: ${n - fails}/${n} checks passed`);
process.exit(fails ? 1 : 0);
