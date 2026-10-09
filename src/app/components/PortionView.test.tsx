import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortionView } from './PortionView';
import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import { createAnnotationRange } from '../../lib/annotations/domSelection';

const text = 'First  word, then another.';
const portion = { blocks: [{ type: 'text', key: 'p', blockId: 'p', blockOrder: 0, kind: 'paragraph',
  startSentence: 0, endSentence: 0, continuationStart: false, continuationEnd: false,
  lines: [{ key: 'line', fragments: [{ key: 'f', text, font: '20px serif', marks: ['italic'], blockStart: 0, blockEnd: text.length }] }]
}] } as ReaderPortion;

describe('animated portion text', () => {
  it('preserves whitespace, annotation boundaries and canonical selection across words', () => {
    const annotation = { id: 'note', startOffset: 7, endOffset: 12 } as TextAnnotation;
    const render = (wordAnimation: boolean) => renderToStaticMarkup(<PortionView portion={portion}
      settings={{ fontSize: 20, lineHeight: 1.5, horizontalPadding: 20, theme: 'light', wordAnimation }}
      annotationsByBlock={new Map([['p', [annotation]]])} />);
    const scope = document.createElement('div');
    scope.innerHTML = render(true);
    expect(scope.textContent).toBe(text);
    expect(scope.querySelectorAll('.reader-word')).toHaveLength(4);
    expect(scope.querySelector('[data-annotation-id="note"]')?.textContent).toBe('word,');
    expect(createAnnotationRange(scope, 'p', 3, 18)?.toString()).toBe(text.slice(3, 18));
    expect(createAnnotationRange(scope, 'p', 5, 7)?.toString()).toBe('  ');
    expect(createAnnotationRange(scope, 'p', 0, text.length)?.toString()).toBe(text);
    scope.innerHTML = render(false);
    expect(scope.textContent).toBe(text);
    expect(scope.querySelector('.reader-word')).toBeNull();
  });
});
