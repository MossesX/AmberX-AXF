/**
 * axHub status badge, pure part: red unless settings come live from axHub, green only while they do.
 *
 *   npx -y tsx framework/spec/check-hubstatus.mts
 */
import { DEFAULT_LOOK, changeNote, clampEvery, clampSeconds, hubLive, probeFrom, settingsUrl, statusAsset } from '../libs/hubstatus/core';

let ok = 0, fail = 0;
const check = (cond: unknown, msg: string) => { if (cond) ok++; else { fail++; console.log(`✗ ${msg}`); } };
const HUB = 'https://axhub.amberxai.com';
const T = 1_000_000;
const good = probeFrom(200, T, 40, HUB, '', '"v3"');

// starts red
check(hubLive(null, null, T, 65_000).live === 'checking', 'no read yet = checking');
check(statusAsset(hubLive(null, null, T, 65_000)).data.offTone === 'danger', 'checking is red');
// live only after a live read
check(hubLive(good, null, T + 1000, 65_000).live === 'live', 'a fresh 200 = live');
check(hubLive(probeFrom(404, T, 40, HUB), null, T, 65_000).live === 'live', '404 (nothing saved yet) still comes from the hub = live');
check(good.version === '"v3"', 'the version is kept');
// red when not live
check(hubLive(good, null, T + 70_000, 65_000).live === 'not-live', 'a read older than the stale time = not live');
for (const s of [0, 401, 403, 500, 302]) check(hubLive(probeFrom(s, T, 1, HUB), null, T, 65_000).live === 'not-live', `HTTP ${s} = not live`);
check(probeFrom(401, T, 1, HUB).reason.includes('Not signed in'), '401 says signed out');
check(probeFrom(0, T, 1, HUB, 'boom').reason.includes('axhub.amberxai.com'), 'a network failure names the hub');
// the app's own hub source must be ready
check(hubLive(good, { status: 'unreachable', reason: 'down' }, T, 65_000).live === 'not-live', 'source unreachable = not live even with a good read');
check(hubLive(good, { status: 'unauthorized' }, T, 65_000).live === 'not-live', 'source unauthorized = not live');
check(hubLive(null, { status: 'connecting' }, T, 65_000).live === 'checking', 'source connecting, no read = checking');
check(hubLive(good, { status: 'connecting' }, T, 65_000).live === 'not-live', 'source connecting after a read = not live');
check(hubLive(good, { status: 'ready' }, T, 65_000).live === 'live', 'source ready + fresh read = live');
// the badge
const live = statusAsset({ live: 'live', why: '' });
check(live.type === 'status' && live.id === 'axhub' && live.data.counter === 'hub.live', 'the badge is the status widget status/axhub on hub.live');
check(live.data.onTone === 'success' && live.data.offTone === 'danger', 'green on, red off');
check(statusAsset({ live: 'checking', why: '' }).data.offLabel === 'axHub …', 'checking has its own words');
check(statusAsset({ live: 'not-live', why: '' }, { liveLabel: 'Hub', notLiveLabel: 'No hub', checkingLabel: '…', dot: false }).data.offLabel === 'No hub', 'custom words');
// pop-ups
check(changeNote(null, 'live') === null, 'the first live answer stays quiet');
check(changeNote('checking', 'not-live') !== null, 'going red pops up');
check(changeNote('not-live', 'live')?.includes('back') === true, 'coming back pops up');
check(changeNote('live', 'live') === null, 'no change, no pop-up');
// limits
check(clampEvery(1) === 10 && clampEvery(9999) === 600 && clampEvery('x') === 30, 'check period 10 s – 10 min');
check(clampSeconds(0) === 1 && clampSeconds(99) === 60, 'pop-up 1 – 60 s');
check(settingsUrl(HUB + '/x') === `${HUB}/data/shared/settings/appearance.json`, 'reads the shared settings document');
const st2 = { mode: 'icons' as const, icon: 'hub', on: 'wifi', off: 'wifi-off@blink', onTone: 'accent' as const, offTone: 'warning' as const };
check(statusAsset({ live: 'live', why: '' }, { ...DEFAULT_LOOK, state: st2 }).data.icon === 'wifi', 'state look: live icon');
const offA = statusAsset({ live: 'not-live', why: '' }, { ...DEFAULT_LOOK, state: st2 }).data;
check(offA.icon === 'wifi-off@blink' && offA.offTone === 'warning' && offA.onTone === 'accent', 'state look: off icon + chosen colours');

console.log(`hubstatus: ${ok} passed, ${fail} failed`);
if (fail) process.exit(1);
