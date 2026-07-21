import './LineageReplayControls.css';

export function LineageReplayControls({
  atEnd,
  onClose,
  onPlayPause,
  onRestart,
  onScrub,
  onSpeed,
  playing,
  speed,
  stageIndex,
  totalStages,
}: {
  atEnd: boolean;
  onClose: () => void;
  onPlayPause: () => void;
  onRestart: () => void;
  onScrub: (stageIndex: number) => void;
  onSpeed: (speed: number) => void;
  playing: boolean;
  speed: number;
  stageIndex: number;
  totalStages: number;
}) {
  const displayedStage = Math.max(0, stageIndex);
  const playLabel = playing ? 'Pause replay' : atEnd ? 'Replay from start' : 'Play replay';

  return (
    <section aria-label="Lineage growth replay" className="lineage-replay-controls" data-testid="lineage-replay-controls">
      <div className="lineage-replay-controls-head">
        <div>
          <strong>Replay growth</strong>
          <output aria-live="polite">Stage {displayedStage + 1} of {totalStages}</output>
        </div>
        <button className="lineage-replay-close" onClick={onClose} type="button">Return to live</button>
      </div>
      <label className="lineage-replay-scrubber">
        <span>Growth stage</span>
        <input
          aria-label="Replay stage"
          max={Math.max(0, totalStages - 1)}
          min={0}
          onChange={event => onScrub(Number(event.target.value))}
          step={1}
          type="range"
          value={displayedStage}
        />
      </label>
      <div className="lineage-replay-actions">
        <button aria-label={playLabel} onClick={onPlayPause} type="button">{playing ? 'Pause' : atEnd ? 'Replay' : 'Play'}</button>
        <button onClick={onRestart} type="button">Restart</button>
        <label>
          <span>Speed</span>
          <select aria-label="Replay speed" onChange={event => onSpeed(Number(event.target.value))} value={speed}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
    </section>
  );
}
