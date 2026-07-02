#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'ci']],
];

for (const [command, args] of commands) {
  execFileSync(command, args, { stdio: 'inherit' });
}
