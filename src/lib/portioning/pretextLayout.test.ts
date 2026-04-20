import { describe, expect, it } from 'vitest';
import type { TextBlock } from '../../types/book';
import type { ReaderSettings } from '../../types/reader';
import { buildRichSlice, restoreCollapsedSpacesForRender } from './pretextLayout';

const settings: ReaderSettings = {
  fontSize: 21,
  lineHeight: 1.72,
  horizontalPadding: 34,
  theme: 'dark'
};

function makeBlock(): TextBlock {
  return {
    id: 'block-1',
    order: 0,
    kind: 'paragraph',
    sectionId: 'section-1',
    text: 'Sentence one. Sentence two. Sentence three.',
    inlineContent: [
      { id: 's1', text: 'Sentence one.', marks: [] },
      { id: 's2', text: 'Sentence two.', marks: [] },
      { id: 's3', text: 'Sentence three.', marks: [] }
    ],
    sentences: [
      {
        id: 'sentence-1',
        index: 0,
        text: 'Sentence one.',
        inlineIds: ['s1'],
        startOffset: 0,
        endOffset: 13
      },
      {
        id: 'sentence-2',
        index: 1,
        text: 'Sentence two.',
        inlineIds: ['s2'],
        startOffset: 14,
        endOffset: 27
      },
      {
        id: 'sentence-3',
        index: 2,
        text: 'Sentence three.',
        inlineIds: ['s3'],
        startOffset: 28,
        endOffset: 43
      }
    ]
  };
}

describe('buildRichSlice', () => {
  it('keeps visible spaces between adjacent sentences', () => {
    const slice = buildRichSlice(makeBlock(), 0, 3, settings);

    expect(slice.items.map((item) => item.text).join('')).toBe(
      'Sentence one. Sentence two. Sentence three.'
    );
  });

  it('normalizes boundary whitespace to a single sentence separator', () => {
    const block = makeBlock();
    block.inlineContent = [
      { id: 's1', text: 'Sentence one.   ', marks: [] },
      { id: 's2', text: '   Sentence two.', marks: [] }
    ];
    block.sentences = [
      {
        id: 'sentence-1',
        index: 0,
        text: 'Sentence one.',
        inlineIds: ['s1'],
        startOffset: 0,
        endOffset: 16
      },
      {
        id: 'sentence-2',
        index: 1,
        text: 'Sentence two.',
        inlineIds: ['s2'],
        startOffset: 16,
        endOffset: 32
      }
    ];

    const slice = buildRichSlice(block, 0, 2, settings);
    expect(slice.items.map((item) => item.text).join('')).toBe('Sentence one. Sentence two.');
  });

  it('restores collapsed spaces between fragments on the same rendered line', () => {
    const slice = buildRichSlice(makeBlock(), 0, 2, settings);

    const lines = restoreCollapsedSpacesForRender(
      [
        {
          fragments: [
            {
              itemIndex: 0,
              gapBefore: 0,
              text: 'Sentence one.',
              start: { segmentIndex: 0, graphemeIndex: 0 }
            },
            {
              itemIndex: 1,
              gapBefore: 8,
              text: 'Sentence two.',
              start: { segmentIndex: 0, graphemeIndex: 0 }
            }
          ]
        }
      ],
      slice
    );

    expect(lines[0].fragments.map((fragment) => fragment.text).join('')).toBe(
      'Sentence one. Sentence two.'
    );
  });

  it('restores collapsed spaces across a rendered line break', () => {
    const slice = buildRichSlice(makeBlock(), 0, 2, settings);

    const lines = restoreCollapsedSpacesForRender(
      [
        {
          fragments: [
            {
              itemIndex: 0,
              gapBefore: 0,
              text: 'Sentence one.',
              start: { segmentIndex: 0, graphemeIndex: 0 }
            }
          ]
        },
        {
          fragments: [
            {
              itemIndex: 1,
              gapBefore: 0,
              text: 'Sentence two.',
              start: { segmentIndex: 0, graphemeIndex: 0 }
            }
          ]
        }
      ],
      slice
    );

    expect(lines[0].fragments.map((fragment) => fragment.text).join('')).toBe('Sentence one. ');
    expect(lines[1].fragments.map((fragment) => fragment.text).join('')).toBe('Sentence two.');
  });
});
