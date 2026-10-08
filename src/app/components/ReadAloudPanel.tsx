import type { RefObject } from 'react';

export function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="read-aloud-icon" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4 6 8H3v8h3l5 4V4Z" />
      <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

interface ReadAloudPanelProps {
  open: boolean;
  isPlaying: boolean;
  supported: boolean;
  rate: number;
  error: string | null;
  panelRef: RefObject<HTMLElement>;
  onToggle: () => void;
  onRateChange: (rate: number) => void;
}

export function ReadAloudPanel({ open, isPlaying, supported, rate, error, panelRef, onToggle, onRateChange }: ReadAloudPanelProps) {
  return (
    <aside ref={panelRef} id="read-aloud-panel" className={`settings-panel read-aloud-panel ${open ? 'open' : ''}`}
      aria-label="Read aloud controls" hidden={!open}>
      <div className="settings-panel-inner">
        <div className="read-aloud-heading">
          <span>Read aloud</span>
          <button type="button" className="read-aloud-toggle" onClick={onToggle} disabled={!supported}
            aria-label={isPlaying ? 'Pause reading' : 'Play reading'}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
              {isPlaying ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m7 4 14 8-14 8z" />}
            </svg>
          </button>
        </div>
        <label className="settings-group">
          <span className="read-aloud-speed-label">Speed <output>{rate.toFixed(2).replace(/0$/, '')}×</output></span>
          <input type="range" min="0.5" max="2" step="0.25" value={rate}
            aria-label="Reading speed" onChange={(event) => onRateChange(Number(event.target.value))} />
        </label>
        {!supported ? <p role="status" className="read-aloud-error">Reading aloud is not supported in this browser.</p> : null}
        {error ? <p role="alert" className="read-aloud-error">{error}</p> : null}
      </div>
    </aside>
  );
}
