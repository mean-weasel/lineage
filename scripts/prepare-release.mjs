#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'check']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'public:readiness']],
  ['npm', ['run', 'package:smoke']],
];

for (const [command, args] of commands) {
  execFileSync(command, args, { stdio: 'inherit' });
}
