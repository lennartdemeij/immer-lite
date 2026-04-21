import type { BookBlock, CanonicalBook, TextBlock } from '../../types/book';
import type {
  PaginationResult,
  PortionBlock,
  ReaderAnchor,
  ReaderPortion,
  ReaderSettings,
  ViewportMetrics
} from '../../types/reader';
import {
  measureTextSlice,
  renderSentenceLineWindow,
  renderTextSlice
} from './pretextLayout';
import { getBlockTypography } from './styleMap';

interface Cursor {
  sectionIndex: number;
  blockIndex: number;
  sentenceIndex: number;
  lineOffset: number;
}

const MIN_VISIBLE_LINES = 2;

function getSection(book: CanonicalBook, sectionIndex: number) {
  return book.sections[sectionIndex];
}

function getBlock(book: CanonicalBook, cursor: Cursor): BookBlock | null {
  const section = getSection(book, cursor.sectionIndex);
  return section?.blocks[cursor.blockIndex] ?? null;
}

function nextBlockCursor(book: CanonicalBook, cursor: Cursor): Cursor | null {
  const section = getSection(book, cursor.sectionIndex);
  if (!section) {
    return null;
  }

  if (cursor.blockIndex + 1 < section.blocks.length) {
    return {
      sectionIndex: cursor.sectionIndex,
      blockIndex: cursor.blockIndex + 1,
      sentenceIndex: 0,
      lineOffset: 0
    };
  }

  if (cursor.sectionIndex + 1 < book.sections.length) {
    return {
      sectionIndex: cursor.sectionIndex + 1,
      blockIndex: 0,
      sentenceIndex: 0,
      lineOffset: 0
    };
  }

  return null;
}

function makeAnchor(block: BookBlock, sentenceIndex: number, lineOffset: number): ReaderAnchor {
  return {
    blockId: block.id,
    blockOrder: block.order,
    sentenceIndex,
    lineOffset
  };
}

function compareAnchors(a: ReaderAnchor, b: ReaderAnchor): number {
  if (a.blockOrder !== b.blockOrder) {
    return a.blockOrder - b.blockOrder;
  }
  if (a.sentenceIndex !== b.sentenceIndex) {
    return a.sentenceIndex - b.sentenceIndex;
  }
  return a.lineOffset - b.lineOffset;
}

function getFirstCursor(book: CanonicalBook): Cursor {
  return {
    sectionIndex: 0,
    blockIndex: 0,
    sentenceIndex: 0,
    lineOffset: 0
  };
}

function locateCursorByAnchor(book: CanonicalBook, anchor: ReaderAnchor): Cursor | null {
  for (let sectionIndex = 0; sectionIndex < book.sections.length; sectionIndex += 1) {
    const section = book.sections[sectionIndex];
    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex += 1) {
      const block = section.blocks[blockIndex];
      if (block.id === anchor.blockId) {
        return {
          sectionIndex,
          blockIndex,
          sentenceIndex: anchor.sentenceIndex,
          lineOffset: anchor.lineOffset
        };
      }
    }
  }
  return null;
}

