import { describe, expect, it } from 'vitest';
import type { BookBlock, BookSection, CanonicalBook, TextBlock } from '../../types/book';
import { getPreferredStartAnchor } from './anchors';

function makeTextBlock(
  id: string,
  order: number,
  text: string,
  kind: TextBlock['kind'] = 'paragraph'
): TextBlock {
  return {
    id,
    order,
    kind,
    sectionId: 'section',
    text,
    inlineContent: [],
    sentences: text
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .map((sentence, index) => ({
        id: `${id}-sentence-${index}`,
        index,
        text: sentence,
        inlineIds: [],
        startOffset: index * 10,
        endOffset: index * 10 + sentence.length
      }))
  };
}

function makeSection(
  id: string,
  index: number,
  label: string,
  href: string,
  blocks: BookBlock[]
): BookSection {
  return {
    id,
    index,
    label,
    href,
    blocks: blocks.map((block) =>
      'sectionId' in block ? { ...block, sectionId: id } : block
    )
  };
}

function makeBook(sections: BookSection[]): CanonicalBook {
  return {
    id: 'book-1',
    fingerprint: 'fixture',
    metadata: { title: 'Fixture' },
    sections,
    resources: {},
    totalBlocks: sections.reduce((total, section) => total + section.blocks.length, 0),
    totalSentences: sections.reduce(
      (total, section) =>
        total +
        section.blocks.reduce(
          (sectionTotal, block) =>
            'sentences' in block ? sectionTotal + block.sentences.length : sectionTotal,
          0
        ),
      0
    )
  };
}

describe('getPreferredStartAnchor', () => {
  it('skips common front matter and starts at the introduction', () => {
    const book = makeBook([
      makeSection('cover', 0, 'Cover', 'cover.xhtml', [
        { id: 'cover-image', order: 0, kind: 'image', sectionId: 'cover', src: 'cover.jpg', alt: '' }
      ]),
      makeSection('toc', 1, 'Contents', 'toc.xhtml', [
        makeTextBlock('toc-heading', 1, 'Contents', 'heading'),
        makeTextBlock('toc-links', 2, 'Introduction Chapter 1 Chapter 2')
      ]),
      makeSection('copyright', 2, 'Copyright', 'copyright.xhtml', [
        makeTextBlock('copyright-heading', 3, 'Copyright', 'heading'),
        makeTextBlock('copyright-body', 4, 'All rights reserved.')
      ]),
      makeSection('intro', 3, 'Introduction', 'introduction.xhtml', [
        makeTextBlock('intro-heading', 5, 'Introduction', 'heading'),
        makeTextBlock(
          'intro-body',
          6,
          'This is the actual opening of the book. It starts with real prose. It keeps going with enough copy to count as body text.'
        )
      ])
    ]);

    expect(getPreferredStartAnchor(book)).toMatchObject({
      blockId: 'intro-heading',
      blockOrder: 5
    });
  });

  it('starts at chapter 1 when no introduction is present', () => {
    const book = makeBook([
      makeSection('title', 0, 'Title Page', 'title.xhtml', [
        makeTextBlock('title-heading', 0, 'Everything Is Tuberculosis', 'heading')
      ]),
      makeSection('toc', 1, 'Table of Contents', 'nav.xhtml', [
        makeTextBlock('toc-body', 1, 'Contents')
      ]),
      makeSection('chapter-1', 2, 'Chapter 1', 'chapter-1.xhtml', [
        makeTextBlock('chapter-1-heading', 2, 'Chapter 1', 'heading'),
        makeTextBlock(
          'chapter-1-body',
          3,
          'The first chapter starts here. It contains multiple sentences. That makes it body text.'
        )
      ])
    ]);

    expect(getPreferredStartAnchor(book)).toMatchObject({
      blockId: 'chapter-1-heading',
      blockOrder: 2
    });
  });

  it('falls back to the first readable section when labels are neutral', () => {
    const book = makeBook([
      makeSection('misc', 0, 'Section 1', 's001.xhtml', [
        makeTextBlock('misc-heading', 0, 'A Short Title', 'heading')
      ]),
      makeSection('body', 1, 'Section 2', 's002.xhtml', [
        makeTextBlock(
          'body-paragraph',
          1,
          'This section is the first one with enough narrative text to be considered the real beginning. It has several sentences. That should make it the preferred start.'
        )
      ])
    ]);

    expect(getPreferredStartAnchor(book)).toMatchObject({
      blockId: 'body-paragraph',
      blockOrder: 1
    });
  });
});
