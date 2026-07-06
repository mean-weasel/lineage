import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LineageNode } from '../../shared/types';
import { storageStateFor } from '../assetUi';

export type LineageFocusRole = 'active' | 'child' | 'none' | 'parent';

type AssetNodeData = LineageNode & {
  active: boolean;
  focusRole: LineageFocusRole;
  onOpenDetail?: (assetId: string) => void;
  root: boolean;
  sourcePosition: Position;
  targetPosition: Position;
} & Record<string, unknown>;
export type AssetFlowNode = Node<AssetNodeData, 'assetNode'>;

export function AssetNode({ data }: NodeProps<AssetFlowNode>) {
  const storage = storageStateFor({ hasLocal: Boolean(data.local_path), hasS3: Boolean(data.s3_key) });
  return (
    <div
      className={`lineage-node ${data.active ? 'active' : ''} ${data.user_selected ? 'selected' : ''} ${data.is_latest ? 'latest' : ''} focus-${data.focusRole}`}
      data-focus-role={data.focusRole}
      onDoubleClick={event => {
        event.stopPropagation();
        data.onOpenDetail?.(data.asset_id);
      }}
      title="Click to inspect; double-click to open detail; drag to reposition"
    >
      <Handle className="lineage-handle" isConnectable={false} position={data.targetPosition} type="target" />
      <Handle className="lineage-handle" isConnectable={false} position={data.sourcePosition} type="source" />
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
      </div>
      <span aria-hidden="true" className="lineage-node-hint">Click to inspect</span>
    </div>
  );
}
