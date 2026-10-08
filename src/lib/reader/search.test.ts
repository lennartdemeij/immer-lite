import { describe, expect, it } from 'vitest';
import type { TextBlock } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';
import { createTextPortionIndex, findTextPortionIndex, searchBook } from './search';

function entry(text: string, id = 'paragraph') {
  const block: TextBlock = { id, order: 0, kind: 'paragraph', sectionId: 'chapter', text, inlineContent: [], sentences: [] };
  return { block, sectionLabel: 'Chapter one' };
}

function page(start: number, end: number): ReaderPortion {
  const anchor = { blockId: 'paragraph', blockOrder: 0, sentenceIndex: 0, lineOffset: 0 };
  return {
    id: `${start}`, index: 0, sectionId: 'chapter', sectionLabel: 'Chapter one', start: anchor, end: anchor,
    blocks: [{ type: 'text', key: `${start}`, blockId: 'paragraph', blockOrder: 0, kind: 'paragraph',
      startSentence: 0, endSentence: 1, continuationStart: start > 0, continuationEnd: true,
      lines: [{ key: 'line', fragments: [{ key: 'fragment', text: 'text', font: '', marks: [], blockStart: start, blockEnd: end }] }] }]
  };
}

describe('book search', () => {
  it('returns at most twenty occurrences in reading order, including repeats within a paragraph', () => {
    const results = searchBook([entry('word WORD ' + 'word '.repeat(24)), entry('word', 'next')], 'word');
    expect(results).toHaveLength(20);
    expect(results.map((result) => result.startOffset)).toEqual(Array.from({ length: 20 }, (_, index) => index * 5));
    expect(results.every((result) => result.blockId === 'paragraph')).toBe(true);
  });

  it('searches literal punctuation and flexible whitespace with original character offsets', () => {
    const text = 'Find C++ [a.b] and two\n  words here.';
    expect(searchBook([entry(text)], 'C++ [a.b]')[0].match).toBe('C++ [a.b]');
    const result = searchBook([entry(text)], '  TWO words  ')[0];
    expect(text.slice(result.startOffset, result.endOffset)).toBe('two\n  words');
  });

  it('returns no suggestions for an empty or unmatched query', () => {
    expect(searchBook([entry('some text')], '  ')).toEqual([]);
    expect(searchBook([entry('some text')], 'other')).toEqual([]);
  });

  it('jumps to the correct page inside a sentence and follows new page breaks', () => {
    const index = createTextPortionIndex([page(0, 50), page(50, 100), page(100, 150)]);
    expect(findTextPortionIndex(index, 'paragraph', 50)).toBe(1);
    expect(findTextPortionIndex(index, 'paragraph', 120)).toBe(2);
    const reflowed = createTextPortionIndex([page(0, 130), page(130, 150)]);
    expect(findTextPortionIndex(reflowed, 'paragraph', 120)).toBe(0);
    expect(findTextPortionIndex(index, 'missing', 0)).toBe(-1);
  });
});