function findMaxSentenceFit(
  block: TextBlock,
  startSentence: number,
  remainingHeight: number,
  viewport: ViewportMetrics,
  settings: ReaderSettings
): number {
  let low = startSentence;
  let high = block.sentences.length;
  let best = startSentence;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const measurement = measureTextSlice(
      block,
      startSentence,
      mid,
      viewport,
      settings,
      startSentence > 0,
      mid < block.sentences.length
    );

    if (measurement.height <= remainingHeight) {
      best = mid;
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return best;
}

function renderOversizedSentence(
  block: TextBlock,
  sentenceIndex: number,
  lineOffset: number,
  remainingHeight: number,
  viewport: ViewportMetrics,
  settings: ReaderSettings
): {
  rendered: PortionBlock;
  nextLineOffset: number;
  isFinished: boolean;
} {
  const typography = getBlockTypography(block.kind, settings);
  const availableHeight =
    remainingHeight -
    (lineOffset === 0 ? typography.marginTop : 0) -
    typography.marginBottom;
  const linesThatFit = Math.max(
    1,
    Math.floor(availableHeight / Math.max(typography.lineHeightPx, 1))
  );
  const safeLines = Math.max(linesThatFit, MIN_VISIBLE_LINES);
  const window = renderSentenceLineWindow(
    block,
    sentenceIndex,
    lineOffset,
    safeLines,
    viewport,
    settings
  );

  const nextOffset = lineOffset + window.visibleLines.length;
  return {
    rendered: {
      type: 'text',
      key: `${block.id}:${sentenceIndex}:line:${lineOffset}`,
      blockId: block.id,
      blockOrder: block.order,
      kind: block.kind,
      lines: window.visibleLines,
      startSentence: sentenceIndex,
      endSentence: sentenceIndex + 1,
      continuationStart: lineOffset > 0 || sentenceIndex > 0,
      continuationEnd: nextOffset < window.totalLines || sentenceIndex + 1 < block.sentences.length
    },
    nextLineOffset: nextOffset,
    isFinished: nextOffset >= window.totalLines
  };
}

async function yieldToBrowser(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function paginateBook(
  book: CanonicalBook,
  viewport: ViewportMetrics,
  settings: ReaderSettings,
  startAnchor?: ReaderAnchor
): Promise<PaginationResult> {
  const portions: ReaderPortion[] = [];
  let cursor: Cursor | null = startAnchor
    ? locateCursorByAnchor(book, startAnchor) ?? getFirstCursor(book)
    : getFirstCursor(book);
  let portionIndex = 0;
  let safety = 0;

  while (cursor) {
    safety += 1;
    if (safety > book.totalBlocks * 10_000) {
      throw new Error('Pagination stopped due to an unexpected loop.');
    }

    const section = getSection(book, cursor.sectionIndex);
    const currentBlock = getBlock(book, cursor);
    if (!section || !currentBlock) {
      break;
    }

    const portionBlocks: PortionBlock[] = [];
    const start = makeAnchor(currentBlock, cursor.sentenceIndex, cursor.lineOffset);
    let remainingHeight = viewport.contentHeight;
    let workingCursor: Cursor | null = { ...cursor };
    let lastAnchor = start;

    while (workingCursor) {
      if (workingCursor.sectionIndex !== cursor.sectionIndex && portionBlocks.length > 0) {
        break;
      }

      const block = getBlock(book, workingCursor);
      if (!block) {
        break;
      }

      if (block.kind === 'scene-break') {
        const typography = getBlockTypography(block.kind, settings);
        const needed = typography.marginTop + typography.marginBottom + settings.fontSize;
        if (portionBlocks.length > 0 && needed > remainingHeight) {
          break;
        }

        portionBlocks.push({
          type: 'scene-break',
          key: block.id,
          blockId: block.id
        });
        remainingHeight -= needed;
        lastAnchor = makeAnchor(block, 0, 0);
        workingCursor = nextBlockCursor(book, workingCursor);
        continue;
      }

      if (block.kind === 'image') {
        const typography = getBlockTypography(block.kind, settings);
        const maxHeight = Math.min(
          viewport.contentHeight * typography.imageMaxHeightRatio,
          remainingHeight - typography.marginTop - typography.marginBottom
        );
        if (maxHeight < 120 && portionBlocks.length > 0) {
          break;
        }

        portionBlocks.push({
          type: 'image',
          key: block.id,
          blockId: block.id,
          src: block.src,
          alt: block.alt,
          caption: block.caption
        });
        remainingHeight -= Math.max(120, maxHeight) + typography.marginTop + typography.marginBottom;
        lastAnchor = makeAnchor(block, 0, 0);
        workingCursor = nextBlockCursor(book, workingCursor);
        continue;
      }

      const textBlock = block as TextBlock;
      if (workingCursor.lineOffset > 0) {
        const oversized = renderOversizedSentence(
          textBlock,
          workingCursor.sentenceIndex,
          workingCursor.lineOffset,
          remainingHeight,
          viewport,
          settings
        );
        portionBlocks.push(oversized.rendered);
        remainingHeight -=
          oversized.rendered.type === 'text'
            ? oversized.rendered.lines.length *
              getBlockTypography(block.kind, settings).lineHeightPx
            : 0;
        lastAnchor = makeAnchor(textBlock, textBlock.sentences[workingCursor.sentenceIndex].index, oversized.nextLineOffset);
        if (oversized.isFinished) {
          if (workingCursor.sentenceIndex + 1 < textBlock.sentences.length) {
            workingCursor = {
              ...workingCursor,
              sentenceIndex: workingCursor.sentenceIndex + 1,
              lineOffset: 0
            };
          } else {
            workingCursor = nextBlockCursor(book, workingCursor);
          }
        } else {
          workingCursor = {
            ...workingCursor,
            lineOffset: oversized.nextLineOffset
          };
          break;
        }
        continue;
      }

      const maxSentence = findMaxSentenceFit(
        textBlock,
        workingCursor.sentenceIndex,
        remainingHeight,
        viewport,
        settings
      );

      if (maxSentence > workingCursor.sentenceIndex) {
        const continuationEnd = maxSentence < textBlock.sentences.length;
        const rendered = renderTextSlice(
          textBlock,
          workingCursor.sentenceIndex,
          maxSentence,
          viewport,
          settings,
          workingCursor.sentenceIndex > 0,
          continuationEnd
        );
        const measurement = measureTextSlice(
          textBlock,
          workingCursor.sentenceIndex,
          maxSentence,
          viewport,
          settings,
          workingCursor.sentenceIndex > 0,
          continuationEnd
        );
        portionBlocks.push(rendered);
        remainingHeight -= measurement.height;
        lastAnchor = makeAnchor(textBlock, maxSentence - 1, 0);
        if (maxSentence < textBlock.sentences.length) {
          workingCursor = {
            ...workingCursor,
            sentenceIndex: maxSentence,
            lineOffset: 0
          };
          continue;
        }

        workingCursor = nextBlockCursor(book, workingCursor);
        continue;
      }

      const singleSentenceMeasurement = measureTextSlice(
        textBlock,
        workingCursor.sentenceIndex,
        workingCursor.sentenceIndex + 1,
        viewport,
        settings,
        workingCursor.sentenceIndex > 0,
        workingCursor.sentenceIndex + 1 < textBlock.sentences.length
      );

      if (
        portionBlocks.length > 0 &&
        singleSentenceMeasurement.height <= viewport.contentHeight
      ) {
        break;
      }

      const oversized = renderOversizedSentence(
        textBlock,
        workingCursor.sentenceIndex,
        0,
        remainingHeight,
        viewport,
        settings
      );
      portionBlocks.push(oversized.rendered);
      remainingHeight = 0;
      lastAnchor = makeAnchor(textBlock, workingCursor.sentenceIndex, oversized.nextLineOffset);
      workingCursor = oversized.isFinished
        ? workingCursor.sentenceIndex + 1 < textBlock.sentences.length
          ? {
              ...workingCursor,
              sentenceIndex: workingCursor.sentenceIndex + 1,
              lineOffset: 0
            }
          : nextBlockCursor(book, workingCursor)
        : {
            ...workingCursor,
            lineOffset: oversized.nextLineOffset
          };
      break;
    }

    portions.push({
      id: `portion-${portionIndex}`,
      index: portionIndex,
      sectionId: section.id,
      sectionLabel: section.label,
      start,
      end: lastAnchor,
      blocks: portionBlocks
    });

    portionIndex += 1;
    cursor = workingCursor;
    if (portionIndex % 24 === 0) {
      await yieldToBrowser();
    }
  }

  return { portions };
}

export function findPortionIndexForAnchor(
  portions: ReaderPortion[],
  anchor: ReaderAnchor
): number {
  for (let index = 0; index < portions.length; index += 1) {
    const portion = portions[index];
    if (compareAnchors(portion.start, anchor) <= 0 && compareAnchors(portion.end, anchor) >= 0) {
      return index;
    }
  }

  let closest = 0;
  for (let index = 0; index < portions.length; index += 1) {
    if (compareAnchors(portions[index].start, anchor) <= 0) {
      closest = index;
      continue;
    }
    break;
  }
  return closest;
}
