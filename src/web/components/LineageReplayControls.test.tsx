// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LineageReplayControls } from './LineageReplayControls';

let container: HTMLDivElement;
let root: Root;

describe('LineageReplayControls', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('exposes named playback, restart, speed, scrub, progress, and live-return controls', () => {
    const actions = {
      onClose: vi.fn(),
      onPlayPause: vi.fn(),
      onRestart: vi.fn(),
      onScrub: vi.fn(),
      onSpeed: vi.fn(),
    };
    render({ ...actions, atEnd: false, playing: true, speed: 1, stageIndex: 1, totalStages: 4 });

    expect(container.textContent).toContain('Stage 2 of 4');
    click('Pause replay');
    click('Restart');
    click('Return to live');

    const scrubber = container.querySelector<HTMLInputElement>('input[aria-label="Replay stage"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(scrubber, '3');
      scrubber.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const speed = container.querySelector<HTMLSelectElement>('select[aria-label="Replay speed"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(speed, '2');
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(actions.onPlayPause).toHaveBeenCalledOnce();
    expect(actions.onRestart).toHaveBeenCalledOnce();
    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(actions.onScrub).toHaveBeenCalledWith(3);
    expect(actions.onSpeed).toHaveBeenCalledWith(2);
  });

  it('labels the completed play action as replay from start', () => {
    render({
      atEnd: true,
      onClose: vi.fn(),
      onPlayPause: vi.fn(),
      onRestart: vi.fn(),
      onScrub: vi.fn(),
      onSpeed: vi.fn(),
      playing: false,
      speed: 1,
      stageIndex: 3,
      totalStages: 4,
    });

    expect(container.querySelector('button[aria-label="Replay from start"]')).not.toBeNull();
  });
});

function click(name: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
    || [...container.querySelectorAll<HTMLButtonElement>('button')].find(candidate => candidate.textContent === name);
  expect(button).toBeDefined();
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function render(props: Parameters<typeof LineageReplayControls>[0]) {
  act(() => root.render(<LineageReplayControls {...props} />));
}
