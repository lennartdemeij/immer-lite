import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ViewportMetrics } from '../../types/reader';

const TOP_CHROME = 94;
const BOTTOM_CHROME = 12;
const VERTICAL_PADDING = 16;
const PORTION_EDGE_PADDING = 28;

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

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height }
      );
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const viewport = useMemo<ViewportMetrics | null>(() => {
    if (size.width === 0 || size.height === 0) {
      return null;
    }

    return {
      width: size.width,
      height: size.height,
      contentWidth: Math.max(240, size.width - horizontalPadding * 2),
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
