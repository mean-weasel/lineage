import type { ContentPostPhase } from '../../shared/types';

const phases: ContentPostPhase[] = ['draft', 'review', 'scheduled', 'posted', 'skipped', 'archived'];
export type AssetFilter = 'all' | 'has-assets' | 'needs-assets';

export function ContentPostFilters({ channels, filters, filteredCount, needsAssetCount, selectedCount, setFilters, setPhase, totalCount }: {
  channels: string[];
  filters: { asset: AssetFilter; channel: string; phase: ContentPostPhase | 'all' };
  filteredCount: number;
  needsAssetCount: number;
  selectedCount: number;
  setFilters: (value: { asset: AssetFilter; channel: string; phase: ContentPostPhase | 'all' }) => void;
  setPhase: (phase: ContentPostPhase) => Promise<void>;
  totalCount: number;
}) {
  return (
    <div className="content-tools">
      <div className="filter-row">
        <select aria-label="Filter content phase" onChange={event => setFilters({ ...filters, phase: event.target.value as ContentPostPhase | 'all' })} value={filters.phase}>
          <option value="all">all phases</option>
          {phases.map(phase => <option key={phase} value={phase}>{phase}</option>)}
        </select>
        <select aria-label="Filter content channel" onChange={event => setFilters({ ...filters, channel: event.target.value })} value={filters.channel}>
          <option value="all">all channels</option>
          {channels.map(channel => <option key={channel} value={channel}>{channel}</option>)}
        </select>
        <select aria-label="Filter content asset state" onChange={event => setFilters({ ...filters, asset: event.target.value as AssetFilter })} value={filters.asset}>
          <option value="all">all asset states</option>
          <option value="needs-assets">needs asset</option>
          <option value="has-assets">has asset</option>
        </select>
        <span>{filteredCount}/{totalCount} posts · {needsAssetCount} need assets</span>
      </div>
      <div className="bulk-row">
        <span>{selectedCount} selected</span>
        {(['review', 'scheduled', 'posted'] as ContentPostPhase[]).map(phase => (
          <button disabled={selectedCount === 0} key={phase} onClick={() => void setPhase(phase)} type="button">{phase === 'review' ? 'Move to review' : `Mark ${phase}`}</button>
        ))}
      </div>
    </div>
  );
}
