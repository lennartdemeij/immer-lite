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
