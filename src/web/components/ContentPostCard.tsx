import { CalendarClock, Clipboard, Eye, Flag, Link2, Send } from 'lucide-react';
import type { ContentPost, ContentPostPhase, GrowthAsset } from '../../shared/types';
import { assetStorageLabel } from './contentAssetLabels';

interface PostCardProps {
  attachAsset: () => Promise<void>;
  attachForm: { assetId: string; postId: string; role: string };
  assetLookup: Record<string, GrowthAsset>;
  checked: boolean;
  isTarget: boolean;
  onCopy: (text: string, label: string) => Promise<void>;
  onOpenAsset: (assetId: string) => void;
  onPreview: () => void;
  onSetTarget: () => Promise<void>;
  onToggleSelected: (checked: boolean) => void;
  phaseInputs: { phase: ContentPostPhase; scheduledAt: string; postedAt: string; url: string };
  post: ContentPost;
  selectedAsset?: GrowthAsset;
  setAttachForm: (value: { assetId: string; postId: string; role: string }) => void;
  setPhase: (post: ContentPost, phase: ContentPostPhase) => Promise<void>;
  setPhaseInputs: (value: { phase: ContentPostPhase; scheduledAt: string; postedAt: string; url: string }) => void;
}

export function ContentPostCard(props: PostCardProps) {
  const fallbackCommand = `npx lineage content post phase --project ${props.post.project} --post-id ${props.post.id} --phase scheduled --scheduled-at <iso> --confirm-write --json`;
  const handoffText = postHandoffText(props.post) || fallbackCommand;
  const hasAssets = props.post.assets.length > 0;
  return (
    <article className={`post-card phase-${props.post.phase} ${props.isTarget ? 'is-target' : ''}`}>
      <header>
        <label className="post-select">
          <input
            aria-label={`Select ${props.post.title}`}
            checked={props.checked}
            onChange={event => props.onToggleSelected(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>{props.post.title}</strong>
            <code>{props.post.id}</code>
          </span>
        </label>
        <div className="post-status">
          {props.isTarget && <b className="target-state">next target</b>}
          <span>{props.post.channel}: {props.post.phase}</span>
          {props.post.readiness && <b className="readiness-state">{readinessLabel(props.post.readiness)}</b>}
          <b className={hasAssets ? 'asset-state has-asset' : 'asset-state needs-asset'}>{hasAssets ? `${props.post.assets.length} asset${props.post.assets.length === 1 ? '' : 's'}` : 'needs asset'}</b>
        </div>
      </header>
      <div className="post-assets">
        {props.post.assets.map(asset => (
          <button className="asset-chip" key={`${asset.asset_id}-${asset.role}`} onClick={() => props.onOpenAsset(asset.asset_id)} type="button">
            {asset.role}: {asset.asset_id} · {assetStorageLabel(props.assetLookup[asset.asset_id])}
          </button>
        ))}
        {!hasAssets && <span className="muted-pill">no attached assets</span>}
      </div>
      <div className="phase-controls">
        <input
          aria-label={`Scheduled at for ${props.post.id}`}
          onChange={event => props.setPhaseInputs({ ...props.phaseInputs, scheduledAt: event.target.value })}
          type="datetime-local"
          value={props.phaseInputs.scheduledAt}
        />
        <input
          aria-label={`Posted URL for ${props.post.id}`}
          onChange={event => props.setPhaseInputs({ ...props.phaseInputs, url: event.target.value })}
          placeholder="Posted URL"
          value={props.phaseInputs.url}
        />
        <button onClick={() => void props.setPhase(props.post, 'review')} type="button"><Clipboard size={15} />Review</button>
        <button onClick={() => void props.setPhase(props.post, 'scheduled')} type="button"><CalendarClock size={15} />Schedule</button>
        <button onClick={() => void props.setPhase(props.post, 'posted')} type="button"><Send size={15} />Posted</button>
      </div>
      <div className="attach-row">
        <input
          aria-label={`Asset id for ${props.post.id}`}
          onChange={event => props.setAttachForm({ ...props.attachForm, assetId: event.target.value, postId: props.post.id })}
          placeholder={props.selectedAsset?.asset_id || 'asset-id'}
          value={props.attachForm.postId === props.post.id ? props.attachForm.assetId : ''}
        />
        <button onClick={() => void props.attachAsset()} type="button"><Link2 size={15} />Attach {props.selectedAsset ? 'selected' : 'asset'}</button>
        <button className={props.isTarget ? 'target-button active' : 'target-button'} onClick={() => void props.onSetTarget()} type="button">
          <Flag size={15} />{props.isTarget ? 'Selected' : 'Set next'}
        </button>
        <button className="text-button" onClick={props.onPreview} type="button"><Eye size={15} />Preview</button>
        <button className="text-button" onClick={() => void props.onCopy(handoffText, 'content post handoff')} type="button">Copy handoff</button>
      </div>
    </article>
  );
}

function postHandoffText(post: ContentPost): string {
  if (!post.handoff) return '';
  return [
    `Content post: ${post.title}`,
    `Project: ${post.project}`,
    `Batch: ${post.batch_id}`,
    `Channel: ${post.channel}`,
    `Post: ${post.id}`,
    `Readiness: ${post.readiness || 'unknown'}`,
    '',
    post.handoff.agentPrompt,
    post.handoff.inspectBatchCommand,
    post.handoff.setTargetTemplate,
    post.handoff.attachAssetTemplate,
    post.handoff.moveToReviewCommand,
    post.handoff.scheduleTemplate,
    post.handoff.markPostedTemplate,
  ].filter(Boolean).join('\n');
}

function readinessLabel(readiness: NonNullable<ContentPost['readiness']>): string {
  return readiness.replace(/_/g, ' ');
}
