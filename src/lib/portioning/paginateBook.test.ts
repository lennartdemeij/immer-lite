import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBook, TextBlock } from '../../types/book';
import type { ReaderSettings, ViewportMetrics } from '../../types/reader';

vi.mock('./pretextLayout', () => ({
  measureTextSlice: vi.fn(
    (
      block: TextBlock,
      startSentence: number,
      endSentence: number,
      _viewport: ViewportMetrics,
      _settings: ReaderSettings
    ) => {
      const sentenceCount = endSentence - startSentence;
      const isOversized = block.id.includes('oversized');
      return {
        height: isOversized ? 420 : sentenceCount * 90,
        lineCount: isOversized ? 5 : sentenceCount * 2,
        slice: { items: [], meta: [] }
      };
    }
  ),
  renderTextSlice: vi.fn(
    (
      block: TextBlock,
      startSentence: number,
      endSentence: number,
      _viewport: ViewportMetrics,
      _settings: ReaderSettings,
      continuationStart: boolean,
      continuationEnd: boolean
    ) => ({
      type: 'text' as const,
      key: `${block.id}:${startSentence}-${endSentence}`,
      blockId: block.id,
      kind: block.kind,
      lines: Array.from({ length: endSentence - startSentence }, (_, index) => ({
        key: `line-${index}`,
        fragments: [{ key: `fragment-${index}`, text: 'line', marks: [] }]
      })),
      startSentence,
      endSentence,
      continuationStart,
      continuationEnd
    })
  ),
  renderSentenceLineWindow: vi.fn(
    (
      block: TextBlock,
      sentenceIndex: number,
      lineOffset: number,
      maxLines: number
    ) => {
      const totalLines = 5;
      const lineCount = Math.min(totalLines - lineOffset, maxLines);
      return {
        totalLines,
        visibleLines: Array.from({ length: lineCount }, (_, index) => ({
          key: `${block.id}-${sentenceIndex}-line-${lineOffset + index}`,
          fragments: [
            {
              key: `${block.id}-${sentenceIndex}-fragment-${lineOffset + index}`,
              text: `line-${lineOffset + index}`,
              marks: []
            }
          ]
        })),
        height: lineCount * 32
      };
    }
  )
}));

import { paginateBook, findPortionIndexForAnchor } from './paginateBook';
import { preserveAnchorAfterRepagination } from '../reader/anchors';

const settings: ReaderSettings = {
  fontSize: 20,
  lineHeight: 1.7,
  horizontalPadding: 24,
  theme: 'light'
};

function makeTextBlock(
  id: string,
  sentenceCount: number,
  order: number
): TextBlock {
  return {
    id,
    order,
    kind: 'paragraph',
    sectionId: 'section-0',
    text: Array.from({ length: sentenceCount }, (_, index) => `Sentence ${index + 1}.`).join(' '),
    inlineContent: [],
    sentences: Array.from({ length: sentenceCount }, (_, index) => ({
      id: `${id}-sentence-${index}`,
      index,
      text: `Sentence ${index + 1}.`,
      inlineIds: [],
      startOffset: index * 10,
      endOffset: index * 10 + 9
    }))
  };
}

function makeBook(blocks: TextBlock[]): CanonicalBook {
  return {
    id: 'book-1',
    fingerprint: 'fixture',
    metadata: {
      title: 'Fixture'
    },
    sections: [
      {
        id: 'section-0',
        index: 0,
        label: 'Chapter 1',
        href: 'chapter-1.xhtml',
        blocks
      }
    ],
    resources: {},
    totalBlocks: blocks.length,
    totalSentences: blocks.reduce((sum, block) => sum + block.sentences.length, 0)
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paginateBook', () => {
  it('cuts portions on sentence boundaries instead of crude character counts', async () => {
    const book = makeBook([makeTextBlock('block-1', 4, 0)]);
    const viewport: ViewportMetrics = {
      width: 390,
      height: 844,
      contentWidth: 320,
      contentHeight: 220
    };

    const result = await paginateBook(book, viewport, settings);

    expect(result.portions).toHaveLength(2);
    expect(result.portions[0].blocks[0]).toMatchObject({
      type: 'text',
      startSentence: 0,
      endSentence: 2
    });
    expect(result.portions[1].blocks[0]).toMatchObject({
      type: 'text',
      startSentence: 2,
      endSentence: 4
    });
  });

  it('falls back to line windows when a single sentence exceeds the viewport', async () => {
    const book = makeBook([makeTextBlock('oversized-block', 1, 0)]);
    const viewport: ViewportMetrics = {
      width: 390,
      height: 844,
      contentWidth: 320,
      contentHeight: 120
    };

    const result = await paginateBook(book, viewport, settings);

    expect(result.portions.length).toBeGreaterThan(1);
    expect(result.portions[0].start).toMatchObject({
      blockId: 'oversized-block',
      sentenceIndex: 0,
      lineOffset: 0
    });
    expect(result.portions[1].start).toMatchObject({
      blockId: 'oversized-block',
      sentenceIndex: 0
    });
    expect(result.portions[1].start.lineOffset).toBeGreaterThan(0);
  });

  it('preserves the closest reading anchor after repagination', async () => {
    const book = makeBook([makeTextBlock('block-1', 6, 0)]);
    const roomyViewport: ViewportMetrics = {
      width: 390,
      height: 844,
      contentWidth: 320,
      contentHeight: 300
    };
    const tightViewport: ViewportMetrics = {
      width: 390,
      height: 844,
      contentWidth: 320,
      contentHeight: 180
    };

    const before = await paginateBook(book, roomyViewport, settings);
    const anchor = before.portions[1].start;
    const after = await paginateBook(book, tightViewport, settings, anchor);
    const preservedIndex = preserveAnchorAfterRepagination(after.portions, anchor);

    expect(findPortionIndexForAnchor(after.portions, anchor)).toBe(preservedIndex);
    expect(after.portions[preservedIndex].start.blockId).toBe(anchor.blockId);
  });
});
