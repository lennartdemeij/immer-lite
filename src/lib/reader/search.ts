import type { CanonicalBook, TextBlock } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';

export interface BookSearchEntry {
  block: TextBlock;
  sectionLabel: string;
}

export interface BookSearchResult {
  blockId: string;
  sectionLabel: string;
  startOffset: number;
  endOffset: number;
  before: string;
  match: string;
  after: string;
}

export function createBookSearchIndex(book: CanonicalBook): BookSearchEntry[] {
  return book.sections.flatMap((section) => section.blocks.flatMap((block) =>
    'text' in block ? [{ block, sectionLabel: section.label }] : []
  ));
}

export function searchBook(index: BookSearchEntry[], query: string): BookSearchResult[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'giu');
  const results: BookSearchResult[] = [];
  for (const { block, sectionLabel } of index) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block.text))) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      const from = Math.max(0, startOffset - 45);
      const to = Math.min(block.text.length, endOffset + 80);
      results.push({
        blockId: block.id, sectionLabel, startOffset, endOffset,
        before: `${from ? '…' : ''}${block.text.slice(from, startOffset)}`,
        match: match[0], after: `${block.text.slice(endOffset, to)}${to < block.text.length ? '…' : ''}`
      });
      if (results.length === 5) return results;
    }
  }
  return results;
}

type TextPortionIndex = Map<string, { index: number; start: number; end: number }[]>;

/** Character offsets also locate matches inside sentences split across pages. */
export function createTextPortionIndex(portions: ReaderPortion[]): TextPortionIndex {
  const index: TextPortionIndex = new Map();
  portions.forEach((portion, portionIndex) => portion.blocks.forEach((block) => {
    if (block.type !== 'text') return;
    const fragments = block.lines.flatMap((line) => line.fragments);
    const starts = fragments.flatMap((fragment) => fragment.blockStart === undefined ? [] : [fragment.blockStart]);
    const ends = fragments.flatMap((fragment) => fragment.blockEnd === undefined ? [] : [fragment.blockEnd]);
    if (!starts.length || !ends.length) return;
    const entries = index.get(block.blockId) ?? [];
    entries.push({ index: portionIndex, start: Math.min(...starts), end: Math.max(...ends) });
    index.set(block.blockId, entries);
  }));
  return index;
}

export function findTextPortionIndex(index: TextPortionIndex, blockId: string, offset: number): number {
  const entries = index.get(blockId);
  if (!entries?.length) return -1;
  return (entries.find((entry) => offset < entry.end) ?? entries[entries.length - 1]).index;
}
