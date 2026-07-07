// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { AssetNode, type AssetFlowNode } from './LineageAssetNode';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe('AssetNode', () => {
  it('opens stacked attempt history from keyboard activation', () => {
    const onOpenHistory = vi.fn();
    const onOpenDetail = vi.fn();
    renderNode({ attempt_count: 3, onOpenDetail, onOpenHistory });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' })));

    expect(node.getAttribute('role')).toBe('button');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(onOpenHistory).toHaveBeenCalledTimes(2);
    expect(onOpenHistory).toHaveBeenCalledWith('local-node');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('opens detail from keyboard activation for a single-attempt node', () => {
    const onOpenHistory = vi.fn();
    const onOpenDetail = vi.fn();
    renderNode({ attempt_count: 1, onOpenDetail, onOpenHistory });
    const node = container!.querySelector<HTMLElement>('.lineage-node')!;

    act(() => node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));

    expect(onOpenDetail).toHaveBeenCalledWith('local-node');
    expect(onOpenHistory).not.toHaveBeenCalled();
  });
});

function renderNode(data: Partial<AssetFlowNode['data']>) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props = {
    data: {
      active: false,
      asset_id: 'local-node',
      attempt_count: 1,
      focusRole: 'none',
      is_latest: true,
      media_type: 'image',
      project: 'demo-project',
      review_state: 'unreviewed',
      root: false,
      source: 'local',
      status: 'planned',
      title: 'Swissifier node',
      user_selected: false,
      ...data,
    },
    dragging: false,
    id: 'local-node',
    isConnectable: false,
    selected: false,
    type: 'assetNode',
    xPos: 0,
    yPos: 0,
    zIndex: 0,
  } as unknown as NodeProps<AssetFlowNode>;
  act(() => {
    root!.render(
      <ReactFlowProvider>
        <AssetNode {...props} />
      </ReactFlowProvider>
    );
  });
}
