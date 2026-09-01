import { describe, expect, it } from 'vitest';
import type { CanonicalBook } from '../../types/book';
import { readAnnotationSelection } from './domSelection';

const book: CanonicalBook = {
  id: 'book',
  fingerprint: 'fixture',
  metadata: { title: 'Fixture' },
  sections: [
    {
      id: 'section-1',
      index: 0,
      label: 'Chapter 1',
      href: 'chapter-1.xhtml',
      matter: 'body',
      anchorIds: [],
      localLinks: [],
      blocks: [
        {
          id: 'block-1',
          order: 0,
          kind: 'paragraph',
          sectionId: 'section-1',
          text: 'would be his most important yet. He became obsessed.',
          inlineContent: [],
          sentences: [
            {
              id: 'sentence-1',
              index: 0,
              text: 'would be his most important yet.',
              inlineIds: [],
              startOffset: 0,
              endOffset: 32
            },
            {
              id: 'sentence-2',
              index: 1,
              text: 'He became obsessed.',
              inlineIds: [],
              startOffset: 33,
              endOffset: 52
            }
          ]
        }
      ]
    }
  ],
  toc: [],
  resources: {},
  totalBlocks: 1,
  totalSentences: 2,
  parseStats: { confidence: 1, diagnostics: [], parsedAt: '2026-01-01T00:00:00.000Z', durationMs: 0 }
};

function makeScope(): HTMLElement {
  const scope = document.createElement('div');
  scope.innerHTML = `
    <article class="reader-block" data-block-id="block-1" data-block-order="0">
      <div class="reader-line"><span data-block-start="0" data-block-end="32">would be his most important yet.</span></div>
      <div class="reader-line"><span data-block-start="32" data-block-end="52"> He became obsessed.</span></div>
    </article>
  `;
  document.body.append(scope);
  return scope;
}

describe('readAnnotationSelection', () => {
  it('uses canonical fragment offsets across visual line wrappers', () => {
    const scope = makeScope();
    const fragments = scope.querySelectorAll('span[data-block-start]');
    const range = document.createRange();
    range.setStart(fragments[0].firstChild!, 28);
    range.setEnd(fragments[1].firstChild!, 3);

    const result = readAnnotationSelection({
      range,
      scope,
      book,
      captureRects: () => []
    });

    expect(result).toMatchObject({
      startOffset: 28,
      endOffset: 35,
      selectedText: 'yet. He',
      sentenceIndex: 0
    });
    scope.remove();
  });

  it('handles an endpoint reported on the line wrapper rather than a text node', () => {
    const scope = makeScope();
    const [firstLine, secondLine] = scope.querySelectorAll('.reader-line');
    const range = document.createRange();
    range.setStart(firstLine.firstChild!.firstChild!, 0);
    range.setEnd(secondLine, 1);

    const result = readAnnotationSelection({
      range,
      scope,
      book,
      captureRects: () => []
    });

    expect(result).toMatchObject({
      startOffset: 0,
      endOffset: 52,
      selectedText: 'would be his most important yet. He became obsessed.'
    });
    scope.remove();
  });
});
