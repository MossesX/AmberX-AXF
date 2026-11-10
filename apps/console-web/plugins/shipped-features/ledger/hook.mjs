/**
 * build-hook@1 listener (plugin.json "buildHooks"): every builds store write lands here right away, so planned
 * features show up the moment a build is created, and their statuses follow the build.
 */
import { openDb } from './db.mjs';
import { applyEvents } from './apply.mjs';

export function onBuildEvents(events) { return { applied: applyEvents(openDb(), events) }; }
export default onBuildEvents;
