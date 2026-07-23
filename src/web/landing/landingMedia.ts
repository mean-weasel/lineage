import agentSharedStatePoster from './media/agent-shared-state.webp';
import agentToCanvasVideo from './media/agent-to-canvas.mp4';
import attemptHistoryPoster from './media/attempt-history.webp';
import branchingTreeImage from './media/branching-tree.png';
import canvasCliPoster from './media/canvas-cli.png';
import heroAgentSyncPoster from './media/hero-agent-sync-poster.png';
import heroAgentSyncVideo from './media/hero-agent-sync.mp4';
import heroBoardPoster from './media/hero-board.webp';
import heroLineageGrowthVideo from './media/hero-lineage-growth.mp4';
import heroTraceConnectionsVideo from './media/hero-trace-connections.mp4';
import humanSelectionImage from './media/human-selection.webp';
import humanToAgentVideo from './media/human-to-agent.mp4';
import rerollHistoryVideo from './media/reroll-history.mp4';

type LandingMediaId =
  | 'hero-lineage-growth'
  | 'hero-trace-connections'
  | 'hero-agent-sync'
  | 'human-to-agent'
  | 'agent-to-canvas'
  | 'trace-tree'
  | 'selection-still'
  | 'reroll-history';

type SupportingMediaId = Exclude<LandingMediaId,
  | 'hero-lineage-growth'
  | 'hero-trace-connections'
  | 'hero-agent-sync'>;

export interface LandingMediaDefinition {
  id: LandingMediaId;
  eyebrow: string;
  title: string;
  description: string;
  kind: 'image' | 'video';
  src: string;
  poster?: string;
  fit?: 'contain' | 'cover';
  position?: 'center' | 'left';
}

export const heroCarousel: LandingMediaDefinition[] = [
  {
    id: 'hero-lineage-growth',
    eyebrow: 'From agent to canvas',
    title: 'Turn agent output into visual creative history.',
    description: 'Every new asset joins the lineage instead of disappearing into a chat.',
    kind: 'video',
    src: heroLineageGrowthVideo,
    poster: heroBoardPoster,
    fit: 'contain',
  },
  {
    id: 'hero-trace-connections',
    eyebrow: 'Context stays connected',
    title: 'Keep the reasoning behind the visual work.',
    description: 'Prompts, branches, and decisions remain attached to every result.',
    kind: 'video',
    src: heroTraceConnectionsVideo,
    poster: branchingTreeImage,
    fit: 'contain',
  },
  {
    id: 'hero-agent-sync',
    eyebrow: 'One shared creative state',
    title: 'Humans and agents continue from the same place.',
    description: 'New agent work returns to the canvas, ready for the next decision.',
    kind: 'video',
    src: heroAgentSyncVideo,
    poster: heroAgentSyncPoster,
    fit: 'contain',
  },
];

export const landingMedia: Record<SupportingMediaId, LandingMediaDefinition> = {
  'human-to-agent': {
    id: 'human-to-agent',
    eyebrow: 'Human → agent',
    title: 'Send the exact creative context to Codex.',
    description: 'A canvas selection becomes actionable agent context.',
    kind: 'video',
    src: humanToAgentVideo,
    poster: canvasCliPoster,
    fit: 'contain',
  },
  'agent-to-canvas': {
    id: 'agent-to-canvas',
    eyebrow: 'Agent → canvas',
    title: 'Bring agent results back into the shared state.',
    description: 'New agent output returns to the same visual workspace.',
    kind: 'video',
    src: agentToCanvasVideo,
    poster: agentSharedStatePoster,
    fit: 'contain',
  },
  'trace-tree': {
    id: 'trace-tree',
    eyebrow: 'Lineage graph',
    title: 'Every branch remains visible.',
    description: 'The graph preserves the path from source to variation.',
    kind: 'image',
    src: branchingTreeImage,
    fit: 'cover',
  },
  'selection-still': {
    id: 'selection-still',
    eyebrow: 'Selection + direction',
    title: 'Choose exactly where the work continues.',
    description: 'Inspect, select, and turn the decision into precise context.',
    kind: 'image',
    src: humanSelectionImage,
    fit: 'cover',
    position: 'left',
  },
  'reroll-history': {
    id: 'reroll-history',
    eyebrow: 'Attempt history',
    title: 'Ask for another pass without losing the first.',
    description: 'The new attempt returns without replacing earlier work.',
    kind: 'video',
    src: rerollHistoryVideo,
    poster: attemptHistoryPoster,
    fit: 'cover',
  },
};
