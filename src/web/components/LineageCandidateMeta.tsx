import type { LineageNode } from '../../shared/types';

export function CandidateMeta({ node }: { node: LineageNode }) {
  const items = [node.channel, node.status, node.review_state].filter(Boolean);
  return (
    <span className="lineage-candidate-meta">
      {items.map(item => <span key={item}>{item}</span>)}
    </span>
  );
}
