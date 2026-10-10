import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextBlock } from '../../types/book';
import { prepareHyphenation } from './hyphenation';
import { renderTextSlice } from './pretextLayout';

// Exercise the actual Pretext API. Fixed glyph widths isolate source mapping
// from platform fonts; browser profiling covers real font measurement.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: Array.from(text).length * 8 })
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

describe('Pretext source mapping', () => {
  it.each([false, true])('preserves styled sentence offsets at different widths (hyphenation: %s)', async hyphenation => {
    await prepareHyphenation('en');
    const parts = ['First certain ', 'extraordinary.', 'Another well-known example.'];
    const text = `${parts[0]}${parts[1]} ${parts[2]}`;
    const starts = [0, parts[0].length, parts[0].length + parts[1].length + 1];
    const block: TextBlock = {
      id: 'paragraph', order: 0, sectionId: 'chapter', kind: 'paragraph', text,
      inlineContent: parts.map((part, index) => ({ id: `i${index}`, text: part,
        marks: index === 1 ? ['italic'] : [], startOffset: starts[index], endOffset: starts[index] + part.length })),
      sentences: [
        { id: 's1', index: 0, text: parts[0] + parts[1], inlineIds: ['i0', 'i1'], startOffset: 0, endOffset: starts[2] - 1 },
        { id: 's2', index: 1, text: parts[2], inlineIds: ['i2'], startOffset: starts[2], endOffset: text.length }
      ]
    };
    for (const width of [90, 150, 320]) {
      const rendered = renderTextSlice(block, 0, 2,
        { width: 390, height: 844, contentWidth: width, contentHeight: 600 },
        { fontSize: 20, lineHeight: 1.6, horizontalPadding: 0, theme: 'light', hyphenation, hyphenationLanguage: 'en' }, false, false);
      const fragments = rendered.lines.flatMap(line => line.fragments).filter(fragment => fragment.blockStart !== undefined);
      expect(fragments.map(fragment => fragment.text).join('')).toBe(text);
      for (const fragment of fragments) {
        expect(text.slice(fragment.blockStart, fragment.blockEnd)).toBe(fragment.text);
      }
    }
  });
});
