import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { TextBlock } from '../../types/book';
import { adaptImmerBook, loadDemoImmerBook, type ImmerBookData } from './loadImmerBook';

function fixture(): ImmerBookData {
  return {
    immerBookId: 'test-book', versionId: 'version-1', title: 'Test book',
    locations: { sections: [
      { sectionLocationId: 'paragraph', itemLocationIds: [
        { type: 'TEXT', itemLocationId: 'hello', text: 'Hello' },
        { type: 'TEXT', itemLocationId: 'hidden', text: 'hidden' },
        { type: 'TEXT', itemLocationId: 'mars', text: 'Earth.', override: { type: 'TEXT', text: 'Mars.' } },
        { type: 'TEXT', itemLocationId: 'bye', text: 'Goodbye.' }
      ] },
      { sectionLocationId: 'header', itemLocationIds: [{ type: 'TEXT', itemLocationId: 'title', text: 'Chapter One' }] }
    ] },
    metadata: {
      selectedTocOptionId: 'toc', language: 'en_US', internalBookLinks: [],
      tocOptions: [{ id: 'toc', type: 'TITLE', children: [
        { type: 'CHAPTER', headerSectionLocationIds: ['header'], children: [
          { type: 'LEAF', sectionLocationIds: ['header', 'paragraph'] }
        ] }
      ] }],
      hiddenItemLocationIds: [{ id: 'hidden' }], sectionClassifications: [],
      itemStyles: { italic: [{ id: 'mars' }], bold: [{ id: 'hello', indexes: [0, 1] }] }
    }
  };
}

describe('Immer book adapter', () => {
  it('uses TOC order and preserves item IDs, overrides, styling and sentence offsets', () => {
    const book = adaptImmerBook(fixture());
    expect(book.metadata.language).toBe('en-US');
    expect(book.toc[0].label).toBe('Chapter One');
    expect(book.sections[0].blocks.map((block) => block.id)).toEqual(['header', 'paragraph']);
    expect(book.sections[0].blocks[0].kind).toBe('heading');
    const block = book.sections[0].blocks[1] as TextBlock;
    expect(block.text).toBe('Hello Mars. Goodbye.');
    expect(block.sentences.map((sentence) => sentence.text)).toEqual(['Hello Mars.', 'Goodbye.']);
    expect(block.inlineContent.filter((inline) => inline.marks.includes('bold')).map((inline) => inline.text).join('')).toBe('He');
    expect(block.inlineContent.find((inline) => inline.sourceItemLocationId === 'mars')?.marks).toContain('italic');
    expect(block.inlineContent.some((inline) => inline.sourceItemLocationId === 'hidden')).toBe(false);
    for (const sentence of block.sentences) {
      const inlines = sentence.inlineIds.map((id) => block.inlineContent.find((inline) => inline.id === id)!);
      expect(inlines.map((inline) => inline.text).join('').trim()).toBe(sentence.text);
      for (const inline of inlines) {
        expect(block.text.slice(inline.startOffset, inline.endOffset)).toBe(inline.text);
      }
    }
    expect(adaptImmerBook(fixture()).fingerprint).toBe(book.fingerprint);
  });

  it('keeps text around images and applies image overrides', () => {
    const data = fixture();
    data.locations.sections[0].itemLocationIds.splice(3, 0, {
      type: 'IMAGE', itemLocationId: 'image', uri: 'unused', width: 10, height: 20, mediaType: 'image/png', imageType: 'BASE64',
      override: { type: 'IMAGE', uri: 'https://example.com/image.png', width: 10, height: 20, mediaType: 'image/png', imageType: 'LINK' }
    });
    const blocks = adaptImmerBook(data).sections[0].blocks;
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'image', 'paragraph']);
    expect(blocks[2]).toMatchObject({ id: 'image', src: 'https://example.com/image.png' });
    expect((blocks[3] as TextBlock).text).toBe('Goodbye.');
  });

  it('preserves all selected API content and chapter structure', () => {
    const data: ImmerBookData = JSON.parse(readFileSync('public/immer-demo-book.json', 'utf8'));
    const book = adaptImmerBook(data);
    expect(book.metadata.title).toBe('The War Of The Worlds');
    expect(book.toc).toHaveLength(2);
    expect(book.toc.reduce((count, part) => count + part.children.length, 0)).toBe(26);
    expect(book.sections).toHaveLength(28);
    expect(book.totalBlocks).toBe(926);
    const blocks = book.sections.flatMap((section) => section.blocks) as TextBlock[];
    const sourceIds = new Set(blocks.flatMap((block) => block.inlineContent.map((inline) => inline.sourceItemLocationId)));
    expect(sourceIds.size).toBe(58522);
    const selectedIds = new Set<string>();
    const collect = (node: ImmerBookData['metadata']['tocOptions'][number]) => {
      node.headerSectionLocationIds?.forEach((id) => selectedIds.add(id));
      node.sectionLocationIds?.forEach((id) => selectedIds.add(id));
      node.children?.forEach(collect);
    };
    collect(data.metadata.tocOptions[0]);
    expect(blocks.map((block) => block.text).join(' ')).toBe(data.locations.sections.filter((section) => selectedIds.has(section.sectionLocationId))
      .flatMap((section) => section.itemLocationIds).map((item) => item.type === 'TEXT' ? item.text : '').join(' '));
    expect(blocks.flatMap((block) => block.inlineContent).some((inline) => inline.marks.includes('italic'))).toBe(true);
  });

  it('reports a failed download', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    try {
      await expect(loadDemoImmerBook()).rejects.toThrow('Could not load the Immer demo book (503).');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
