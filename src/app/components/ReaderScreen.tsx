import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CanonicalBook } from '../../types/book';
import type {
  AnnotationSelection,
  PortionBlock,
  ReaderRectSnapshot,
  ReaderPortion,
  ReaderSettings,
  TextAnnotation,
  ViewportMetrics
} from '../../types/reader';
import { PortionView } from './PortionView';
import { SettingsPanel } from './SettingsPanel';
import { READER_CHROME } from '../hooks/useReaderViewport';
import {
  captureRangeRectSnapshots,
  measureAnnotationRectSnapshots
} from '../../lib/reader/contentRects';
import {
  createTextAnnotation,
  groupAnnotationsByBlock
} from '../../lib/annotations/domain';
import { readAnnotationSelection } from '../../lib/annotations/domSelection';
import { getAnnotationPortionIndexes } from '../../lib/annotations/navigation';

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
  annotations: TextAnnotation[];
  onSaveAnnotation: (annotation: TextAnnotation) => void;
  onDeleteAnnotation: (annotationId: string) => void;
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

interface PaneLayout {
  previousHeight: number;
  currentHeight: number;
  nextHeight: number;
  previousTop: number;
  currentTop: number;
  nextTop: number;
  backwardSnapOffset: number;
  forwardSnapOffset: number;
}

interface ProgressDragState {
  pointerId: number;
  startY: number;
  startItemCenter: number;
  currentIndex: number;
  moved: boolean;
}

interface ProgressTilt {
  rotateY: number;
  rotateZ: number;
  originY: number;
}

type NavigatorWithVibration = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
};

const TAP_TOLERANCE = 10;
const SNAP_THRESHOLD_RATIO = 0.18;
const SNAP_THRESHOLD_PX = 84;
const SNAP_ANIMATION_MS = 240;
const PORTION_NAV_ITEM_HEIGHT_PX = 4;
const CHAPTER_TRACK_GAP_PX = 3;
const CONTINUATION_BRIDGE_WIDTH_PX = 25;
const PROGRESS_TILT_MAX_Y_DEG = 34;
const PROGRESS_TILT_MAX_Z_DEG = 7;
const READER_HAPTIC_MS = 8;
const LONG_PRESS_MS = 320;
const SELECTION_SETTLE_MS = 260;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNeutralProgressTilt(): ProgressTilt {
  return {
    rotateY: 0,
    rotateZ: 0,
    originY: 50
  };
}

function triggerReaderHaptic() {
  if (typeof navigator === 'undefined') {
    return;
  }

  const vibrationNavigator = navigator as NavigatorWithVibration;
  vibrationNavigator.vibrate?.(READER_HAPTIC_MS);
}

function BookmarkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="annotation-save-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v13l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z" />
    </svg>
  );
}

function isTextBlock(block: PortionBlock): block is Extract<PortionBlock, { type: 'text' }> {
  return block.type === 'text';
}

function getFirstTextBlock(portion: ReaderPortion | null): Extract<PortionBlock, { type: 'text' }> | null {
  return portion?.blocks.find(isTextBlock) ?? null;
}

function getLastTextBlock(portion: ReaderPortion | null): Extract<PortionBlock, { type: 'text' }> | null {
  if (!portion) {
    return null;
  }

  for (let index = portion.blocks.length - 1; index >= 0; index -= 1) {
    const block = portion.blocks[index];
    if (isTextBlock(block)) {
      return block;
    }
  }

  return null;
}

function hasContinuationBoundary(from: ReaderPortion | null, to: ReaderPortion | null): boolean {
  const fromBlock = getLastTextBlock(from);
  const toBlock = getFirstTextBlock(to);

  if (!fromBlock || !toBlock) {
    return false;
  }

  return fromBlock.continuationEnd && toBlock.continuationStart;
}

function endsWithSceneBreak(portion: ReaderPortion | null): boolean {
  return portion?.blocks[portion.blocks.length - 1]?.type === 'scene-break';
}

