import { describe, expect, it } from 'vitest';
import type { BookSection, ParseDiagnostic, TextBlock, TocEntry } from '../../types/book';
import {
  classifySections,
  deriveTocFromSections,
  hasUsableToc,
  inferTextBlockKind
} from './heuristics';

function makeTextBlock(
  id: string,
  text: string,
  kind: TextBlock['kind'] = 'paragraph'
): TextBlock {
  return {
    id,
    order: 0,
    kind,
    sectionId: 'section',
    text,
    inlineContent: [],
    sentences: text
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean)
      .map((sentence, index) => ({
        id: `${id}-${index}`,
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
  blocks: TextBlock[],
  localLinks: string[] = [],
  anchorIds: string[] = []
): BookSection {
  return {
    id,
    index,
    label,
    href,
    blocks: blocks.map((block) => ({ ...block, sectionId: id })),
    matter: 'body',
    navLabel: undefined,
    tocDepth: undefined,
    localLinks,
    anchorIds
  };
}

describe('classifySections', () => {
  it('uses TOC labels and classifies front/body/back matter', () => {
    const diagnostics: ParseDiagnostic[] = [];
    const toc: TocEntry[] = [
      {
        id: 'toc-0',
        label: 'Contents',
        href: 'toc.xhtml',
        depth: 0,
        children: []
      },
      {
        id: 'toc-1',
        label: 'Chapter 1',
        href: 'chapter-1.xhtml',
        depth: 0,
        children: []
      },
      {
        id: 'toc-2',
        label: 'Notes',
        href: 'notes.xhtml',
        depth: 0,
        children: []
      }
    ];

    const sections = classifySections(
      [
        makeSection('toc', 0, 'Section 1', 'toc.xhtml', [
          makeTextBlock('toc-heading', 'Contents', 'heading')
        ]),
        makeSection('chapter-1', 1, 'Section 2', 'chapter-1.xhtml', [
          makeTextBlock('chapter-heading', 'Chapter 1', 'heading'),
          makeTextBlock(
            'chapter-body',
            'This is the actual body. It has multiple sentences. It is substantial enough to count as narrative.'
          )
        ]),
        makeSection('notes', 2, 'Section 3', 'notes.xhtml', [
          makeTextBlock('notes-heading', 'Notes', 'heading'),
          makeTextBlock('notes-body', 'Reference one. Reference two.')
        ])
      ],
      toc,
      diagnostics
    );

    expect(sections.map((section) => section.label)).toEqual([
      'Contents',
      'Chapter 1',
      'Notes'
    ]);
    expect(sections.map((section) => section.matter)).toEqual(['front', 'body', 'back']);
    expect(diagnostics).toEqual([]);
  });

  it('downgrades reciprocal short note sections into back matter', () => {
    const diagnostics: ParseDiagnostic[] = [];
    const sections = classifySections(
      [
        makeSection(
          'chapter',
          0,
          'Chapter 1',
          'chapter.xhtml',
          [
            makeTextBlock(
              'chapter-body',
              'Long narrative text. Another sentence. A third sentence makes this body.'
            )
          ],
          ['notes.xhtml#note-1'],
          ['note-ref-1']
        ),
        makeSection(
          'notes',
          1,
          'Section 2',
          'notes.xhtml',
          [makeTextBlock('note-body', '1. Back to text.')],
          ['chapter.xhtml#note-ref-1'],
          ['note-1']
        )
      ],
      [],
      diagnostics
    );

    expect(sections[0].matter).toBe('body');
    expect(sections[1].matter).toBe('back');
    expect(diagnostics[0]?.severity).toBe('warning');
  });
});

describe('TOC helpers', () => {
  it('derives a fallback TOC from classified body sections', () => {
    const sections = classifySections(
      [
        makeSection('front', 0, 'Contents', 'contents.xhtml', [
          makeTextBlock('front-heading', 'Contents', 'heading')
        ]),
        makeSection('part-1', 1, 'Part I', 'part-1.xhtml', [
          makeTextBlock('part-heading', 'Part I', 'heading'),
          makeTextBlock('part-body', 'A short bridge paragraph.')
        ]),
        makeSection('chapter-1', 2, 'Chapter 1', 'chapter-1.xhtml', [
          makeTextBlock('chapter-heading', 'Chapter 1', 'heading'),
          makeTextBlock(
            'chapter-body',
            'This chapter contains enough prose to count as real body text. It has several sentences. That keeps it substantial.'
          )
        ]),
        makeSection('chapter-2', 3, 'Chapter 2', 'chapter-2.xhtml', [
          makeTextBlock('chapter-2-heading', 'Chapter 2', 'heading'),
          makeTextBlock(
            'chapter-2-body',
            'Another substantial chapter appears here. It also has multiple sentences. That makes it useful for navigation.'
          )
        ])
      ],
      [],
      []
    );

    expect(deriveTocFromSections(sections)).toEqual([
      {
        id: 'derived-toc-0',
        label: 'Part I',
        href: 'part-1.xhtml',
        depth: 0,
        children: [
          {
            id: 'derived-toc-1',
            label: 'Chapter 1',
            href: 'chapter-1.xhtml',
            depth: 1,
            children: []
          },
          {
            id: 'derived-toc-2',
            label: 'Chapter 2',
            href: 'chapter-2.xhtml',
            depth: 1,
            children: []
          }
        ]
      }
    ]);
  });

  it('rejects weak TOCs that barely map onto the parsed sections', () => {
    const sections = [
      makeSection('chapter-1', 0, 'Chapter 1', 'chapter-1.xhtml', [
        makeTextBlock('chapter-heading', 'Chapter 1', 'heading'),
        makeTextBlock(
          'chapter-body',
          'This chapter contains enough prose to count as narrative. It has multiple sentences. That makes it substantial.'
        )
      ]),
      makeSection('chapter-2', 1, 'Chapter 2', 'chapter-2.xhtml', [
        makeTextBlock('chapter-2-heading', 'Chapter 2', 'heading'),
        makeTextBlock(
          'chapter-2-body',
          'The second chapter also contains enough narrative. It has several sentences. That makes it substantial too.'
        )
      ])
    ];

    expect(
      hasUsableToc(
        [
          { id: 'a', label: 'Ghost 1', href: 'ghost-1.xhtml', depth: 0, children: [] },
          { id: 'b', label: 'Ghost 2', href: 'ghost-2.xhtml', depth: 0, children: [] },
          { id: 'c', label: 'Chapter 1', href: 'chapter-1.xhtml', depth: 0, children: [] }
        ],
        sections
      )
    ).toBe(false);
  });
});

describe('inferTextBlockKind', () => {
  it('treats short centered bold text as a heading even outside heading tags', () => {
    expect(
      inferTextBlockKind('p', 'PART I', {
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        fontFamily: 'Georgia',
        fontStyle: 'normal',
        fontWeight: '700',
        fontVariant: 'small-caps',
        textDecorationLine: 'none',
        textAlign: 'center',
        display: 'block'
      })
    ).toBe('heading');
  });

  it('treats short page-break-marked text as a heading cue', () => {
    expect(
      inferTextBlockKind('div', 'Chapter 7', {
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
        fontFamily: 'Georgia',
        fontStyle: 'normal',
        fontWeight: '400',
        fontVariant: 'normal',
        textDecorationLine: 'none',
        textAlign: 'left',
        display: 'block',
        cssDefinedPageBreak: 'before'
      })
    ).toBe('heading');
  });
});
