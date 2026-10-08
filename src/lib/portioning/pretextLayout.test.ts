import { describe, expect, it, vi } from 'vitest';
import type { TextBlock } from '../../types/book';
import type { ReaderSettings } from '../../types/reader';
import { buildRichSlice, measureTextSlice, renderTextSlice, restoreCollapsedSpacesForRender, restoreHyphenatedLines } from './pretextLayout';
import { prepareHyphenation } from './hyphenation';
import { prepareRichInline, measureRichInlineStats } from '@chenglou/pretext/rich-inline';

vi.mock('@chenglou/pretext/rich-inline', () => ({
  prepareRichInline: vi.fn((items) => ({ items })),
  measureRichInlineStats: vi.fn(() => ({ lineCount: 1 })),
  walkRichInlineLineRanges: vi.fn((_prepared, _width, visit) => visit({})),
  materializeRichInlineLineRange: vi.fn(() => ({ fragments: [{
    itemIndex: 0, gapBefore: 0, text: 'Sentence one.',
    start: { segmentIndex: 0, graphemeIndex: 0 }
  }] }))
}));

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
  it('reuses text preparation between fitting, rendering and line-height changes', () => {
    vi.clearAllMocks();
    const block = makeBlock();
    const viewport = { width: 390, height: 844, contentWidth: 320, contentHeight: 600 };
    measureTextSlice(block, 0, 1, viewport, settings, false, false);
    renderTextSlice(block, 0, 1, viewport, settings, false, false);
    const changed = measureTextSlice(block, 0, 1, viewport, { ...settings, lineHeight: 2 }, false, false);
    expect(changed.height).toBeGreaterThan(42);
    expect(prepareRichInline).toHaveBeenCalledTimes(1);
    expect(measureRichInlineStats).toHaveBeenCalledTimes(1);
    measureTextSlice(block, 0, 1, { ...viewport, contentWidth: 280 }, settings, false, false);
    expect(measureRichInlineStats).toHaveBeenCalledTimes(2);
    measureTextSlice(block, 0, 1, viewport, { ...settings, fontSize: 24 }, false, false);
    expect(prepareRichInline).toHaveBeenCalledTimes(2);
  });

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

  it('preserves a visible space across styled inline boundaries', () => {
    const block = makeBlock();
    block.text = 'certain sacrality';
    block.inlineContent = [
      { id: 'w1', text: 'certain', marks: [], startOffset: 0, endOffset: 7 },
      { id: 'w2', text: ' ', marks: [], startOffset: 7, endOffset: 8 },
      { id: 'w3', text: 'sacrality', marks: ['italic'], startOffset: 8, endOffset: 17 }
    ];
    block.sentences = [
      {
        id: 'sentence-1',
        index: 0,
        text: 'certain sacrality',
        inlineIds: ['w1', 'w2', 'w3'],
        startOffset: 0,
        endOffset: 17
      }
    ];

    const slice = buildRichSlice(block, 0, 1, settings);

    expect(slice.items.map((item) => item.text)).toEqual(['certain', ' sacrality']);
    expect(slice.meta[1]?.blockStart).toBe(7);
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

  it.each([false, true])('keeps canonical offsets after a restored inline space (wrapped: %s)', (wrapped) => {
    const block = makeBlock();
    block.text = 'certain sacrality grows.';
    block.inlineContent = [
      { id: 's1', text: 'certain ', marks: [], startOffset: 0, endOffset: 8 },
      { id: 's2', text: 'sacrality grows.', marks: ['italic'], startOffset: 8, endOffset: 24 }
    ];
    block.sentences = [{ id: 'sentence', index: 0, text: block.text, inlineIds: ['s1', 's2'], startOffset: 0, endOffset: 24 }];
    const first = { itemIndex: 0, text: 'certain', gapBefore: 0, start: { segmentIndex: 0, graphemeIndex: 0 } };
    const second = { itemIndex: 1, text: 'sacrality ', gapBefore: 0, start: { segmentIndex: 0, graphemeIndex: 0 } };
    const third = { itemIndex: 1, text: 'grows.', gapBefore: 0, start: { segmentIndex: 1, graphemeIndex: 0 } };
    const lines = restoreCollapsedSpacesForRender(
      wrapped ? [{ fragments: [first] }, { fragments: [second] }, { fragments: [third] }]
        : [{ fragments: [first, second] }, { fragments: [third] }],
      buildRichSlice(block, 0, 1, settings)
    );
    const fragments = lines.flatMap((line) => line.fragments);
    expect(fragments.map((fragment) => fragment.text).join('')).toBe(block.text);
    for (const fragment of fragments) {
      expect(block.text.slice(fragment.blockStart, fragment.blockEnd)).toBe(fragment.text);
    }
    expect(fragments.at(-1)?.blockEnd).toBe(24);
  });
});


