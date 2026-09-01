import { describe, expect, it } from 'vitest';
import type { CanonicalBook, TextBlock } from '../../types/book';
import type { AnnotationSelection, ReaderPortion, TextAnnotation } from '../../types/reader';
import {
  createTextAnnotation,
  groupAnnotationsByBlock
} from './domain';
import { getAnnotationPortionIndexes } from './navigation';

const textBlock: TextBlock = {
  id: 'block-1',
  order: 3,
  kind: 'paragraph',
  sectionId: 'section-1',
  text: 'First sentence. Second sentence.',
  inlineContent: [],
  sentences: [
    {
      id: 'sentence-1',
      index: 0,
      text: 'First sentence.',
      inlineIds: [],
      startOffset: 0,
      endOffset: 15
    },
    {
      id: 'sentence-2',
      index: 1,
      text: 'Second sentence.',
      inlineIds: [],
      startOffset: 16,
      endOffset: 32
    }
  ]
};

const book: CanonicalBook = {
  id: 'book',
  fingerprint: 'book-fingerprint',
  metadata: { title: 'Fixture' },
  sections: [
    {
      id: 'section-1',
      index: 0,
      label: 'Chapter 1',
      href: 'chapter-1.xhtml',
      blocks: [textBlock],
      matter: 'body',
      anchorIds: [],
      localLinks: []
    }
  ],
  toc: [],
  resources: {},
  totalBlocks: 1,
  totalSentences: 2,
  parseStats: {
    confidence: 1,
    diagnostics: [],
    parsedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 0
  }
};

const selection: AnnotationSelection = {
  blockId: 'block-1',
  blockOrder: 3,
  startOffset: 16,
  endOffset: 22,
  sentenceIndex: 1,
  selectedText: 'Second',
  rects: []
};

function annotation(overrides: Partial<TextAnnotation>): TextAnnotation {
  return {
    id: 'annotation',
    fingerprint: book.fingerprint,
    blockId: 'block-1',
    blockOrder: 3,
    startOffset: 0,
    endOffset: 5,
    sentenceIndex: 0,
    selectedText: 'First',
    note: 'Note',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('annotation domain', () => {
  it('creates a persistent annotation from a canonical selection', () => {
    const created = createTextAnnotation(book, selection, '  Worth remembering.  ', '2026-01-02T00:00:00.000Z');

    expect(created).toMatchObject({
      fingerprint: 'book-fingerprint',
      blockId: 'block-1',
      startOffset: 16,
      endOffset: 22,
      selectedText: 'Second',
      note: 'Worth remembering.',
      locator: { sectionId: 'section-1', blockId: 'block-1', sentenceIndex: 1 }
    });
  });

  it('groups and orders annotations by their canonical block range', () => {
    const grouped = groupAnnotationsByBlock([
      annotation({ id: 'later', startOffset: 20, endOffset: 25 }),
      annotation({ id: 'earlier', startOffset: 5, endOffset: 10 })
    ]);

    expect(grouped.get('block-1')?.map((entry) => entry.id)).toEqual(['earlier', 'later']);
  });

  it('derives annotation markers from portions after reflow', () => {
    const portions: ReaderPortion[] = [
      {
        id: 'portion-0',
        index: 0,
        sectionId: 'section-1',
        sectionLabel: 'Chapter 1',
        start: { blockId: 'block-1', blockOrder: 3, sentenceIndex: 0, lineOffset: 0 },
        end: { blockId: 'block-1', blockOrder: 3, sentenceIndex: 0, lineOffset: 0 },
        blocks: []
      },
      {
        id: 'portion-1',
        index: 1,
        sectionId: 'section-1',
        sectionLabel: 'Chapter 1',
        start: { blockId: 'block-1', blockOrder: 3, sentenceIndex: 1, lineOffset: 0 },
        end: { blockId: 'block-1', blockOrder: 3, sentenceIndex: 1, lineOffset: 0 },
        blocks: []
      }
    ];

    expect(getAnnotationPortionIndexes([annotation({ sentenceIndex: 1 })], portions)).toEqual(
      new Set([1])
    );
  });
});
