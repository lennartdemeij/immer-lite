import type { CanonicalBook, TextBlock } from '../../types/book';
import type { AnnotationSelection, ReaderRectSnapshot } from '../../types/reader';

interface ReadAnnotationSelectionOptions {
  range: Range;
  scope: HTMLElement;
  book: CanonicalBook;
  captureRects: (range: Range, scope: HTMLElement) => ReaderRectSnapshot[];
}

function textBlockForId(book: CanonicalBook, blockId: string): TextBlock | null {
  for (const section of book.sections) {
    const block = section.blocks.find(
      (candidate): candidate is TextBlock =>
        candidate.id === blockId &&
        (candidate.kind === 'heading' ||
          candidate.kind === 'paragraph' ||
          candidate.kind === 'quote' ||
          candidate.kind === 'list-item')
    );
    if (block) {
      return block;
    }
  }

  return null;
}

function getTextOffsetWithin(
  fragment: HTMLElement,
  container: Node,
  offset: number,
  fallback: number
): number {
  const fragmentRange = document.createRange();
  fragmentRange.selectNodeContents(fragment);

  try {
    const position = fragmentRange.comparePoint(container, offset);
    if (position < 0) {
      return 0;
    }
    if (position > 0) {
      return fragment.textContent?.length ?? 0;
    }

    const prefix = document.createRange();
    prefix.selectNodeContents(fragment);
    prefix.setEnd(container, offset);
    return prefix.toString().length;
  } catch {
    return fallback;
  }
}

function sentenceIndexForOffset(block: TextBlock, offset: number): number {
  let index = block.sentences[0]?.index ?? 0;
  for (const sentence of block.sentences) {
    if (sentence.startOffset <= offset) {
      index = sentence.index;
    } else {
      break;
    }
  }
  return index;
}

/** Hit-test without installing a browser Selection (which opens Android Search). */
export function readTouchWord(scope: HTMLElement, book: CanonicalBook, x: number, y: number) {
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = caretDocument.caretPositionFromPoint?.(x, y);
  const caret = position ? null : caretDocument.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? caret?.startContainer;
  const offset = position?.offset ?? caret?.startOffset;
  if (!node || offset === undefined || !scope.contains(node)) {
    return null;
  }
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  const fragment = element?.closest<HTMLElement>('[data-block-start][data-block-end]');
  const blockElement = fragment?.closest<HTMLElement>('.reader-block[data-block-id]');
  const blockId = blockElement?.dataset.blockId;
  const block = blockId ? textBlockForId(book, blockId) : null;
  if (!fragment || !block || !blockId) {
    return null;
  }
  const canonicalOffset = Number(fragment.dataset.blockStart) + getTextOffsetWithin(fragment, node, offset, 0);
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(book.metadata.language, { granularity: 'word' });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  for (const segment of segmenter.segment(block.text)) {
    if (segment.isWordLike && canonicalOffset >= segment.index && canonicalOffset <= segment.index + segment.segment.length) {
      const fragments = Array.from(blockElement!.querySelectorAll<HTMLElement>('[data-block-start][data-block-end]'));
      // An oversized sentence can split a word across portions. Select only
      // the part rendered in this pane, so both handles stay reachable.
      return {
        blockId,
        start: Math.max(segment.index, Number(fragments[0].dataset.blockStart)),
        end: Math.min(segment.index + segment.segment.length, Number(fragments.at(-1)!.dataset.blockEnd))
      };
    }
  }
  return null;
}

export function createAnnotationRange(scope: HTMLElement, blockId: string, start: number, end: number): Range | null {
  const fragments = Array.from(scope.querySelectorAll<HTMLElement>('[data-block-start][data-block-end]'))
    .filter((fragment) => !fragment.querySelector('[data-block-start][data-block-end]') &&
      fragment.closest<HTMLElement>('.reader-block[data-block-id]')?.dataset.blockId === blockId);
  const range = document.createRange();
  let hasStart = false;
  for (const fragment of fragments) {
    const fragmentStart = Number(fragment.dataset.blockStart);
    const fragmentEnd = Number(fragment.dataset.blockEnd);
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!node) continue;
    const length = node.textContent?.length ?? 0;
    if (!hasStart && start >= fragmentStart && start < fragmentEnd) {
      range.setStart(node, Math.min(start - fragmentStart, length));
      hasStart = true;
    }
    if (hasStart && end > fragmentStart && end <= fragmentEnd) {
      range.setEnd(node, Math.min(end - fragmentStart, length));
      return range.collapsed ? null : range;
    }
  }
  return null;
}

/**
 * Converts the browser's DOM selection into canonical text offsets. Selection
 * endpoints may be text nodes or line wrapper elements, so offsets are derived
 * from the selected fragment ranges instead of trusting Range offsets directly.
 */
export function readAnnotationSelection({
  range,
  scope,
  book,
  captureRects
}: ReadAnnotationSelectionOptions): AnnotationSelection | null {
  const fragments = Array.from(
    scope.querySelectorAll<HTMLElement>('[data-block-start][data-block-end]')
  ).filter(
    (fragment) =>
      !fragment.querySelector('[data-block-start][data-block-end]') && range.intersectsNode(fragment)
  );

  if (fragments.length === 0) {
    return null;
  }

  const firstFragment = fragments[0];
  const lastFragment = fragments[fragments.length - 1];
  const blockElement = firstFragment.closest<HTMLElement>('.reader-block[data-block-id]');
  const lastBlockElement = lastFragment.closest<HTMLElement>('.reader-block[data-block-id]');
  const blockId = blockElement?.dataset.blockId;

  if (!blockElement || !lastBlockElement || blockElement !== lastBlockElement || !blockId) {
    return null;
  }

  const block = textBlockForId(book, blockId);
  const firstStart = Number(firstFragment.dataset.blockStart);
  const firstEnd = Number(firstFragment.dataset.blockEnd);
  const lastStart = Number(lastFragment.dataset.blockStart);
  const lastEnd = Number(lastFragment.dataset.blockEnd);
  if (![firstStart, firstEnd, lastStart, lastEnd].every(Number.isFinite)) {
    return null;
  }

  const startOffset = Math.min(
    firstEnd,
    Math.max(
      firstStart,
      firstStart +
        getTextOffsetWithin(firstFragment, range.startContainer, range.startOffset, 0)
    )
  );
  const endOffset = Math.min(
    lastEnd,
    Math.max(
      lastStart,
      lastStart +
        getTextOffsetWithin(lastFragment, range.endContainer, range.endOffset, lastEnd - lastStart)
    )
  );

  if (!block || endOffset <= startOffset) {
    return null;
  }

  return {
    blockId,
    blockOrder: block.order,
    startOffset,
    endOffset,
    sentenceIndex: sentenceIndexForOffset(block, startOffset),
    selectedText: block.text.slice(startOffset, endOffset),
    rects: captureRects(range, scope)
  };
}