describe('hyphenation', () => {
  function wordBlock(text: string): TextBlock {
    return { ...makeBlock(), text,
      inlineContent: [{ id: 'word', text, marks: ['italic'], startOffset: 0, endOffset: text.length }],
      sentences: [{ id: 'sentence', index: 0, text, inlineIds: ['word'], startOffset: 0, endOffset: text.length }] };
  }

  it.each(['en', 'nl'])('adds language-specific breaks without changing canonical text (%s)', async (language) => {
    await prepareHyphenation(language);
    const block = wordBlock(language === 'nl' ? 'verantwoordelijkheid' : 'extraordinary');
    const slice = buildRichSlice(block, 0, 1, { ...settings, hyphenation: true, hyphenationLanguage: language });
    expect(slice.items[0].text).toContain('\u00ad');
    expect(slice.items[0].text.replace(/\u00ad/g, '')).toBe(block.text);
    expect(slice.meta[0].text).toBe(block.text);
    expect(buildRichSlice(block, 0, 1, settings).items[0].text).toBe(block.text);
  });

  it('keeps canonical offsets through multiple breaks and a literal hyphen', () => {
    const block = wordBlock('extraordinary well-known example.');
    const slice = buildRichSlice(block, 0, 1, { ...settings, hyphenation: true });
    const lines = ['extra-', 'ordi-', 'nary well-', 'known example.'].map((text, index) => ({
      fragments: [{ itemIndex: 0, text, gapBefore: 0, start: { segmentIndex: index, graphemeIndex: 0 } }]
    }));
    const fragments = restoreHyphenatedLines(lines, slice).flatMap((line) => line.fragments);
    const canonical = fragments.filter((fragment) => fragment.blockStart !== undefined);
    expect(canonical.map((fragment) => fragment.text).join('')).toBe(block.text);
    expect(fragments.filter((fragment) => fragment.blockStart === undefined).map((fragment) => fragment.text)).toEqual(['-', '-']);
    for (const fragment of canonical) expect(block.text.slice(fragment.blockStart, fragment.blockEnd)).toBe(fragment.text);
    expect(canonical.at(-1)?.blockEnd).toBe(block.text.length);
  });

  it('preserves source offsets around author-provided soft hyphens', () => {
    const block = wordBlock('extra\u00adordinary');
    const slice = buildRichSlice(block, 0, 1, { ...settings, hyphenation: true });
    const fragments = restoreHyphenatedLines([{ fragments: [{ itemIndex: 0, text: 'extraordinary', gapBefore: 0,
      start: { segmentIndex: 0, graphemeIndex: 0 } }] }], slice)[0].fragments;
    expect(fragments.map((fragment) => [fragment.text, fragment.blockStart, fragment.blockEnd])).toEqual([
      ['extra', 0, 5], ['ordinary', 6, 14]
    ]);
  });

  it('keeps styled sentence separators at their original offsets', () => {
    const block = wordBlock('certain extraordinary. Another example.');
    block.inlineContent = [
      { id: 'a', text: 'certain ', marks: [], startOffset: 0, endOffset: 8 },
      { id: 'b', text: 'extraordinary.', marks: ['italic'], startOffset: 8, endOffset: 22 },
      { id: 'c', text: 'Another example.', marks: [], startOffset: 23, endOffset: 39 }
    ];
    block.sentences = [
      { id: 'one', index: 0, text: 'certain extraordinary.', inlineIds: ['a', 'b'], startOffset: 0, endOffset: 22 },
      { id: 'two', index: 1, text: 'Another example.', inlineIds: ['c'], startOffset: 23, endOffset: 39 }
    ];
    const slice = buildRichSlice(block, 0, 2, { ...settings, hyphenation: true });
    const fragments = restoreHyphenatedLines([
      { fragments: [{ itemIndex: 0, text: 'certain', gapBefore: 0, start: { segmentIndex: 0, graphemeIndex: 0 } }] },
      { fragments: [{ itemIndex: 1, text: 'extra-', gapBefore: 0, start: { segmentIndex: 0, graphemeIndex: 0 } }] },
      { fragments: [{ itemIndex: 1, text: 'ordinary.', gapBefore: 0, start: { segmentIndex: 1, graphemeIndex: 0 } },
        { itemIndex: 2, text: 'Another example.', gapBefore: 8, start: { segmentIndex: 0, graphemeIndex: 0 } }] }
    ], slice).flatMap((line) => line.fragments).filter((fragment) => fragment.blockStart !== undefined);
    expect(fragments.map((fragment) => fragment.text).join('')).toBe(block.text);
    for (const fragment of fragments) expect(block.text.slice(fragment.blockStart, fragment.blockEnd)).toBe(fragment.text);
  });
});
