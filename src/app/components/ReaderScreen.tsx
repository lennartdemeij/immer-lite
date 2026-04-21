import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CanonicalBook } from '../../types/book';
import type {
  PortionBlock,
  ReaderPortion,
  ReaderSettings,
  TextAnnotation,
  ViewportMetrics
} from '../../types/reader';
import { PortionView } from './PortionView';
import { SettingsPanel } from './SettingsPanel';
import { READER_CHROME } from '../hooks/useReaderViewport';
import { findPortionIndexForAnchor } from '../../lib/portioning/paginateBook';

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

interface SelectionDraft {
  blockId: string;
  blockOrder: number;
  startOffset: number;
  endOffset: number;
  sentenceIndex: number;
  selectedText: string;
}

const TAP_TOLERANCE = 10;
const SNAP_THRESHOLD_RATIO = 0.18;
const SNAP_THRESHOLD_PX = 84;
const SNAP_ANIMATION_MS = 240;
const CHAPTER_TRACK_PADDING_PX = 6;
const CHAPTER_TRACK_GAP_PX = 6;
const LONG_PRESS_MS = 320;
const SELECTION_SETTLE_MS = 260;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function makeAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function hasContinuationBridge(from: ReaderPortion | null, to: ReaderPortion | null): boolean {
  const fromBlock = getLastTextBlock(from);
  const toBlock = getFirstTextBlock(to);

  if (!fromBlock || !toBlock) {
    return false;
  }

  return (
    fromBlock.continuationEnd &&
    toBlock.continuationStart &&
    fromBlock.blockId === toBlock.blockId
  );
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

function ContinuationBridgeShell({
  visible,
  style,
  transitioning
}: {
  visible: boolean;
  style: CSSProperties | null;
  transitioning?: boolean;
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
      <ContinuationBridge />
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
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [annotationNote, setAnnotationNote] = useState('');
  const [activeAnnotation, setActiveAnnotation] = useState<TextAnnotation | null>(null);
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
  const snapTimeoutRef = useRef<number | null>(null);
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

  function readSelectionDraftFromDom(): SelectionDraft | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const currentPane = currentPaneRef.current;
    if (!currentPane) {
      return null;
    }

    const commonAncestor =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    const blockElement = commonAncestor?.closest<HTMLElement>('.reader-block[data-block-id]');
    if (!blockElement || !currentPane.contains(blockElement)) {
      return null;
    }

    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const startFragment = startElement?.closest<HTMLElement>('[data-block-start][data-block-end]');
    const endFragment = endElement?.closest<HTMLElement>('[data-block-start][data-block-end]');
    if (!startFragment || !endFragment) {
      return null;
    }

    const startBase = Number(startFragment.dataset.blockStart);
    const endBase = Number(endFragment.dataset.blockStart);
    if (!Number.isFinite(startBase) || !Number.isFinite(endBase)) {
      return null;
    }

    const startOffset = clamp(
      startBase + range.startOffset,
      Number(startFragment.dataset.blockStart),
      Number(startFragment.dataset.blockEnd)
    );
    const endOffset = clamp(
      endBase + range.endOffset,
      Number(endFragment.dataset.blockStart),
      Number(endFragment.dataset.blockEnd)
    );

    const normalizedStart = Math.min(startOffset, endOffset);
    const normalizedEnd = Math.max(startOffset, endOffset);
    const selectedText = selection.toString().trim();
    if (!selectedText || normalizedEnd <= normalizedStart) {
      return null;
    }

    let sentenceIndex = Number(blockElement.dataset.startSentence ?? 0);
    const matchedBlock = book.sections
      .flatMap((section) => section.blocks)
      .find(
        (block): block is Extract<typeof block, { kind: 'heading' | 'paragraph' | 'quote' | 'list-item' }> =>
          (block.kind === 'heading' ||
            block.kind === 'paragraph' ||
            block.kind === 'quote' ||
            block.kind === 'list-item') &&
          block.id === blockElement.dataset.blockId
      );
    if (matchedBlock) {
      for (const sentence of matchedBlock.sentences) {
        if (sentence.startOffset <= normalizedStart) {
          sentenceIndex = sentence.index;
        } else {
          break;
        }
      }
    }

    return {
      blockId: blockElement.dataset.blockId ?? '',
      blockOrder: Number(blockElement.dataset.blockOrder ?? 0),
      startOffset: normalizedStart,
      endOffset: normalizedEnd,
      sentenceIndex,
      selectedText
    };
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
  const focusedSectionId = portions[focusedPortionIndex]?.sectionId ?? portion?.sectionId ?? null;
  const annotationsByBlock = useMemo(() => {
    const next = new Map<string, TextAnnotation[]>();
    annotations.forEach((annotation) => {
      const entries = next.get(annotation.blockId) ?? [];
      entries.push(annotation);
      next.set(annotation.blockId, entries);
    });
    return next;
  }, [annotations]);
  const annotationPortionIndexes = useMemo(() => {
    const next = new Set<number>();
    annotations.forEach((annotation) => {
      const index = findPortionIndexForAnchor(portions, {
        blockId: annotation.blockId,
        blockOrder: annotation.blockOrder,
        sentenceIndex: annotation.sentenceIndex,
        lineOffset: 0
      });
      next.add(index);
    });
    return next;
  }, [annotations, portions]);
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
  const continuationStyles = useMemo(() => {
    const stageWidth = stageRef.current?.clientWidth ?? viewport?.width ?? 0;
    if (stageHeight <= 0 || stageWidth <= 0 || !portion) {
      return {
        incomingCurrent: null,
        outgoingCurrent: null,
        activeForwardBridge: null,
        activeBackwardBridge: null
      };
    }

    const draggingForward = isDragging && dragOffset < 0;
    const draggingBackward = isDragging && dragOffset > 0;
    const animatingForward = transitionEnabled && snapDirection === 'forward';
    const animatingBackward = transitionEnabled && snapDirection === 'backward';
    const bridgeHalfWidth = 20;
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

    const incomingCurrent =
      getFirstTextBlock(portion)?.continuationStart && !(draggingBackward || animatingBackward)
        ? topLeftStyle(currentSheet)
        : null;
    const outgoingCurrent =
      getLastTextBlock(portion)?.continuationEnd && !(draggingForward || animatingForward)
        ? bottomRightStyle(currentSheet)
        : null;

    const activeForwardBridge =
      (draggingForward || animatingForward) &&
      hasContinuationBridge(portion, nextPortion) &&
      currentSheet &&
      nextSheet
        ? interpolate(
            {
              x: currentSheet.right - bridgeHalfWidth,
              y: currentSheet.bottom - markerInsetY
            },
            {
              x: nextSheet.left + bridgeHalfWidth,
              y: nextSheet.top + markerInsetY
            },
            forwardProgress
          )
        : null;
    const activeBackwardBridge =
      (draggingBackward || animatingBackward) &&
      hasContinuationBridge(previousPortion, portion) &&
      previousSheet &&
      currentSheet
        ? interpolate(
            {
              x: currentSheet.left + bridgeHalfWidth,
              y: currentSheet.top + markerInsetY
            },
            {
              x: previousSheet.right - bridgeHalfWidth,
              y: previousSheet.bottom - markerInsetY
            },
            backwardProgress
          )
        : null;

    return {
      incomingCurrent,
      outgoingCurrent,
      activeForwardBridge,
      activeBackwardBridge
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
    let matchingSegment = chapterTrackMetrics.find((segment) => {
      const start = segment.topPx;
      const end = segment.topPx + segment.heightPx;
      return localY >= start && localY <= end;
    });

    if (!matchingSegment) {
      if (localY <= chapterTrackMetrics[0].topPx) {
        matchingSegment = chapterTrackMetrics[0];
      } else {
        for (let index = 0; index < chapterTrackMetrics.length - 1; index += 1) {
          const current = chapterTrackMetrics[index];
          const next = chapterTrackMetrics[index + 1];
          const currentEnd = current.topPx + current.heightPx;

          if (localY >= currentEnd && localY <= next.topPx) {
            const midpoint = (currentEnd + next.topPx) / 2;
            matchingSegment = localY <= midpoint ? current : next;
            break;
          }
        }
      }

      if (!matchingSegment) {
        matchingSegment = chapterTrackMetrics[chapterTrackMetrics.length - 1];
      }
    }

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

  function handleSaveAnnotation() {
    if (!selectionDraft || !annotationNote.trim()) {
      return;
    }

    onSaveAnnotation({
      id: makeAnnotationId(),
      fingerprint: book.fingerprint,
      blockId: selectionDraft.blockId,
      blockOrder: selectionDraft.blockOrder,
      startOffset: selectionDraft.startOffset,
      endOffset: selectionDraft.endOffset,
      sentenceIndex: selectionDraft.sentenceIndex,
      selectedText: selectionDraft.selectedText,
      note: annotationNote.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
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
    if (
      event.target !== currentPaneRef.current ||
      event.propertyName !== 'transform'
    ) {
      return;
    }

    if (!snapDirection) {
      setTransitionEnabled(false);
      return;
    }

    const direction = snapDirection;
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
          {Array.from(annotationPortionIndexes).map((index) => {
            const segment = chapterTrackMetrics.find(
              (entry) => index >= entry.start && index <= entry.end
            );
            if (!segment) {
              return null;
            }

            const localRatio =
              segment.portionCount <= 0
                ? 0.5
                : (index - segment.start + 0.5) / segment.portionCount;
            return (
              <div
                key={`annotation-marker-${index}`}
                className="chapter-progress-annotation"
                style={{ top: `${segment.topPx + segment.heightPx * localRatio}px` }}
                aria-hidden="true"
              />
            );
          })}
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
          '--portion-width': viewport ? `${viewport.contentWidth}px` : '100%',
          '--portion-edge-padding': `${READER_CHROME.portionEdgePadding}px`,
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
          visible={Boolean(continuationStyles.incomingCurrent)}
          style={continuationStyles.incomingCurrent}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.outgoingCurrent)}
          style={continuationStyles.outgoingCurrent}
        />
        <ContinuationBridgeShell
          visible={Boolean(continuationStyles.activeForwardBridge)}
          style={continuationStyles.activeForwardBridge}
          transitioning={transitionEnabled}
        />
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
              <PortionView
                portion={portion}
                settings={settings}
                annotationsByBlock={annotationsByBlock}
                onAnnotationPress={handleAnnotationPress}
              />
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
        <div className="annotation-sheet annotation-sheet-viewer" role="dialog" aria-label="Annotation">
          <div className="annotation-sheet-inner">
            <p className="annotation-selection-preview">{activeAnnotation.selectedText}</p>
            <p className="annotation-note-copy">{activeAnnotation.note}</p>
            <div className="annotation-actions">
              <button type="button" onClick={() => setActiveAnnotation(null)}>
                Close
              </button>
              <button
                type="button"
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
