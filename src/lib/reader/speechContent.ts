import type { CanonicalBook, TextBlock } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';

export interface SpokenWord {
  blockId: string;
  startOffset: number;
  endOffset: number;
}

export interface SpeechWord extends SpokenWord {
  charStart: number;
  charEnd: number;
}

export interface SpeechChunk {
  text: string;
  words: SpeechWord[];
}

export function estimateWordDurations(chunk: SpeechChunk, firstWord: number, rate: number): number[] {
  return chunk.words.slice(firstWord).map((word, index) => {
    const next = chunk.words[firstWord + index + 1];
    const punctuation = chunk.text.slice(word.charEnd, next?.charStart ?? chunk.text.length);
    const pause = /[.!?…]/u.test(punctuation) ? 250 : /[,;:—]/u.test(punctuation) ? 120 : 0;
    return (200 + Math.min(20, word.charEnd - word.charStart) * 25 + pause) / Math.min(2, Math.max(0.5, rate));
  });
}

export function getSpeechChunks(book: CanonicalBook, portion: ReaderPortion | null): SpeechChunk[] {
  if (!portion) return [];
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(book.metadata.language?.replaceAll('_', '-'), { granularity: 'word' });
  } catch {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  const chunks: SpeechChunk[] = [];
  const blocks = new Map(book.sections.flatMap((section) => section.blocks)
    .filter((block): block is TextBlock => 'sentences' in block)
    .map((block) => [block.id, block]));
  for (const slice of portion.blocks) {
    if (slice.type !== 'text') continue;
    const block = blocks.get(slice.blockId);
    const fragments = slice.lines.flatMap((line) => line.fragments)
      .filter((fragment) => fragment.blockStart !== undefined && fragment.blockEnd !== undefined);
    if (!block || fragments.length === 0) continue;
    const start = Math.min(...fragments.map((fragment) => fragment.blockStart!));
    const end = Math.max(...fragments.map((fragment) => fragment.blockEnd!));
    for (const sentence of block.sentences) {
      const from = Math.max(start, sentence.startOffset);
      const to = Math.min(end, sentence.endOffset);
      if (to <= from) continue;
      const text = block.text.slice(from, to);
      const words = Array.from(segmenter.segment(text)).filter((segment) => segment.isWordLike);
      if (words.length === 0) continue;
      chunks.push({
        text,
        words: words.map((word) => ({
          blockId: block.id,
          startOffset: from + word.index,
          endOffset: from + word.index + word.segment.length,
          charStart: word.index,
          charEnd: word.index + word.segment.length
        }))
      });
    }
  }
  return chunks;
}
