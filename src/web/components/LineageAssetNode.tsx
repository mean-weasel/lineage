import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LineageNode } from '../../shared/types';
import { storageStateFor } from '../assetUi';

export type LineageFocusRole = 'active' | 'child' | 'none' | 'parent';

type AssetNodeData = LineageNode & {
  active: boolean;
  focusRole: LineageFocusRole;
  onOpenDetail?: (assetId: string) => void;
  onOpenHistory?: (assetId: string) => void;
  root: boolean;
} & Record<string, unknown>;
export type AssetFlowNode = Node<AssetNodeData, 'assetNode'>;

export function AssetNode({ data }: NodeProps<AssetFlowNode>) {
  const storage = storageStateFor({ hasLocal: Boolean(data.local_path), hasS3: Boolean(data.s3_key) });
  const openFromNode = () => {
    if ((data.attempt_count || 1) > 1) data.onOpenHistory?.(data.asset_id);
    else data.onOpenDetail?.(data.asset_id);
  };
  return (
    <div
      aria-label={`${data.title} ${((data.attempt_count || 1) > 1) ? 'attempt history' : 'details'}`}
      className={`lineage-node ${data.active ? 'active' : ''} ${data.user_selected ? 'selected' : ''} ${data.is_latest ? 'latest' : ''} focus-${data.focusRole}`}
      data-focus-role={data.focusRole}
      onDoubleClick={event => {
        event.stopPropagation();
        openFromNode();
      }}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        openFromNode();
      }}
      role="button"
      tabIndex={0}
      title={(data.attempt_count || 1) > 1 ? 'Click to inspect; double-click to open attempt history; drag to reposition' : 'Click to inspect; double-click to open detail; drag to reposition'}
    >
      <Handle className="lineage-handle" isConnectable={false} position={Position.Left} type="target" />
      <Handle className="lineage-handle" isConnectable={false} position={Position.Right} type="source" />
      <span aria-hidden="true" className="lineage-node-action">Details</span>
      <div className="lineage-thumb">
        {data.preview_url && (data.media_type === 'image' || data.media_type === 'gif') ? (
          <img src={data.preview_url} alt="" loading="lazy" />
        ) : data.preview_url && data.media_type === 'video' ? (
          <video src={data.preview_url} muted preload="metadata" />
        ) : (
          <span>{data.media_type}</span>
        )}
      </div>
      <strong>{data.title}</strong>
      <small>{data.asset_id}</small>
      <div className="lineage-badges">
        <span className={storage.kind}>{storage.label}</span>
        <span>{data.review_state}</span>
        {data.root && <span className="root">root</span>}
        {data.is_latest && <span className="latest">latest</span>}
        {data.user_selected && <span className="selected">next variation</span>}
        {(data.attempt_count || 1) > 1 && <span className="attempt-stack">v{data.attempt_count}</span>}
        {data.reroll_request?.status === 'pending' && <span className="reroll">re-roll</span>}
      </div>
      <span aria-hidden="true" className="lineage-node-hint">Click to inspect</span>
    </div>
  );
}
