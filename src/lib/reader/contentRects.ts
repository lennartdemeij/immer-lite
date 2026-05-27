import type { ReaderRectSnapshot, TextAnnotation } from '../../types/reader';

function firstTextNode(element: Element): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });

  return walker.nextNode() as Text | null;
}

function isLeafOffsetElement(element: HTMLElement): boolean {
  return !element.querySelector('[data-block-start][data-block-end]');
}

function normalizeRect(rect: DOMRect, containerRect: DOMRect): ReaderRectSnapshot | null {
  if (containerRect.width <= 0 || containerRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  return {
    x: ((rect.left - containerRect.left) / containerRect.width) * 100,
    y: ((rect.top - containerRect.top) / containerRect.height) * 100,
    width: (rect.width / containerRect.width) * 100,
    height: (rect.height / containerRect.height) * 100
  };
}

function getRangeClientRects(range: Range, container: HTMLElement): ReaderRectSnapshot[] {
  const containerRect = container.getBoundingClientRect();

  return Array.from(range.getClientRects())
    .map((rect) => normalizeRect(rect, containerRect))
    .filter((rect): rect is ReaderRectSnapshot => Boolean(rect));
}

export function captureRangeRectSnapshots(
  range: Range,
  container: HTMLElement
): ReaderRectSnapshot[] {
  return getRangeClientRects(range, container);
}

export function measureAnnotationRectSnapshots(
  container: HTMLElement,
  annotation: TextAnnotation
): ReaderRectSnapshot[] {
  const blockElement = container.querySelector<HTMLElement>(
    `.reader-block[data-block-id="${CSS.escape(annotation.blockId)}"]`
  );

  if (!blockElement) {
    return [];
  }

  const candidates = Array.from(
    blockElement.querySelectorAll<HTMLElement>('[data-block-start][data-block-end]')
  ).filter(isLeafOffsetElement);

  const snapshots: ReaderRectSnapshot[] = [];

  for (const candidate of candidates) {
    const start = Number(candidate.dataset.blockStart);
    const end = Number(candidate.dataset.blockEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    const overlapStart = Math.max(start, annotation.startOffset);
    const overlapEnd = Math.min(end, annotation.endOffset);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    const textNode = firstTextNode(candidate);
    if (!textNode) {
      continue;
    }

    const localStart = Math.max(0, overlapStart - start);
    const localEnd = Math.min(textNode.textContent?.length ?? 0, overlapEnd - start);
    if (localEnd <= localStart) {
      continue;
    }

    const range = document.createRange();
    range.setStart(textNode, localStart);
    range.setEnd(textNode, localEnd);
    snapshots.push(...getRangeClientRects(range, container));
  }

  return snapshots;
}
