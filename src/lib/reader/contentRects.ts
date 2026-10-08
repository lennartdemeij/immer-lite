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
  const root = range.commonAncestorContainer;
  const nodes: Node[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push(root);
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (range.intersectsNode(node)) nodes.push(node);
    }
  }

  // Measuring the entire range also returns boxes for selected wrappers,
  // which overlap their text boxes. Measure only the clipped text nodes.
  const rects = nodes.flatMap((node) => {
    const textRange = document.createRange();
    textRange.setStart(node, range.startContainer === node ? range.startOffset : 0);
    textRange.setEnd(node, range.endContainer === node ? range.endOffset : node.textContent?.length ?? 0);
    return textRange.collapsed ? [] : Array.from(textRange.getClientRects());
  }).filter((rect) => rect.width > 0 && rect.height > 0);
  const lines: DOMRect[] = [];
  for (const rect of rects) {
    const line = lines.find((candidate) =>
      Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top) >=
        Math.min(candidate.height, rect.height) * 0.8 &&
      rect.left <= candidate.right + 1 && rect.right >= candidate.left - 1
    );
    if (line) {
      const right = Math.max(line.right, rect.right);
      const bottom = Math.max(line.bottom, rect.bottom);
      line.x = Math.min(line.x, rect.x);
      line.y = Math.min(line.y, rect.y);
      line.width = right - line.x;
      line.height = bottom - line.y;
    } else {
      lines.push(new DOMRect(rect.x, rect.y, rect.width, rect.height));
    }
  }

  return lines
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
