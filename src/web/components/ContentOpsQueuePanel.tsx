import { Clipboard, Crosshair, Database, HardDrive, Search } from 'lucide-react';
import type { ContentOpsQueueItem, ContentOpsQueueLane, ContentOpsQueueSnapshot, ContentPost } from '../../shared/types';

function agentNextCommand(project: string): string {
  return `npm --silent run studio:cli -- agent next --project ${project}`;
}

interface ContentOpsQueuePanelProps {
  onCopy: (text: string, label: string) => Promise<void>;
  onFocusPost: (post: ContentPost) => Promise<void>;
  queue: ContentOpsQueueSnapshot | null;
}

export function ContentOpsQueuePanel({ onCopy, onFocusPost, queue }: ContentOpsQueuePanelProps) {
  if (!queue) return null;
  const nextAgentCommand = agentNextCommand(queue.project);
  return (
    <section className="content-queue">
      <header>
        <div>
          <h3><Crosshair size={16} />Content ops queue</h3>
          <p>{queue.totals.posts} posts · {queue.totals.lanes.needs_asset} need assets · {queue.totals.lanes.in_review} in review</p>
        </div>
        <button className="secondary-button" onClick={() => void onCopy(queue.handoff.inspectQueueCommand, 'content queue inspect command')} type="button">
          <Clipboard size={15} />Copy queue
        </button>
        <button className="secondary-button" onClick={() => void onCopy(nextAgentCommand, 'agent next command')} type="button">
          <Clipboard size={15} />Copy agent next
        </button>
      </header>
      <div className="queue-storage">
        <span><HardDrive size={14} />{queue.totals.storage.local} local</span>
        <span><Database size={14} />{queue.totals.storage.s3} S3</span>
        <span>{queue.totals.storage.unresolved} unresolved</span>
        <code>{nextAgentCommand}</code>
      </div>
      {queue.next_action && (
        <div className="queue-next-action">
          <div>
            <span>Next action</span>
            <strong>{queue.next_action.post.title}</strong>
            <code>{queue.next_action.post.channel} · {queue.next_action.readiness}</code>
          </div>
          <div className="queue-item-actions">
            <button aria-label={`Focus next action ${queue.next_action.post.id}`} onClick={() => void onFocusPost(queue.next_action!.post)} type="button"><Search size={14} />Focus</button>
            <button aria-label={`Copy next action ${queue.next_action.post.id} handoff`} onClick={() => void onCopy(handoffText(queue.next_action!), 'content queue next action handoff')} type="button"><Clipboard size={14} />Copy</button>
          </div>
        </div>
      )}
      <div className="queue-lanes">
        {queue.lanes.map(lane => (
          <article className="queue-lane" data-lane-id={lane.id} key={lane.id}>
            <header>
              <div className="queue-lane-title"><strong>{lane.label}</strong><span>{lane.total}</span></div>
              {lane.items.length > 0 && (
                <div className="queue-lane-actions">
                  <button aria-label={`Focus ${lane.label} lane`} onClick={() => void onFocusPost(lane.items[0].post)} type="button"><Search size={13} />Focus first</button>
                  <button aria-label={`Copy ${lane.label} lane handoff`} onClick={() => void onCopy(laneHandoffText(lane, queue.handoff.inspectQueueCommand), 'content queue lane handoff')} type="button"><Clipboard size={13} />Copy lane</button>
                </div>
              )}
            </header>
            <div className="queue-items">
              {lane.items.map(item => (
                <QueueItemCard item={item} key={`${lane.id}-${item.post.id}`} onCopy={onCopy} onFocusPost={onFocusPost} />
              ))}
              {lane.items.length === 0 && <p className="queue-empty">Empty</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function QueueItemCard({ item, onCopy, onFocusPost }: {
  item: ContentOpsQueueItem;
  onCopy: ContentOpsQueuePanelProps['onCopy'];
  onFocusPost: ContentOpsQueuePanelProps['onFocusPost'];
}) {
  const handoff = handoffText(item);
  return (
    <div className={item.is_target ? 'queue-item is-target' : 'queue-item'} data-post-id={item.post.id}>
      <div>
        <strong>{item.post.title}</strong>
        <code>{item.post.channel} · {item.readiness}</code>
      </div>
      <div className="queue-item-meta">
        <span>{item.attached_asset_count} asset{item.attached_asset_count === 1 ? '' : 's'}</span>
        <span>{storageLabel(item)}</span>
        {item.backup_cue && <span className={item.backup_cue.local_only > 0 ? 'queue-backup-cue local-only' : 'queue-backup-cue'}>{item.backup_cue.label}</span>}
      </div>
      <div className="queue-item-actions">
        <button aria-label={`Focus ${item.post.id}`} onClick={() => void onFocusPost(item.post)} type="button"><Search size={14} />Focus</button>
        {handoff && <button aria-label={`Copy ${item.post.id} handoff`} onClick={() => void onCopy(handoff, 'content queue item handoff')} type="button"><Clipboard size={14} />Copy</button>}
      </div>
    </div>
  );
}

function storageLabel(item: ContentOpsQueueItem): string {
  const storage = item.asset_storage;
  if (storage.total === 0) return 'no storage';
  return [
    storage.local > 0 ? `${storage.local} local` : '',
    storage.s3 > 0 ? `${storage.s3} S3` : '',
    storage.unresolved > 0 ? `${storage.unresolved} unresolved` : '',
  ].filter(Boolean).join(' · ');
}

function handoffText(item: ContentOpsQueueItem): string {
  if (!item.handoff) return '';
  return [
    `Content queue item: ${item.post.title}`,
    `Post: ${item.post.id}`,
    `Readiness: ${item.readiness}`,
    `Storage: ${storageLabel(item)}`,
    item.backup_cue ? `Backup cue: ${item.backup_cue.label}` : '',
    '',
    item.handoff.agentPrompt,
    agentNextCommand(item.post.project),
    item.handoff.inspectBatchCommand,
    item.backup_cue?.local_queue_command,
    item.backup_cue?.local_review_command,
    item.backup_cue?.local_backup_command,
    item.handoff.setTargetTemplate,
    item.handoff.attachAssetTemplate,
    item.handoff.moveToReviewCommand,
    item.handoff.scheduleTemplate,
    item.handoff.markPostedTemplate,
  ].filter(Boolean).join('\n');
}

function laneHandoffText(lane: ContentOpsQueueLane, inspectQueueCommand: string): string {
  const first = lane.items[0];
  return [
    `Content queue lane: ${lane.label}`,
    `Readiness: ${lane.id}`,
    `Items: ${lane.total}`,
    '',
    ...lane.items.slice(0, 6).map(item => `- ${item.post.id}: ${item.post.title} (${item.post.channel} · ${item.post.phase} · ${storageLabel(item)})`),
    lane.total > 6 ? `- ${lane.total - 6} more item${lane.total - 6 === 1 ? '' : 's'}` : '',
    '',
    first?.handoff?.agentPrompt,
    first ? agentNextCommand(first.post.project) : '',
    inspectQueueCommand,
    first?.handoff?.inspectBatchCommand,
    first?.backup_cue?.local_queue_command,
    first?.backup_cue?.local_review_command,
    first?.backup_cue?.local_backup_command,
    first?.handoff?.setTargetTemplate,
    first?.handoff?.attachAssetTemplate,
    first?.handoff?.moveToReviewCommand,
  ].filter(Boolean).join('\n');
}
