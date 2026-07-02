import { describe, expect, it } from 'vitest';
import { summarizeListenerOwnership } from '../../scripts/asset-studio-service-state.mjs';

describe('Asset Studio managed service ownership', () => {
  it('flags a healthy listener from another worktree as foreign', () => {
    const listener = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node    62484 neon   23u  IPv4 0x1      0t0  TCP 127.0.0.1:5176 (LISTEN)',
    ].join('\n');
    const openFiles = [
      'node 62484 neon cwd DIR 1,16 832 170519093 /Users/neon/.config/superpowers/worktrees/growth-ops/cloud-controls-settings-cleanup',
      'node 62484 neon 71u REG 1,16 421888 170613282 /Users/neon/.config/superpowers/worktrees/growth-ops/cloud-controls-settings-cleanup/.asset-studio/asset-lineage.sqlite',
    ].join('\n');

    expect(summarizeListenerOwnership({
      expectedRoot: '/Users/neon/Desktop/growth-ops',
      listener,
      openFiles,
    })).toEqual({
      cwd: '/Users/neon/.config/superpowers/worktrees/growth-ops/cloud-controls-settings-cleanup',
      expectedRoot: '/Users/neon/Desktop/growth-ops',
      matchesExpectedRoot: false,
      pid: '62484',
      state: 'foreign',
    });
  });

  it('accepts a listener whose cwd matches the current worktree', () => {
    const listener = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'node    71301 neon   25u  IPv4 0x1      0t0  TCP 127.0.0.1:5176 (LISTEN)',
    ].join('\n');
    const openFiles = 'node 71301 neon cwd DIR 1,16 832 170519093 /Users/neon/Desktop/growth-ops';

    expect(summarizeListenerOwnership({
      expectedRoot: '/Users/neon/Desktop/growth-ops',
      listener,
      openFiles,
    })).toMatchObject({
      cwd: '/Users/neon/Desktop/growth-ops',
      matchesExpectedRoot: true,
      pid: '71301',
      state: 'owned',
    });
  });
});
