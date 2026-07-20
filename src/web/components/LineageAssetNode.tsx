import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { LineageNode, LineageTask } from '../../shared/types';
import { storageStateFor } from '../assetUi';
import { hoverPreviewPosition, type HoverPreviewPosition } from './lineageHoverPreview';

export type LineageFocusRole = 'active' | 'child' | 'none' | 'parent';

export type LineagePreviewSource = 'focus' | 'hover';

type AssetNodeData = LineageNode & {
  active: boolean;
  focusRole: LineageFocusRole;
  hoverPreviewsEnabled?: boolean;
  onOpenDetail?: (assetId: string) => void;
  onOpenHistory?: (assetId: string) => void;
  onPreviewChange?: (source: LineagePreviewSource, assetId: string, position: HoverPreviewPosition | null) => void;
  onPreviewDismiss?: () => void;
  onToggleBranch?: (node: LineageNode) => void;
  onToggleReroll?: (node: LineageNode) => void;
  root: boolean;
  sourcePosition: Position;
  targetPosition: Position;
} & Record<string, unknown>;
export type AssetFlowNode = Node<AssetNodeData, 'assetNode'>;

export function AssetNode({ data }: NodeProps<AssetFlowNode>) {
  const storage = storageStateFor({ hasLocal: Boolean(data.local_path), hasS3: Boolean(data.s3_key) });
  const taskBadges = lineageTaskBadges(data.lineage_tasks);
  const openFromNode = () => {
    data.onPreviewDismiss?.();
    if ((data.attempt_count || 1) > 1) data.onOpenHistory?.(data.asset_id);
    else data.onOpenDetail?.(data.asset_id);
  };
  const showPreview = (source: LineagePreviewSource, element: HTMLElement) => {
    data.onPreviewChange?.(source, data.asset_id, hoverPreviewPosition(element.getBoundingClientRect(), window.innerWidth, window.innerHeight));
  };
  return (
    <div
        aria-label={`${data.title} ${((data.attempt_count || 1) > 1) ? 'attempt history' : 'details'}`}
        className={`lineage-node ${data.root ? 'root-node' : ''} ${data.active ? 'active' : ''} ${data.user_selected ? 'selected' : ''} ${data.is_latest ? 'latest' : ''} focus-${data.focusRole}`}
        data-focus-role={data.focusRole}
        data-lineage-root={data.root ? 'true' : undefined}
        onBlur={data.hoverPreviewsEnabled ? () => data.onPreviewChange?.('focus', data.asset_id, null) : undefined}
        onDoubleClick={event => {
          event.stopPropagation();
          openFromNode();
        }}
        onFocus={data.hoverPreviewsEnabled ? event => showPreview('focus', event.currentTarget) : undefined}
        onKeyDown={event => {
          const key = event.key.toLowerCase();
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'b') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleBranch?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'r') {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleReroll?.(data);
            return;
          }
          if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && key === 'd') {
            event.preventDefault();
            event.stopPropagation();
            data.onPreviewDismiss?.();
            data.onOpenDetail?.(data.asset_id);
            return;
          }
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          event.stopPropagation();
          openFromNode();
        }}
        onMouseEnter={data.hoverPreviewsEnabled ? event => showPreview('hover', event.currentTarget) : undefined}
        onMouseLeave={data.hoverPreviewsEnabled ? () => data.onPreviewChange?.('hover', data.asset_id, null) : undefined}
        role="button"
        tabIndex={0}
        title={data.hoverPreviewsEnabled
          ? ((data.attempt_count || 1) > 1 ? 'Hover to preview; double-click to open attempt history; drag to reposition' : 'Hover to preview; double-click to open detail; drag to reposition')
          : ((data.attempt_count || 1) > 1 ? 'Double-click to open attempt history; drag to reposition' : 'Double-click to open detail; drag to reposition')}
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
          {(data.attempt_count || 1) > 1 && <span className="attempt-stack">v{data.attempt_count}</span>}
          {taskBadges.map(task => (
            <span className={`lineage-task-badge ${task.task_type} ${task.status === 'pending' ? 'pending' : 'locked'}`} key={task.id}>
              {task.task_type} {task.status === 'pending' ? 'pending' : 'locked'}
            </span>
          ))}
          {data.reroll_request?.status === 'pending' && !data.lineage_tasks?.reroll && <span className="reroll">re-roll</span>}
        </div>
        <span aria-hidden="true" className="lineage-node-hint">{data.hoverPreviewsEnabled ? 'Hover to preview' : 'Double-click for details'}</span>
    </div>
  );
}

function lineageTaskBadges(tasks: LineageNode['lineage_tasks']): LineageTask[] {
  return (['iterate', 'reroll'] as const)
    .map(taskType => tasks?.[taskType])
    .filter((task): task is LineageTask => Boolean(task && ['pending', 'claimed', 'in_progress'].includes(task.status)));
}
