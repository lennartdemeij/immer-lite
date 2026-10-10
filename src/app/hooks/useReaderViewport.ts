import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ViewportMetrics } from '../../types/reader';

const TOP_CHROME = 94;
const BOTTOM_CHROME = 12;
const VERTICAL_PADDING = 16;
const PORTION_EDGE_PADDING = 28;
const CHAPTER_NAVIGATOR_GUTTER = 76;
const MOBILE_CHAPTER_NAVIGATOR_GUTTER = 56;
const TEXT_WIDTH_BOOST = 48;

function getChapterNavigatorGutter(width: number): number {
  return width <= 720 ? MOBILE_CHAPTER_NAVIGATOR_GUTTER : CHAPTER_NAVIGATOR_GUTTER;
}

export function useReaderViewport(horizontalPadding: number) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const containerRef = useCallback((next: HTMLDivElement | null) => {
    setNode(next);
  }, []);

  useEffect(() => {
    if (!node) {
      return;
    }

    let measuredSize = { width: 0, height: 0 };
    let editingSize: typeof measuredSize | null = null;
    let keyboardResized = false;
    const isEditor = (target: EventTarget | null) => target instanceof Element &&
      node.contains(target) && target.matches('textarea, input:not([type="checkbox"]):not([type="range"]):not([type="file"]), [contenteditable="true"]');
    const startEditing = (event: FocusEvent) => {
      if (!isEditor(event.target) || !window.matchMedia('(pointer: coarse)').matches || editingSize) return;
      editingSize = measuredSize;
      keyboardResized = false;
    };
    const stopEditing = (event: FocusEvent) => {
      // Keep the full height until the keyboard has finished closing after Save
      // removes the editor. Intermediate sizes must not repaginate the book.
      if (!isEditor(event.relatedTarget) && !keyboardResized) editingSize = null;
    };
    node.addEventListener('focusin', startEditing);
    node.addEventListener('focusout', stopEditing);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (editingSize && width === editingSize.width && height < editingSize.height) {
        keyboardResized = true;
        return;
      }
      if (editingSize && (width !== editingSize.width || !isEditor(document.activeElement))) {
        editingSize = null;
        keyboardResized = false;
      }
      measuredSize = { width, height };
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      );
    });

    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeEventListener('focusin', startEditing);
      node.removeEventListener('focusout', stopEditing);
    };
  }, [node]);

  const viewport = useMemo<ViewportMetrics | null>(() => {
    if (size.width === 0 || size.height === 0) {
      return null;
    }

    return {
      width: size.width,
      height: size.height,
      contentWidth: Math.min(700, Math.max(
        240,
        size.width -
          horizontalPadding * 2 -
          getChapterNavigatorGutter(size.width) +
          TEXT_WIDTH_BOOST
      )),
      contentHeight: Math.max(
        200,
        size.height - TOP_CHROME - BOTTOM_CHROME - VERTICAL_PADDING * 2 - PORTION_EDGE_PADDING * 2
      )
    };
  }, [horizontalPadding, size.height, size.width]);

  return {
    containerRef,
    viewport
  };
}

export const READER_CHROME = {
  top: TOP_CHROME,
  bottom: BOTTOM_CHROME,
  verticalPadding: VERTICAL_PADDING,
  portionEdgePadding: PORTION_EDGE_PADDING
};
