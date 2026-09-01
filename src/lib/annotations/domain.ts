import type { CanonicalBook } from '../../types/book';
import type {
  AnnotationSelection,
  TextAnnotation
} from '../../types/reader';
import { clampAnchorToBook } from '../reader/anchors';

export function createAnnotationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTextAnnotation(
  book: CanonicalBook,
  selection: AnnotationSelection,
  note: string,
  now = new Date().toISOString()
): TextAnnotation {
  return {
    id: createAnnotationId(),
    fingerprint: book.fingerprint,
    locator: clampAnchorToBook(book, {
      blockId: selection.blockId,
      blockOrder: selection.blockOrder,
      sentenceIndex: selection.sentenceIndex,
      lineOffset: 0,
      excerpt: selection.selectedText.slice(0, 160)
    }),
    blockId: selection.blockId,
    blockOrder: selection.blockOrder,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    sentenceIndex: selection.sentenceIndex,
    selectedText: selection.selectedText,
    rects: selection.rects,
    note: note.trim(),
    createdAt: now,
    updatedAt: now
  };
}

export function groupAnnotationsByBlock(
  annotations: TextAnnotation[]
): Map<string, TextAnnotation[]> {
  const grouped = new Map<string, TextAnnotation[]>();

  annotations.forEach((annotation) => {
    const entries = grouped.get(annotation.blockId) ?? [];
    entries.push(annotation);
    grouped.set(annotation.blockId, entries);
  });

  grouped.forEach((entries) =>
    entries.sort((left, right) => left.startOffset - right.startOffset || left.endOffset - right.endOffset)
  );

  return grouped;
}
