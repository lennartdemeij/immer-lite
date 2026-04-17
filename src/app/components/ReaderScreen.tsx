import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CanonicalBook } from '../../types/book';
import type { ReaderPortion, ReaderSettings, ViewportMetrics } from '../../types/reader';
import { PortionView } from './PortionView';
import { SettingsPanel } from './SettingsPanel';

interface ReaderScreenProps {
  book: CanonicalBook;
  viewport: ViewportMetrics | null;
  portions: ReaderPortion[];
  portion: ReaderPortion | null;
  previousPortion: ReaderPortion | null;
  nextPortion: ReaderPortion | null;
  portionCount: number;
  portionIndex: number;
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  onFileSelected: (file: File) => void;
  onPrevious: () => void;
  onNext: () => void;
  onJumpToPortion: (index: number) => void;
  containerRef: React.Ref<HTMLDivElement>;
}

type SnapDirection = 'forward' | 'backward';

interface PointerState {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  startedOnInteractive: boolean;
}

const TAP_TOLERANCE = 10;
const SNAP_THRESHOLD_RATIO = 0.18;
const SNAP_THRESHOLD_PX = 84;
const SNAP_ANIMATION_MS = 240;
const CHAPTER_TRACK_PADDING_PX = 6;
const CHAPTER_TRACK_GAP_PX = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="settings-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.7 1.7 0 0 1 0 2.4 1.7 1.7 0 0 1-2.4 0l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19.5A1.7 1.7 0 0 1 13.8 21h-3.6a1.7 1.7 0 0 1-1.7-1.7v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a1.7 1.7 0 0 1-2.4 0 1.7 1.7 0 0 1 0-2.4l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4.5A1.7 1.7 0 0 1 3 12.8V11.2A1.7 1.7 0 0 1 4.5 9.5h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a1.7 1.7 0 0 1 0-2.4 1.7 1.7 0 0 1 2.4 0l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4.5A1.7 1.7 0 0 1 10.2 3h3.6a1.7 1.7 0 0 1 1.7 1.5v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.7 1.7 0 0 1 2.4 0 1.7 1.7 0 0 1 0 2.4l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2A1.7 1.7 0 0 1 21 11.2v1.6a1.7 1.7 0 0 1-1.5 1.7h-.2a1 1 0 0 0-.9.5Z" />
    </svg>
  );
}

