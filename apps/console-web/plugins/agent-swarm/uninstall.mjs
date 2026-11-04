#!/usr/bin/env node
/**
 * Uninstaller (plugin-lifecycle@1). --data (default): data folder + state. --all: + this folder + marked doc lines.
 * --publish (with --all) commits and pushes the removal. --dry-run, --no-backup, --json.
 * Also removes the hub's read-only chat mirror (<hub data>/agent-swarm/chats/, see swarm.mjs chatsDir()).
 */
import { existsSync, rmSync } from 'node:fs';
import { main } from '../../../../framework/cli/plugin-lifecycle.mjs';
import { chatsDir } from './swarm.mjs';

const argv = process.argv.slice(2);
await main(['uninstall', ...argv], 'agent-swarm');
const mirror = chatsDir();
if (mirror && existsSync(mirror) && !argv.includes('--dry-run')) rmSync(mirror, { recursive: true, force: true });
