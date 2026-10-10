import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import { createTextPortionIndex, findTextPortionIndex } from '../../lib/reader/search';
import { getNavigatorChapters, layoutNavigator, navigatorIndexAt, navigatorPosition, type NavigatorMode } from '../../lib/reader/navigatorLayout';

interface BookNavigatorProps {
  portions: ReaderPortion[];
  annotations: TextAnnotation[];
  focusedIndex: number;
  coverUrl?: string;
  expanded: boolean;
  side: 'left' | 'right';
  disabled: boolean;
  navigatorRef: RefObject<HTMLElement>;
  onJump: (index: number) => void;
  onNote: (annotation: TextAnnotation) => void;
  onOpen: () => void;
  onDragging: (dragging: boolean) => void;
  onTilt: (tilt: { rotateY: number; rotateZ: number; originY: number }) => void;
}

const modes: Array<{ mode: NavigatorMode; label: string; path: string }> = [
  { mode: 'portions', label: 'Portions', path: 'M8 3v6m0 3v9M16 3v18M5 12h14' },
  { mode: 'book', label: 'Book', path: 'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15' },
  { mode: 'chapters', label: 'Chapters', path: 'M4 5h2m4 0h10M4 12h2m4 0h10M4 19h2m4 0h10' },
  { mode: 'notes', label: 'Notes', path: 'M6 3h12v18l-6-4-6 4z' }
];

