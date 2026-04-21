import { describe, expect, it } from 'vitest';
import { mergeAnnotations } from './annotationSync';
import type { TextAnnotation } from '../../types/reader';

function annotation(overrides: Partial<TextAnnotation>): TextAnnotation {
  return {
    id: 'annotation-1',
    fingerprint: 'book-fingerprint',
    blockId: 'block-1',
    blockOrder: 1,
    startOffset: 10,
    endOffset: 20,
    sentenceIndex: 0,
    selectedText: 'selected text',
    note: 'note',
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides
  };
}

describe('annotation sync', () => {
  it('keeps the newest annotation when local and remote share an id', () => {
    const older = annotation({
      note: 'old',
      updatedAt: '2026-04-21T00:00:00.000Z'
    });
    const newer = annotation({
      note: 'new',
      updatedAt: '2026-04-21T00:01:00.000Z'
    });

    expect(mergeAnnotations([newer], [older])).toEqual([newer]);
  });

  it('sorts merged annotations by stable book anchor', () => {
    const second = annotation({
      id: 'annotation-2',
      blockOrder: 2,
      startOffset: 0
    });
    const first = annotation({
      id: 'annotation-1',
      blockOrder: 1,
      startOffset: 50
    });

    expect(mergeAnnotations([second], [first]).map((entry) => entry.id)).toEqual([
      'annotation-1',
      'annotation-2'
    ]);
  });
});