export function ReaderScreen({
  book,
  viewport,
  portions,
  portion,
  previousPortion,
  nextPortion,
  portionCount,
  portionIndex,
  settings,
  onSettingsChange,
  onFileSelected,
  onPrevious,
  onNext,
  onJumpToPortion,
  containerRef
}: ReaderScreenProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [snapDirection, setSnapDirection] = useState<SnapDirection | null>(null);
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  const [progressTrackHeight, setProgressTrackHeight] = useState(0);
  const pointerState = useRef<PointerState | null>(null);
  const progressPointerIdRef = useRef<number | null>(null);
  const snapTimeoutRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

  function clearSnapTimeout() {
    if (snapTimeoutRef.current !== null) {
      window.clearTimeout(snapTimeoutRef.current);
      snapTimeoutRef.current = null;
    }
  }

  function animateBackToRest() {
    clearSnapTimeout();
    setTransitionEnabled(true);
    setSnapDirection(null);
    setDragOffset(0);
    setIsDragging(false);
    snapTimeoutRef.current = window.setTimeout(() => {
      setTransitionEnabled(false);
      clearSnapTimeout();
    }, SNAP_ANIMATION_MS);
  }

  function animateToNeighbor(direction: SnapDirection) {
    const stageHeight = stageRef.current?.clientHeight ?? 0;
    if (stageHeight <= 0) {
      if (direction === 'forward') {
        onNext();
      } else {
        onPrevious();
      }
      return;
    }

    setTransitionEnabled(true);
    setIsDragging(false);
    setSnapDirection(direction);
    setDragOffset(direction === 'forward' ? -stageHeight : stageHeight);
  }

  function navigateByTap(clientY: number) {
    if (clientY >= 0 && nextPortion) {
      animateToNeighbor('forward');
    }
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isDragging || snapDirection) {
        return;
      }

      if (
        event.key === 'ArrowDown' ||
        event.key === 'PageDown' ||
        event.key === ' '
      ) {
        event.preventDefault();
        if (nextPortion) {
          animateToNeighbor('forward');
        }
      }

      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault();
        if (previousPortion) {
          animateToNeighbor('backward');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDragging, nextPortion, onNext, onPrevious, previousPortion, snapDirection]);

  useEffect(() => {
    return () => clearSnapTimeout();
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (settingsPanelRef.current?.contains(target)) {
        return;
      }

      if (settingsButtonRef.current?.contains(target)) {
        return;
      }

      setSettingsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!portion) {
      return;
    }

    setTransitionEnabled(false);
    setDragOffset(0);
    setIsDragging(false);
    setSnapDirection(null);
  }, [portion?.id]);

  const chapterSegments = useMemo(() => {
    const spans = new Map<string, { start: number; end: number }>();
    portions.forEach((readerPortion, index) => {
      const existing = spans.get(readerPortion.sectionId);
      if (existing) {
        existing.end = index;
        return;
      }
      spans.set(readerPortion.sectionId, { start: index, end: index });
    });

    return book.sections
      .map((section) => {
        const span = spans.get(section.id);
        if (!span) {
          return null;
        }

        return {
          sectionId: section.id,
          sectionIndex: section.index,
          label: section.label,
          start: span.start,
          end: span.end,
          portionCount: span.end - span.start + 1
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));
  }, [book.sections, portions]);
  useEffect(() => {
    const node = progressTrackRef.current;
    if (!node) {
      return;
    }

    const update = () => {
      setProgressTrackHeight(node.getBoundingClientRect().height);
    };

    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => observer.disconnect();
  }, [chapterSegments.length]);
  const chapterTrackMetrics = useMemo(() => {
    const gapCount = Math.max(0, chapterSegments.length - 1);
    const usableHeight = Math.max(
      0,
      progressTrackHeight - CHAPTER_TRACK_PADDING_PX * 2 - CHAPTER_TRACK_GAP_PX * gapCount
    );

    let currentTop = CHAPTER_TRACK_PADDING_PX;
    return chapterSegments.map((segment, index) => {
      const height =
        portionCount > 0 ? (usableHeight * segment.portionCount) / portionCount : 0;
      const metric = {
        ...segment,
        topPx: currentTop,
        heightPx: height
      };
      currentTop += height + (index < chapterSegments.length - 1 ? CHAPTER_TRACK_GAP_PX : 0);
      return metric;
    });
  }, [chapterSegments, portionCount, progressTrackHeight]);
  const stageHeight = stageRef.current?.clientHeight ?? 0;
  const trackTransform =
    stageHeight > 0
      ? `translateY(${-stageHeight + dragOffset}px)`
      : `translateY(calc(-100% + ${dragOffset}px))`;
  const focusedPortionIndex = useMemo(() => {
    if (stageHeight <= 0 || (!isDragging && !snapDirection)) {
      return portionIndex;
    }

    const candidates = [
      {
        index: portionIndex,
        distance: Math.abs(dragOffset),
        enabled: true
      },
      {
        index: portionIndex - 1,
        distance: Math.abs(-stageHeight + dragOffset),
        enabled: Boolean(previousPortion)
      },
      {
        index: portionIndex + 1,
        distance: Math.abs(stageHeight + dragOffset),
        enabled: Boolean(nextPortion)
      }
    ].filter((candidate) => candidate.enabled);

    candidates.sort((left, right) => left.distance - right.distance);
    return clamp(candidates[0]?.index ?? portionIndex, 0, Math.max(0, portionCount - 1));
  }, [
    dragOffset,
    isDragging,
    nextPortion,
    portionCount,
    portionIndex,
    previousPortion,
    snapDirection,
    stageHeight
  ]);
  const focusedSectionId = portions[focusedPortionIndex]?.sectionId ?? portion?.sectionId ?? null;
  const focusedSegmentMetric = useMemo(
    () =>
      chapterTrackMetrics.find((segment) => segment.sectionId === focusedSectionId) ?? null,
    [chapterTrackMetrics, focusedSectionId]
  );
  const currentMarkerTop = useMemo(() => {
    if (!focusedSegmentMetric) {
      return '50%';
    }

    const offsetWithinSegment = focusedPortionIndex - focusedSegmentMetric.start;
    const localRatio =
      focusedSegmentMetric.portionCount <= 0
        ? 0.5
        : (offsetWithinSegment + 0.5) / focusedSegmentMetric.portionCount;
    return `${focusedSegmentMetric.topPx + focusedSegmentMetric.heightPx * localRatio}px`;
  }, [focusedPortionIndex, focusedSegmentMetric]);

  function getPaneOpacity(paneIndex: number): number {
    if (stageHeight <= 0) {
      return paneIndex === 1 ? 1 : 0;
    }

    const centerOffset = Math.abs((paneIndex - 1) * stageHeight + dragOffset);
    return clamp(1 - centerOffset / stageHeight, 0, 1);
  }

  function resolvePortionIndexFromClientY(clientY: number): number | null {
    const track = progressTrackRef.current;
    if (!track || portionCount <= 0 || chapterTrackMetrics.length === 0) {
      return null;
    }

    const rect = track.getBoundingClientRect();
    if (rect.height <= 0) {
      return null;
    }

    const localY = clamp(clientY - rect.top, 0, rect.height);
    const matchingSegment =
      chapterTrackMetrics.find((segment) => {
        const start = segment.topPx;
        const end = segment.topPx + segment.heightPx;
        return localY >= start && localY <= end;
      }) ??
      (localY < chapterTrackMetrics[0].topPx
        ? chapterTrackMetrics[0]
        : chapterTrackMetrics[chapterTrackMetrics.length - 1]);

    if (!matchingSegment || matchingSegment.portionCount <= 0) {
      return null;
    }

    const localSegmentY = clamp(
      localY - matchingSegment.topPx,
      0,
      Math.max(matchingSegment.heightPx, 0.0001)
    );
    const localRatio = clamp(
      localSegmentY / Math.max(matchingSegment.heightPx, 0.0001),
      0,
      0.999999
    );
    const localPortionIndex = Math.floor(localRatio * matchingSegment.portionCount);
    return clamp(
      matchingSegment.start + localPortionIndex,
      0,
      portionCount - 1
    );
  }

  function updatePortionFromProgress(clientY: number) {
    const nextIndex = resolvePortionIndexFromClientY(clientY);
    if (nextIndex === null) {
      return;
    }

    onJumpToPortion(nextIndex);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (snapDirection) {
      return;
    }

    const interactiveTarget = (event.target as HTMLElement | null)?.closest(
      'a, button, input, label, select, textarea'
    );

    pointerState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      startedOnInteractive: Boolean(interactiveTarget)
    };

    setTransitionEnabled(false);
    setIsDragging(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId || snapDirection) {
      return;
    }

    const deltaY = event.clientY - state.y;
    const deltaX = event.clientX - state.x;

    if (!state.moved && (Math.abs(deltaY) > TAP_TOLERANCE || Math.abs(deltaX) > TAP_TOLERANCE)) {
      state.moved = true;
    }

    if (!state.moved) {
      return;
    }

    if (Math.abs(deltaY) < Math.abs(deltaX)) {
      return;
    }

    const limitedOffset =
      deltaY > 0 && !previousPortion
        ? deltaY * 0.22
        : deltaY < 0 && !nextPortion
          ? deltaY * 0.22
          : deltaY;

    setIsDragging(true);
    setDragOffset(limitedOffset);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLElement>) {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    pointerState.current = null;
    const deltaY = event.clientY - state.y;
    const deltaX = event.clientX - state.x;
    const movedEnoughForTapCancel =
      Math.abs(deltaY) > TAP_TOLERANCE || Math.abs(deltaX) > TAP_TOLERANCE;

    if (!movedEnoughForTapCancel) {
      setIsDragging(false);
      setDragOffset(0);
      setTransitionEnabled(false);
      if (!state.startedOnInteractive) {
        navigateByTap(event.clientY);
      }
      return;
    }

    const threshold = Math.max(
      SNAP_THRESHOLD_PX,
      (stageRef.current?.clientHeight ?? viewport?.height ?? 0) * SNAP_THRESHOLD_RATIO
    );

    if (deltaY <= -threshold && nextPortion) {
      animateToNeighbor('forward');
      return;
    }

    if (deltaY >= threshold && previousPortion) {
      animateToNeighbor('backward');
      return;
    }

    animateBackToRest();
  }

  function handleTrackTransitionEnd(event: React.TransitionEvent<HTMLDivElement>) {
    if (event.target !== trackRef.current || event.propertyName !== 'transform') {
      return;
    }

    if (!snapDirection) {
      setTransitionEnabled(false);
      return;
    }

    const direction = snapDirection;
    setTransitionEnabled(false);
    setDragOffset(0);
    setIsDragging(false);
    setSnapDirection(null);

    if (direction === 'forward') {
      onNext();
    } else {
      onPrevious();
    }
  }

  function handleProgressPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    progressPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updatePortionFromProgress(event.clientY);
  }

  function handleProgressPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (progressPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    updatePortionFromProgress(event.clientY);
  }

  function handleProgressPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (progressPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    progressPointerIdRef.current = null;
    updatePortionFromProgress(event.clientY);
  }

  return (
    <div
      ref={containerRef}
      className={`reader-shell theme-${settings.theme}`}
    >
      <header className="reader-header">
        <div>
          <p className="reader-kicker">{book.metadata.creator ?? 'Local EPUB'}</p>
          <h1>{book.metadata.title}</h1>
          <p className="reader-section-label">{portion?.sectionLabel}</p>
        </div>

        <div className="reader-actions">
          <button
            ref={settingsButtonRef}
            type="button"
            className="settings-button"
            aria-label="Open settings"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <aside className="chapter-progress" aria-label="Reading progress by chapter">
        <div
          ref={progressTrackRef}
          className="chapter-progress-track"
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerEnd}
          onPointerCancel={handleProgressPointerEnd}
        >
          {chapterSegments.map((segment) => {
            const isActive =
              focusedSectionId != null &&
              focusedPortionIndex >= segment.start &&
              focusedPortionIndex <= segment.end &&
              focusedSectionId === segment.sectionId;
            const metric = chapterTrackMetrics.find(
              (entry) => entry.sectionId === segment.sectionId
            );
            return (
              <div
                key={segment.sectionId}
                className={`chapter-progress-segment ${isActive ? 'active' : ''}`}
                style={
                  metric
                    ? {
                        top: `${metric.topPx}px`,
                        height: `${metric.heightPx}px`
                      }
                    : undefined
                }
                title={segment.label}
                aria-hidden="true"
              />
            );
          })}
          <div
            className="chapter-progress-marker"
            style={{ top: currentMarkerTop }}
            aria-hidden="true"
          />
        </div>
      </aside>

      <main
        ref={stageRef}
        className={`reader-stage ${isDragging ? 'dragging' : ''} ${
          snapDirection ? `snapping-${snapDirection}` : ''
        } ${transitionEnabled ? 'transitioning' : ''}`}
        style={{
          '--portion-width': viewport ? `${viewport.contentWidth}px` : '100%'
        } as CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div
          ref={trackRef}
          className="portion-track"
          style={{
            transform: trackTransform
          }}
          onTransitionEnd={handleTrackTransitionEnd}
        >
          <div
            className="portion-pane portion-pane-previous"
            aria-hidden="true"
            style={{ opacity: getPaneOpacity(0) }}
          >
            {previousPortion ? <PortionView portion={previousPortion} settings={settings} /> : null}
          </div>
          <div
            className="portion-pane portion-pane-current"
            style={{ opacity: getPaneOpacity(1) }}
          >
            {portion ? <PortionView portion={portion} settings={settings} /> : null}
          </div>
          <div
            className="portion-pane portion-pane-next"
            aria-hidden="true"
            style={{ opacity: getPaneOpacity(2) }}
          >
            {nextPortion ? <PortionView portion={nextPortion} settings={settings} /> : null}
          </div>
        </div>
      </main>

      <SettingsPanel
        panelRef={settingsPanelRef}
        open={settingsOpen}
        settings={settings}
        onChange={onSettingsChange}
        onFileSelected={onFileSelected}
      />
    </div>
  );
}