function hasSceneBreakBoundary(
  previous: ReaderPortion | null,
  current: ReaderPortion | null
): boolean {
  return Boolean(previous && current && endsWithSceneBreak(previous));
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

function ContinuationBridge() {
  return (
    <div className="continuation-bridge" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function SceneBreakBridge() {
  return <div className="scene-break scene-break-boundary" aria-hidden="true" />;
}

function ContinuationBridgeShell({
  visible,
  style,
  transitioning,
  children
}: {
  visible: boolean;
  style: CSSProperties | null;
  transitioning?: boolean;
  children?: React.ReactNode;
}) {
  const [fadeIn, setFadeIn] = useState(false);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    let timeoutId: number | null = null;
    const becameVisible = visible && !wasVisibleRef.current;

    if (becameVisible) {
      setFadeIn(true);
      timeoutId = window.setTimeout(() => {
        setFadeIn(false);
      }, 160);
    } else if (!visible) {
      setFadeIn(false);
    }

    wasVisibleRef.current = visible;

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [visible]);

  if (!visible || !style) {
    return null;
  }

  return (
    <div
      className={`continuation-bridge-shell${transitioning ? ' transitioning' : ''}${
        fadeIn ? ' fade-in' : ''
      }`}
      style={style}
    >
      <div className="continuation-bridge-drag-offset">
        {children ?? <ContinuationBridge />}
      </div>
    </div>
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
  annotations,
  onSaveAnnotation,
  onDeleteAnnotation,
  containerRef
}: ReaderScreenProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [snapDirection, setSnapDirection] = useState<SnapDirection | null>(null);
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  const [progressTrackHeight, setProgressTrackHeight] = useState(0);
  const [progressDragOffset, setProgressDragOffset] = useState(0);
  const [progressDragging, setProgressDragging] = useState(false);
  const [progressTilt, setProgressTilt] = useState<ProgressTilt>({
    rotateY: 0,
    rotateZ: 0,
    originY: 50
  });
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState<AnnotationSelection | null>(null);
  const [annotationNote, setAnnotationNote] = useState('');
  const [activeAnnotation, setActiveAnnotation] = useState<TextAnnotation | null>(null);
  const [activeAnnotationRects, setActiveAnnotationRects] = useState<ReaderRectSnapshot[]>([]);
  const [sheetHeights, setSheetHeights] = useState({
    previous: 0,
    current: 0,
    next: 0
  });
  const pointerState = useRef<PointerState | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressEligibleRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const stageElementRef = useRef<HTMLElement | null>(null);
  const selectionFinalizeTimeoutRef = useRef<number | null>(null);
  const progressPointerIdRef = useRef<number | null>(null);
  const progressDragRef = useRef<ProgressDragState | null>(null);
  const snapTimeoutRef = useRef<number | null>(null);
  const settleHapticPendingRef = useRef(false);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const pendingDragOffsetRef = useRef(0);
  const dragOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const stageRef = useRef<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const previousPaneRef = useRef<HTMLDivElement | null>(null);
  const currentPaneRef = useRef<HTMLDivElement | null>(null);
  const nextPaneRef = useRef<HTMLDivElement | null>(null);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const annotationSheetRef = useRef<HTMLDivElement | null>(null);

  function clearSnapTimeout() {
    if (snapTimeoutRef.current !== null) {
      window.clearTimeout(snapTimeoutRef.current);
      snapTimeoutRef.current = null;
    }
  }

  function clearLongPressTimeout() {
    if (longPressTimeoutRef.current !== null) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }

  function clearSelectionFinalizeTimeout() {
    if (selectionFinalizeTimeoutRef.current !== null) {
      window.clearTimeout(selectionFinalizeTimeoutRef.current);
      selectionFinalizeTimeoutRef.current = null;
    }
  }

  function clearDomSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function readSelectionDraftFromDom() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const currentPane = currentPaneRef.current;
    if (!currentPane) {
      return null;
    }

    return readAnnotationSelection({
      range,
      scope: currentPane,
      book,
      captureRects: captureRangeRectSnapshots
    });
  }

  function flushDragOffset(nextOffset: number) {
    dragOffsetRef.current = nextOffset;
    setDragOffset(nextOffset);
  }

  function scheduleDragOffset(nextOffset: number) {
    pendingDragOffsetRef.current = nextOffset;
    if (dragAnimationFrameRef.current !== null) {
      return;
    }

    dragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      dragAnimationFrameRef.current = null;
      flushDragOffset(pendingDragOffsetRef.current);
    });
  }

  function clearDragAnimationFrame() {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }
  }

  function animateBackToRest() {
    clearSnapTimeout();
    clearDragAnimationFrame();
    setTransitionEnabled(true);
    setSnapDirection(null);
    flushDragOffset(0);
    setIsDragging(false);
    isDraggingRef.current = false;
    snapTimeoutRef.current = window.setTimeout(() => {
      setTransitionEnabled(false);
      clearSnapTimeout();
    }, SNAP_ANIMATION_MS);
  }

  function animateToNeighbor(direction: SnapDirection) {
    const stageHeight = stageRef.current?.clientHeight ?? 0;
    if (stageHeight <= 0) {
      if (settleHapticPendingRef.current) {
        settleHapticPendingRef.current = false;
        triggerReaderHaptic();
      }
      if (direction === 'forward') {
        onNext();
      } else {
        onPrevious();
      }
      return;
    }

    setTransitionEnabled(true);
    setIsDragging(false);
    isDraggingRef.current = false;
    setSnapDirection(direction);
    clearDragAnimationFrame();
    flushDragOffset(
      direction === 'forward' ? paneLayout.forwardSnapOffset : paneLayout.backwardSnapOffset
    );
  }

  function navigateByTap(clientY: number) {
    if (clientY >= 0 && nextPortion) {
      triggerReaderHaptic();
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
    return () => {
      clearSnapTimeout();
      clearDragAnimationFrame();
      clearLongPressTimeout();
      clearSelectionFinalizeTimeout();
    };
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
    if (!selectionDraft) {
      return;
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (annotationSheetRef.current?.contains(target)) {
        return;
      }

      setAnnotationNote('');
      setSelectionDraft(null);
      setSelectionEnabled(false);
      clearSelectionFinalizeTimeout();
      clearDomSelection();
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [selectionDraft]);

  useEffect(() => {
    if (!portion) {
      return;
    }

    setTransitionEnabled(false);
    flushDragOffset(0);
    setIsDragging(false);
    isDraggingRef.current = false;
    setSnapDirection(null);
    setSelectionEnabled(false);
    setSelectionDraft(null);
    setAnnotationNote('');
    clearSelectionFinalizeTimeout();
    clearDomSelection();
  }, [portion?.id]);

  useEffect(() => {
    if (!selectionEnabled) {
      return;
    }

    const finalizeSelection = () => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && annotationSheetRef.current?.contains(activeElement)) {
        return;
      }

      clearSelectionFinalizeTimeout();
      selectionFinalizeTimeoutRef.current = window.setTimeout(() => {
        const nextDraft = readSelectionDraftFromDom();
        if (!nextDraft) {
          clearSelectionFinalizeTimeout();
          return;
        }

        setSelectionDraft(nextDraft);
        clearSelectionFinalizeTimeout();
      }, SELECTION_SETTLE_MS);
    };

    document.addEventListener('pointerup', finalizeSelection, true);
    document.addEventListener('touchend', finalizeSelection, true);

    return () => {
      document.removeEventListener('pointerup', finalizeSelection, true);
      document.removeEventListener('touchend', finalizeSelection, true);
    };
  }, [readSelectionDraftFromDom, selectionEnabled]);

  useEffect(() => {
    if (!selectionEnabled || !selectionDraft) {
      return;
    }

    const syncSelectionDraft = () => {
      const nextDraft = readSelectionDraftFromDom();
      if (!nextDraft) {
        return;
      }

      setSelectionDraft((current) => {
        if (
          current &&
          current.blockId === nextDraft.blockId &&
          current.blockOrder === nextDraft.blockOrder &&
          current.startOffset === nextDraft.startOffset &&
          current.endOffset === nextDraft.endOffset &&
          current.sentenceIndex === nextDraft.sentenceIndex &&
          current.selectedText === nextDraft.selectedText
        ) {
          return current;
        }

        return nextDraft;
      });
    };

    document.addEventListener('selectionchange', syncSelectionDraft);
    return () => document.removeEventListener('selectionchange', syncSelectionDraft);
  }, [readSelectionDraftFromDom, selectionDraft, selectionEnabled]);

  useEffect(() => {
    const currentPane = currentPaneRef.current;
    if (!activeAnnotation || !currentPane) {
      setActiveAnnotationRects([]);
      return;
    }

    const updateRects = () => {
      setActiveAnnotationRects(measureAnnotationRectSnapshots(currentPane, activeAnnotation));
    };

    updateRects();
    const observer = new ResizeObserver(() => updateRects());
    observer.observe(currentPane);
    window.addEventListener('resize', updateRects);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateRects);
    };
  }, [activeAnnotation, portion?.id, portionIndex, settings.fontSize, settings.horizontalPadding, settings.lineHeight]);

  useEffect(() => {
    const measure = () => {
      const readHeight = (pane: HTMLDivElement | null) =>
        pane?.querySelector<HTMLElement>('.portion-sheet')?.getBoundingClientRect().height ?? 0;

      const nextHeights = {
        previous: readHeight(previousPaneRef.current),
        current: readHeight(currentPaneRef.current),
        next: readHeight(nextPaneRef.current)
      };

      setSheetHeights((current) =>
        current.previous === nextHeights.previous &&
        current.current === nextHeights.current &&
        current.next === nextHeights.next
          ? current
          : nextHeights
      );
    };

    measure();
    const observer = new ResizeObserver(() => measure());
    [previousPaneRef.current, currentPaneRef.current, nextPaneRef.current].forEach((pane) => {
      const sheet = pane?.querySelector<HTMLElement>('.portion-sheet');
      if (sheet) {
        observer.observe(sheet);
      }
    });

    return () => observer.disconnect();
  }, [
    previousPortion?.id,
    portion?.id,
    nextPortion?.id,
    settings.fontSize,
    settings.lineHeight,
    settings.horizontalPadding,
    viewport?.contentWidth,
    viewport?.contentHeight
  ]);

  const portionNavigation = useMemo(() => {
    let topPx = 0;
    let previousSectionId: string | null = null;
    const items = portions.map((readerPortion, index) => {
      if (previousSectionId !== null && previousSectionId !== readerPortion.sectionId) {
        topPx += CHAPTER_TRACK_GAP_PX;
      }

      const item = {
        index,
        sectionId: readerPortion.sectionId,
        label: readerPortion.sectionLabel,
        topPx,
        heightPx: PORTION_NAV_ITEM_HEIGHT_PX
      };
      topPx += PORTION_NAV_ITEM_HEIGHT_PX;
      previousSectionId = readerPortion.sectionId;
      return item;
    });

    return {
      items,
      totalHeightPx: topPx
    };
  }, [portions]);
  const portionNavigationItemByIndex = useMemo(() => {
    const next = new Map<number, (typeof portionNavigation.items)[number]>();
    portionNavigation.items.forEach((item) => {
      next.set(item.index, item);
    });
    return next;
  }, [portionNavigation.items]);
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
  }, [portionNavigation.items.length]);
  const stageHeight = stageRef.current?.clientHeight ?? 0;
  const fallbackSheetHeight = viewport
    ? viewport.contentHeight + READER_CHROME.portionEdgePadding * 2
    : stageHeight;
  const paneLayout = useMemo<PaneLayout>(() => {
    const previousHeight =
      previousPortion && sheetHeights.previous > 0 ? sheetHeights.previous : fallbackSheetHeight;
    const currentHeight =
      portion && sheetHeights.current > 0 ? sheetHeights.current : fallbackSheetHeight;
    const nextHeight =
      nextPortion && sheetHeights.next > 0 ? sheetHeights.next : fallbackSheetHeight;
    const stageSafeHeight = stageHeight || viewport?.height || currentHeight || fallbackSheetHeight;
    const currentTop = (stageSafeHeight - currentHeight) / 2;
    const previousTop = currentTop - previousHeight;
    const nextTop = currentTop + currentHeight;

    return {
      previousHeight,
      currentHeight,
      nextHeight,
      previousTop,
      currentTop,
      nextTop,
      backwardSnapOffset: ((stageSafeHeight - previousHeight) / 2) - previousTop,
      forwardSnapOffset: ((stageSafeHeight - nextHeight) / 2) - nextTop
    };
  }, [
    fallbackSheetHeight,
    nextPortion,
    portion,
    previousPortion,
    sheetHeights.current,
    sheetHeights.next,
    sheetHeights.previous,
    stageHeight,
    viewport?.height
  ]);
  const forwardProgress = useMemo(
    () =>
      clamp(
        -dragOffset / Math.max(1, Math.abs(paneLayout.forwardSnapOffset)),
        0,
        1
      ),
    [dragOffset, paneLayout.forwardSnapOffset]
  );
  const backwardProgress = useMemo(
    () =>
      clamp(
        dragOffset / Math.max(1, Math.abs(paneLayout.backwardSnapOffset)),
        0,
        1
      ),
    [dragOffset, paneLayout.backwardSnapOffset]
  );
  const focusedPortionIndex = useMemo(() => {
    if (stageHeight <= 0 || (!isDragging && !snapDirection)) {
      return portionIndex;
    }

    const stageCenter = stageHeight / 2;

    const candidates = [
      {
        index: portionIndex,
        distance: Math.abs(
          paneLayout.currentTop + paneLayout.currentHeight / 2 + dragOffset - stageCenter
        ),
        enabled: true
      },
      {
        index: portionIndex - 1,
        distance: Math.abs(
          paneLayout.previousTop + paneLayout.previousHeight / 2 + dragOffset - stageCenter
        ),
        enabled: Boolean(previousPortion)
      },
      {
        index: portionIndex + 1,
        distance: Math.abs(
          paneLayout.nextTop + paneLayout.nextHeight / 2 + dragOffset - stageCenter
        ),
        enabled: Boolean(nextPortion)
      }
    ].filter((candidate) => candidate.enabled);

    candidates.sort((left, right) => left.distance - right.distance);
    return clamp(candidates[0]?.index ?? portionIndex, 0, Math.max(0, portionCount - 1));
  }, [
    dragOffset,
    isDragging,
    nextPortion,
    paneLayout.currentHeight,
    paneLayout.currentTop,
    paneLayout.nextHeight,
    paneLayout.nextTop,
    paneLayout.previousHeight,
    paneLayout.previousTop,
    portionCount,
    portionIndex,
    previousPortion,
    snapDirection,
    stageHeight
  ]);
  const annotationsByBlock = useMemo(() => groupAnnotationsByBlock(annotations), [annotations]);
  const annotationPortionIndexes = useMemo(
    () => getAnnotationPortionIndexes(annotations, portions),
    [annotations, portions]
  );
  const activeNavigationIndex = clamp(
    focusedPortionIndex,
    0,
    Math.max(0, portionNavigation.items.length - 1)
  );
  const activeNavigationItem = portionNavigationItemByIndex.get(activeNavigationIndex);
  const navigationBaseOffset =
    progressTrackHeight > 0 && activeNavigationItem
      ? progressTrackHeight / 2 -
        (activeNavigationItem.topPx + activeNavigationItem.heightPx / 2)
      : 0;
  const navigationStripOffset = navigationBaseOffset + progressDragOffset;
  const continuationStyles = useMemo(() => {
    const stageWidth = stageRef.current?.clientWidth ?? viewport?.width ?? 0;
    if (stageHeight <= 0 || stageWidth <= 0 || !portion) {
      return {
        incomingCurrent: null,
        outgoingCurrent: null,
        incomingSceneBreak: null,
        outgoingSceneBreak: null,
        activeForwardBridge: null,
        activeBackwardBridge: null,
        activeForwardSceneBreak: null,
        activeBackwardSceneBreak: null
      };
    }

    const draggingForward = isDragging && dragOffset < 0;
    const draggingBackward = isDragging && dragOffset > 0;
    const animatingForward = transitionEnabled && snapDirection === 'forward';
    const animatingBackward = transitionEnabled && snapDirection === 'backward';
    const bridgeHalfWidth = CONTINUATION_BRIDGE_WIDTH_PX / 2;
    const markerInsetY = READER_CHROME.portionEdgePadding / 2;
    const sheetWidth = viewport?.contentWidth ?? stageWidth;
    const sheetLeft = Math.max(0, (stageWidth - sheetWidth) / 2);
    const sheetRight = sheetLeft + sheetWidth;

    function makeSheetRect(
      top: number,
      height: number,
      enabled: boolean
    ): { left: number; right: number; top: number; bottom: number } | null {
      if (!enabled || height <= 0) {
        return null;
      }

      const translatedTop = top + dragOffset;
      return {
        left: sheetLeft,
        right: sheetRight,
        top: translatedTop,
        bottom: translatedTop + height
      };
    }

    const previousSheet = makeSheetRect(
      paneLayout.previousTop,
      paneLayout.previousHeight,
      Boolean(previousPortion)
    );
    const currentSheet = makeSheetRect(
      paneLayout.currentTop,
      paneLayout.currentHeight,
      Boolean(portion)
    );
    const nextSheet = makeSheetRect(
      paneLayout.nextTop,
      paneLayout.nextHeight,
      Boolean(nextPortion)
    );

    const interpolate = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      progress: number
    ): CSSProperties => ({
      transform: `translate(${from.x + (to.x - from.x) * progress}px, ${from.y + (to.y - from.y) * progress}px) translate(-50%, -50%)`
    });

    const topLeftStyle = (rect: { left: number; top: number } | null): CSSProperties => ({
      transform: `translate(${(rect?.left ?? sheetLeft) + bridgeHalfWidth}px, ${(rect?.top ?? markerInsetY) + markerInsetY}px) translate(-50%, -50%)`
    });
    const bottomRightStyle = (rect: { right: number; bottom: number } | null): CSSProperties => ({
      transform: `translate(${(rect?.right ?? sheetRight) - bridgeHalfWidth}px, ${(rect?.bottom ?? stageHeight - markerInsetY) - markerInsetY}px) translate(-50%, -50%)`
    });
    const topCenterStyle = (
      rect: { left: number; right: number; top: number } | null
    ): CSSProperties => ({
      transform: `translate(${((rect?.left ?? sheetLeft) + (rect?.right ?? sheetRight)) / 2}px, ${(
        rect?.top ?? markerInsetY
      ) + markerInsetY + 12}px) translate(-50%, -50%)`
    });
    const bottomCenterStyle = (
      rect: { left: number; right: number; bottom: number } | null
    ): CSSProperties => ({
      transform: `translate(${((rect?.left ?? sheetLeft) + (rect?.right ?? sheetRight)) / 2}px, ${(
        rect?.bottom ?? stageHeight - markerInsetY
      ) - markerInsetY - 12}px) translate(-50%, -50%)`
    });
    const hasForwardContinuationBoundary = hasContinuationBoundary(portion, nextPortion);
    const hasBackwardContinuationBoundary = hasContinuationBoundary(previousPortion, portion);
    const forwardBridgeProgress = draggingForward || animatingForward ? forwardProgress : 0;
    const backwardBridgeProgress = draggingBackward || animatingBackward ? backwardProgress : 0;
    const incomingCurrent =
      getFirstTextBlock(portion)?.continuationStart && !hasBackwardContinuationBoundary
        ? topLeftStyle(currentSheet)
        : null;
    const outgoingCurrent =
      getLastTextBlock(portion)?.continuationEnd && !hasForwardContinuationBoundary
        ? bottomRightStyle(currentSheet)
        : null;
    const incomingSceneBreak =
      hasSceneBreakBoundary(previousPortion, portion) &&
      !(draggingBackward || animatingBackward)
        ? topCenterStyle(currentSheet)
        : null;
    const outgoingSceneBreak =
      endsWithSceneBreak(portion) && !(draggingForward || animatingForward)
        ? bottomCenterStyle(currentSheet)
        : null;
    const activeForwardBridge =
      hasForwardContinuationBoundary && currentSheet && nextSheet
        ? interpolate(
            {
              x: currentSheet.right - bridgeHalfWidth,
              y: currentSheet.bottom - markerInsetY
            },
            {
              x: nextSheet.left + bridgeHalfWidth,
              y: nextSheet.top + markerInsetY
            },
            forwardBridgeProgress
          )
        : null;
    const activeForwardSceneBreak =
      (draggingForward || animatingForward) &&
      endsWithSceneBreak(portion) &&
      currentSheet &&
      nextSheet
        ? interpolate(
            {
              x: (currentSheet.left + currentSheet.right) / 2,
              y: currentSheet.bottom - markerInsetY - 12
            },
            {
              x: (nextSheet.left + nextSheet.right) / 2,
              y: nextSheet.top + markerInsetY + 12
            },
            forwardProgress
          )
        : null;
    const activeBackwardBridge =
      hasBackwardContinuationBoundary && previousSheet && currentSheet
        ? interpolate(
            {
              x: currentSheet.left + bridgeHalfWidth,
              y: currentSheet.top + markerInsetY
            },
            {
              x: previousSheet.right - bridgeHalfWidth,
              y: previousSheet.bottom - markerInsetY
            },
            backwardBridgeProgress
          )
        : null;
    const activeBackwardSceneBreak =
      (draggingBackward || animatingBackward) &&
      endsWithSceneBreak(previousPortion) &&
      previousSheet &&
      currentSheet
        ? interpolate(
            {
              x: (currentSheet.left + currentSheet.right) / 2,
              y: currentSheet.top + markerInsetY + 12
            },
            {
              x: (previousSheet.left + previousSheet.right) / 2,
              y: previousSheet.bottom - markerInsetY - 12
            },
            backwardProgress
          )
        : null;

    return {
      incomingCurrent,
      outgoingCurrent,
      incomingSceneBreak,
      outgoingSceneBreak,
      activeForwardBridge,
      activeBackwardBridge,
      activeForwardSceneBreak,
      activeBackwardSceneBreak
    };
  }, [
    dragOffset,
    forwardProgress,
    isDragging,
    nextPortion,
    paneLayout.currentHeight,
    paneLayout.currentTop,
    paneLayout.nextHeight,
    paneLayout.nextTop,
    paneLayout.previousHeight,
    paneLayout.previousTop,
    portion,
    previousPortion,
    backwardProgress,
    snapDirection,
    stageHeight,
    transitionEnabled,
    viewport
  ]);

  function getPaneOpacity(pane: 'previous' | 'current' | 'next'): number {
    if (pane === 'current') {
      return clamp(1 - Math.max(forwardProgress, backwardProgress), 0, 1);
    }

    if (pane === 'previous') {
      return previousPortion ? backwardProgress : 0;
    }

    return nextPortion ? forwardProgress : 0;
  }

  function findClosestNavigationIndex(targetCenter: number): number | null {
    if (portionNavigation.items.length === 0) {
      return null;
    }

    let closest = portionNavigation.items[0];
    let closestDistance = Math.abs(
      closest.topPx + closest.heightPx / 2 - targetCenter
    );

    for (let index = 1; index < portionNavigation.items.length; index += 1) {
      const item = portionNavigation.items[index];
      const distance = Math.abs(item.topPx + item.heightPx / 2 - targetCenter);
      if (distance >= closestDistance) {
        continue;
      }

      closest = item;
      closestDistance = distance;
    }

    return closest.index;
  }

  function getNavigationOffsetForIndex(index: number): number {
    const item = portionNavigationItemByIndex.get(index);
    if (!item || progressTrackHeight <= 0) {
      return 0;
    }

    return progressTrackHeight / 2 - (item.topPx + item.heightPx / 2);
  }

  function getProgressTilt(clientX: number, clientY: number, deltaY: number): ProgressTilt {
    const viewportWidth = Math.max(window.innerWidth || viewport?.width || 1, 1);
    const viewportHeight = Math.max(window.innerHeight || viewport?.height || 1, 1);
    const horizontalRatio = clamp((clientX / viewportWidth) * 4, 0, 1);
    const verticalDragRatio = clamp(-deltaY / 95, -1, 1);

    return {
      rotateY: horizontalRatio * PROGRESS_TILT_MAX_Y_DEG,
      rotateZ: -verticalDragRatio * PROGRESS_TILT_MAX_Z_DEG,
      originY: clamp((clientY / viewportHeight) * 100, 12, 88)
    };
  }

  function updateProgressDragFromPointer(
    event: React.PointerEvent<HTMLDivElement>
  ): number | null {
    const dragState = progressDragRef.current;
    if (
      progressPointerIdRef.current !== event.pointerId ||
      !dragState ||
      dragState.pointerId !== event.pointerId
    ) {
      return null;
    }

    const deltaY = event.clientY - dragState.startY;
    setProgressTilt(getProgressTilt(event.clientX, event.clientY, deltaY));
    if (Math.abs(deltaY) > 1) {
      dragState.moved = true;
    }

    const targetCenter = dragState.startItemCenter - deltaY;
    const nextIndex = findClosestNavigationIndex(targetCenter);
    if (nextIndex === null) {
      return null;
    }

    const dragVisualOffset = progressTrackHeight / 2 - dragState.startItemCenter + deltaY;
    setProgressDragOffset(dragVisualOffset - getNavigationOffsetForIndex(nextIndex));

    if (dragState.moved && nextIndex !== dragState.currentIndex) {
      dragState.currentIndex = nextIndex;
      triggerReaderHaptic();
      onJumpToPortion(nextIndex);
    }

    return nextIndex;
  }

  function handleSaveAnnotation() {
    if (!selectionDraft || !annotationNote.trim()) {
      return;
    }

    onSaveAnnotation(createTextAnnotation(book, selectionDraft, annotationNote));
    setAnnotationNote('');
    setSelectionDraft(null);
    setSelectionEnabled(false);
    clearSelectionFinalizeTimeout();
    clearDomSelection();
  }

  function handleAnnotationPress(annotation: TextAnnotation) {
    setActiveAnnotation(annotation);
    setSelectionDraft(null);
    setSelectionEnabled(false);
    clearSelectionFinalizeTimeout();
    clearDomSelection();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (snapDirection || selectionEnabled) {
      return;
    }

    const interactiveTarget = (event.target as HTMLElement | null)?.closest(
      'a, button, input, label, select, textarea, [data-reader-interactive="true"]'
    );
    const withinCurrentText = Boolean(
      (event.target as HTMLElement | null)?.closest('.portion-pane-current .reader-lines')
    );

    pointerState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      startedOnInteractive: Boolean(interactiveTarget)
    };
    stageElementRef.current = event.currentTarget;
    longPressTriggeredRef.current = false;
    longPressEligibleRef.current = withinCurrentText && !interactiveTarget;
    clearLongPressTimeout();
    if (longPressEligibleRef.current) {
      longPressTimeoutRef.current = window.setTimeout(() => {
        if (!pointerState.current || pointerState.current.pointerId !== event.pointerId) {
          return;
        }
        longPressTriggeredRef.current = true;
        setSelectionEnabled(true);
        setIsDragging(false);
        isDraggingRef.current = false;
        if (stageElementRef.current?.hasPointerCapture(event.pointerId)) {
          stageElementRef.current.releasePointerCapture(event.pointerId);
        }
      }, LONG_PRESS_MS);
    }

    setTransitionEnabled(false);
    setIsDragging(false);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId || snapDirection || longPressTriggeredRef.current) {
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

    clearLongPressTimeout();
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const limitedOffset =
      deltaY > 0 && !previousPortion
        ? deltaY * 0.22
        : deltaY < 0 && !nextPortion
          ? deltaY * 0.22
          : deltaY;

    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      setIsDragging(true);
    }

    scheduleDragOffset(limitedOffset);
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLElement>) {
    const state = pointerState.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    clearLongPressTimeout();
    pointerState.current = null;
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    const deltaY = event.clientY - state.y;
    const deltaX = event.clientX - state.x;
    const movedEnoughForTapCancel =
      Math.abs(deltaY) > TAP_TOLERANCE || Math.abs(deltaX) > TAP_TOLERANCE;

    if (!movedEnoughForTapCancel) {
      setIsDragging(false);
      isDraggingRef.current = false;
      clearDragAnimationFrame();
      flushDragOffset(0);
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
      settleHapticPendingRef.current = true;
      animateToNeighbor('forward');
      return;
    }

    if (deltaY >= threshold && previousPortion) {
      settleHapticPendingRef.current = true;
      animateToNeighbor('backward');
      return;
    }

    settleHapticPendingRef.current = true;
    animateBackToRest();
  }

  function handleTrackTransitionEnd(event: React.TransitionEvent<HTMLDivElement>) {
    if (
      event.target !== currentPaneRef.current ||
      event.propertyName !== 'transform'
    ) {
      return;
    }

    if (!snapDirection) {
      setTransitionEnabled(false);
      if (settleHapticPendingRef.current) {
        settleHapticPendingRef.current = false;
        triggerReaderHaptic();
      }
      return;
    }

    const direction = snapDirection;
    if (settleHapticPendingRef.current) {
      settleHapticPendingRef.current = false;
      triggerReaderHaptic();
    }
    setTransitionEnabled(false);
    flushDragOffset(0);
    setIsDragging(false);
    isDraggingRef.current = false;
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
    if (portionNavigation.items.length === 0 || progressTrackHeight <= 0) {
      return;
    }

    const activeItem = portionNavigationItemByIndex.get(activeNavigationIndex);
    if (!activeItem) {
      return;
    }

    progressPointerIdRef.current = event.pointerId;
    progressDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startItemCenter: activeItem.topPx + activeItem.heightPx / 2,
      currentIndex: activeNavigationIndex,
      moved: false
    };
    setProgressDragging(true);
    setProgressDragOffset(0);
    setProgressTilt(getProgressTilt(event.clientX, event.clientY, 0));
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleProgressPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (progressPointerIdRef.current !== event.pointerId || !progressDragRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateProgressDragFromPointer(event);
  }

  function handleProgressPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (progressPointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateProgressDragFromPointer(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    progressPointerIdRef.current = null;
    progressDragRef.current = null;
    setProgressDragging(false);
    setProgressDragOffset(0);
    setProgressTilt(getNeutralProgressTilt());
  }

  return (
    <div
      ref={containerRef}
      className={`reader-shell theme-${settings.theme}`}
    >
      <header className="reader-header">
        <div className="reader-header-copy">
          <p className="reader-kicker">{book.metadata.creator ?? 'Local publication'}</p>
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
          className={`chapter-progress-track ${progressDragging ? 'dragging' : ''}`}
          onPointerDown={handleProgressPointerDown}
          onPointerMove={handleProgressPointerMove}
          onPointerUp={handleProgressPointerEnd}
          onPointerCancel={handleProgressPointerEnd}
        >
          <div
            className="chapter-progress-strip"
            style={{
              height: `${portionNavigation.totalHeightPx}px`,
              transform: `translateY(${navigationStripOffset}px)`
            }}
            aria-hidden="true"
          >
            {Array.from(annotationPortionIndexes).map((index) => {
              const item = portionNavigationItemByIndex.get(index);
              if (!item) {
                return null;
              }

              return (
                <div
                  key={`annotation-marker-${index}`}
                  className="chapter-progress-annotation"
                  style={{ top: `${item.topPx + item.heightPx / 2}px` }}
                />
              );
            })}
            {portionNavigation.items.map((item) => {
              const stateClass =
                item.index === activeNavigationIndex
                  ? 'active'
                  : item.index < activeNavigationIndex
                    ? 'completed'
                    : 'upcoming';
              return (
                <div
                  key={portions[item.index]?.id ?? `portion-nav-${item.index}`}
                  className={`chapter-progress-segment ${stateClass}`}
                  style={{
                    top: `${item.topPx}px`,
                    height: `${item.heightPx}px`
                  }}
                  title={item.label}
                />
              );
            })}
          </div>
          <div
            className="chapter-progress-marker"
            aria-hidden="true"
          />
        </div>
      </aside>

      <main
        ref={stageRef}
        className={`reader-stage ${isDragging ? 'dragging' : ''} ${
          snapDirection ? `snapping-${snapDirection}` : ''
        } ${transitionEnabled ? 'transitioning' : ''} ${
          progressDragging ? 'navigator-dragging' : ''
        }`}
        style={{
          '--portion-width': viewport ? `${viewport.contentWidth}px` : '100%',
          '--portion-edge-padding': `${READER_CHROME.portionEdgePadding}px`,
          '--navigator-tilt-y': `${progressTilt.rotateY}deg`,
          '--navigator-tilt-z': `${progressTilt.rotateZ}deg`,
          '--navigator-tilt-origin-y': `${progressTilt.originY}%`,
          touchAction: selectionEnabled ? 'auto' : 'none'
        } as CSSProperties}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.activeBackwardBridge)}
          style={continuationStyles.activeBackwardBridge}
          transitioning={transitionEnabled}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.activeBackwardSceneBreak)}
          style={continuationStyles.activeBackwardSceneBreak}
          transitioning={transitionEnabled}
        >
          <SceneBreakBridge />
        </ContinuationBridgeShell>
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.incomingCurrent)}
          style={continuationStyles.incomingCurrent}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.incomingSceneBreak)}
          style={continuationStyles.incomingSceneBreak}
        >
          <SceneBreakBridge />
        </ContinuationBridgeShell>
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.outgoingCurrent)}
          style={continuationStyles.outgoingCurrent}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.outgoingSceneBreak)}
          style={continuationStyles.outgoingSceneBreak}
        >
          <SceneBreakBridge />
        </ContinuationBridgeShell>
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.activeForwardBridge)}
          style={continuationStyles.activeForwardBridge}
          transitioning={transitionEnabled}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.activeForwardSceneBreak)}
          style={continuationStyles.activeForwardSceneBreak}
          transitioning={transitionEnabled}
        >
          <SceneBreakBridge />
        </ContinuationBridgeShell>
        <div
          ref={trackRef}
          className="portion-track"
          onTransitionEnd={handleTrackTransitionEnd}
        >
          <div
            ref={previousPaneRef}
            className="portion-pane portion-pane-previous"
            aria-hidden="true"
            style={{
              height: previousPortion ? `${paneLayout.previousHeight}px` : '0px',
              transform: `translateY(${paneLayout.previousTop + dragOffset}px)`,
              opacity: getPaneOpacity('previous')
            }}
          >
            {previousPortion ? (
              <PortionView
                portion={previousPortion}
                settings={settings}
                annotationsByBlock={annotationsByBlock}
                hideTrailingBoundarySceneBreak={endsWithSceneBreak(previousPortion)}
              />
            ) : null}
          </div>
          <div
            ref={currentPaneRef}
            className={`portion-pane portion-pane-current${selectionEnabled ? ' selection-enabled' : ''}`}
            style={{
              height: portion ? `${paneLayout.currentHeight}px` : '0px',
              transform: `translateY(${paneLayout.currentTop + dragOffset}px)`,
              opacity: portion ? getPaneOpacity('current') : 0
            }}
          >
            {portion ? (
              <>
                <PortionView
                  portion={portion}
                  settings={settings}
                  annotationsByBlock={annotationsByBlock}
                  onAnnotationPress={handleAnnotationPress}
                  hideLeadingBoundarySceneBreak={hasSceneBreakBoundary(previousPortion, portion)}
                  hideTrailingBoundarySceneBreak={endsWithSceneBreak(portion)}
                />
                {activeAnnotationRects.length > 0 ? (
                  <div className="annotation-live-overlay" aria-hidden="true">
                    {activeAnnotationRects.map((rect, index) => (
                      <div
                        key={`annotation-live-rect-${index}`}
                        className="annotation-live-rect"
                        style={{
                          left: `${rect.x}%`,
                          top: `${rect.y}%`,
                          width: `${rect.width}%`,
                          height: `${rect.height}%`
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          <div
            ref={nextPaneRef}
            className="portion-pane portion-pane-next"
            aria-hidden="true"
            style={{
              height: nextPortion ? `${paneLayout.nextHeight}px` : '0px',
              transform: `translateY(${paneLayout.nextTop + dragOffset}px)`,
              opacity: getPaneOpacity('next')
            }}
          >
            {nextPortion ? (
              <PortionView
                portion={nextPortion}
                settings={settings}
                annotationsByBlock={annotationsByBlock}
                hideLeadingBoundarySceneBreak={hasSceneBreakBoundary(portion, nextPortion)}
              />
            ) : null}
          </div>
        </div>
      </main>

      {selectionDraft ? (
        <div
          ref={annotationSheetRef}
          className="annotation-sheet"
          role="dialog"
          aria-label="Add annotation"
        >
          <div className="annotation-sheet-inner">
            <div className="annotation-compose-row">
              <textarea
                value={annotationNote}
                onChange={(event) => setAnnotationNote(event.target.value)}
                className="annotation-textarea"
                placeholder="Write a note..."
                rows={2}
                autoCapitalize="sentences"
                autoCorrect="on"
                spellCheck
              />
              <button
                type="button"
                className="annotation-save-button"
                aria-label="Save note"
                onClick={handleSaveAnnotation}
              >
                <BookmarkIcon />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeAnnotation ? (
        <button
          type="button"
          className="annotation-sheet-backdrop"
          aria-label="Close annotation"
          onClick={() => setActiveAnnotation(null)}
        />
      ) : null}

      {activeAnnotation ? (
        <div
          className="annotation-sheet annotation-sheet-viewer"
          role="dialog"
          aria-modal="true"
          aria-label="Annotation"
        >
          <div className="annotation-sheet-inner">
            <section className="annotation-content-block annotation-content-block-book">
              <p className="annotation-selection-preview">{activeAnnotation.selectedText}</p>
            </section>
            <section className="annotation-content-block annotation-content-block-note">
              <p className="annotation-note-copy">{activeAnnotation.note}</p>
            </section>
            <div className="annotation-actions">
              <button type="button" onClick={() => setActiveAnnotation(null)}>
                Close
              </button>
              <button
                type="button"
                className="annotation-delete-button"
                onClick={() => {
                  onDeleteAnnotation(activeAnnotation.id);
                  setActiveAnnotation(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