export const BookNavigator = memo(function BookNavigator({ portions, annotations, focusedIndex, coverUrl, expanded, side, disabled,
  navigatorRef, onJump, onNote, onOpen, onDragging, onTilt }: BookNavigatorProps) {
  const [selectedMode, setSelectedMode] = useState<NavigatorMode>('portions');
  const viewportRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; offset: number; index: number; mode: NavigatorMode } | null>(null);
  const mode = drag.current?.mode ?? (expanded ? selectedMode : 'portions');
  const chapters = useMemo(() => getNavigatorChapters(portions), [portions]);
  const notes = useMemo(() => {
    const index = createTextPortionIndex(portions);
    return annotations.map(annotation => ({ annotation,
      index: findTextPortionIndex(index, annotation.blockId, annotation.startOffset)
    })).filter(note => note.index >= 0);
  }, [annotations, portions]);
  const layout = useMemo(() => layoutNavigator(chapters, notes, mode, height, Boolean(coverUrl)), [chapters, notes, mode, height, coverUrl]);
  const position = navigatorPosition(layout.groups, focusedIndex, mode);
  const offset = mode === 'portions' ? dragOffset ?? height / 2 - position : 0;
  const scrollable = mode === 'chapters' || mode === 'notes';
  const activeChapter = layout.groups.find(group => focusedIndex >= group.start && focusedIndex <= group.end);

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setHeight(node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    setDragOffset(null);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [mode]);

  useEffect(() => {
    if (!disabled) return;
    drag.current = null;
    setDragOffset(null);
    onDragging(false);
    onTilt({ rotateY: 0, rotateZ: 0, originY: 50 });
  }, [disabled, onDragging, onTilt]);

  function jumpAt(y: number) {
    const index = navigatorIndexAt(layout.groups, y, mode);
    if (index == null || index === drag.current?.index) return;
    if (drag.current) drag.current.index = index;
    window.navigator.vibrate?.(20);
    onJump(index);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || !portions.length) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, offset, index: focusedIndex, mode };
    event.currentTarget.setPointerCapture(event.pointerId);
    onDragging(true);
    if (mode !== 'portions') jumpAt(event.clientY - viewportRef.current!.getBoundingClientRect().top + viewportRef.current!.scrollTop);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    const delta = event.clientY - gesture.startY;
    gesture.moved ||= Math.hypot(event.clientX - gesture.startX, delta) > 6;
    if (!gesture.moved) return;
    if (mode === 'portions') {
      const nextOffset = gesture.offset + delta;
      setDragOffset(nextOffset);
      jumpAt(height / 2 - nextOffset);
    } else jumpAt(event.clientY - viewportRef.current!.getBoundingClientRect().top + viewportRef.current!.scrollTop);
    onTilt({ rotateY: side === 'left' ? -25 : 25,
      rotateZ: Math.max(-7, Math.min(7, delta / 14)) * (side === 'left' ? -1 : 1),
      originY: Math.max(12, Math.min(88, event.clientY / window.innerHeight * 100)) });
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== 'pointercancel') pointerMove(event);
    const tapped = event.type !== 'pointercancel' && !drag.current.moved;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    setDragOffset(null);
    onDragging(false);
    if (tapped) onOpen();
    onTilt({ rotateY: 0, rotateZ: 0, originY: 50 });
  }

  const chapterLabels: Array<{ id: string; y: number }> = [];
  if (mode !== 'notes') {
    const prioritized = [...layout.groups].sort((a, b) => Number(b === activeChapter) - Number(a === activeChapter));
    prioritized.forEach(group => {
      const y = mode === 'portions' && group === activeChapter ? position : group.top + group.height / 2;
      if (mode === 'chapters' || (y + offset >= (mode === 'portions' ? 80 : 18) && y + offset < height - (mode === 'portions' ? 88 : 18) &&
        chapterLabels.every(label => Math.abs(label.y - y) >= 40))) chapterLabels.push({ id: group.id, y });
    });
  }
  const noteLabels: Array<{ id: string; y: number }> = [];
  if (mode === 'notes' || mode === 'portions') {
    layout.groups.flatMap(group => group.notes).forEach(note => {
      const y = [note.y, note.y + 34, note.y - 34].find(y => mode === 'notes' || (y + offset >= 80 && y + offset < height - 88 &&
        chapterLabels.every(label => Math.abs(label.y - y) >= 34) && noteLabels.every(label => Math.abs(label.y - y) >= 32)));
      if (y != null) noteLabels.push({ id: note.annotation.id, y });
    });
  }

  return (
    <aside ref={navigatorRef} className={`book-navigator side-${side}${expanded ? ' expanded' : ''} mode-${mode}${drag.current ? ' dragging' : ''}`}
      aria-label="Reading progress by chapter" onContextMenu={event => event.preventDefault()}>
      {expanded ? <div className="navigator-modes" role="group" aria-label="Book navigator view">
        {modes.map(item => <button key={item.mode} type="button" aria-pressed={selectedMode === item.mode}
          aria-label={`${item.label} view`} title={item.label} onClick={() => setSelectedMode(item.mode)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg>
          <span>{item.label}</span>
        </button>)}
      </div> : null}
      <div className="navigator-rail-hitarea" aria-disabled={disabled} onPointerDown={pointerDown}
        onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} />
      <div ref={viewportRef} className={`navigator-viewport${scrollable ? ' scrollable' : ''}`}>
        <div className="navigator-content" style={{ height: `${layout.height}px`, transform: `translateY(${offset}px)` }}>
          {coverUrl ? <img src={coverUrl} alt="" draggable={false} className="navigator-cover"
            style={{ opacity: expanded && mode !== 'notes' ? 1 : 0 }} /> : null}
          {layout.groups.map(group => {
            const progress = Math.max(0, Math.min(1, (focusedIndex - group.start + 0.5) / (group.end - group.start + 1)));
            const label = chapterLabels.find(label => label.id === group.id);
            const visible = mode !== 'notes' || group.notes.length > 0;
            return <div key={group.id} className={`navigator-chapter${group === activeChapter ? ' active' : ''}`}
              style={{ transform: `translateY(${group.top}px)`, opacity: visible ? 1 : 0 }}>
              <div className="navigator-chapter-bar" style={{ transform: `scaleY(${group.height})`,
                background: `linear-gradient(to bottom, var(--navigator-completed) ${progress * 100}%, var(--navigator-upcoming) ${progress * 100}%)` }} />
              <button type="button" className={`navigator-chapter-label${label && expanded ? ' visible' : ''}`}
                style={{ transform: `translateY(${(label?.y ?? group.top + group.height / 2) - group.top}px) translateY(-50%)` }}
                disabled={disabled} tabIndex={label && expanded ? 0 : -1} aria-hidden={!label || !expanded}
                aria-label={`Go to ${group.label}`} title={group.label} onClick={() => onJump(group.start)}>{group.label}</button>
              {group.notes.map(note => {
                const label = noteLabels.find(label => label.id === note.annotation.id);
                return <div key={note.annotation.id} className="navigator-note" style={{ transform: `translateY(${(label?.y ?? note.y) - group.top}px)` }}>
                  <span className="navigator-note-marker" />
                  <button type="button" className={`navigator-note-label${label && expanded ? ' visible' : ''}`}
                    tabIndex={label && expanded ? 0 : -1} aria-hidden={!label || !expanded} disabled={disabled}
                    aria-label={`Open note: ${note.annotation.note}`} title={note.annotation.note}
                    onClick={() => { onJump(note.index); onNote(note.annotation); }}>
                    <img className="navigator-note-avatar" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
                    <span>{note.annotation.note}</span>
                  </button>
                </div>;
              })}
            </div>;
          })}
          {mode !== 'notes' || notes.some(note => note.index === focusedIndex) ? <div className="navigator-current-marker" style={{ transform: `translateY(${position}px)` }} aria-hidden="true" /> : null}
          {mode === 'notes' && !notes.length ? <p className="navigator-empty">No notes yet</p> : null}
        </div>
      </div>
    </aside>
  );
});
