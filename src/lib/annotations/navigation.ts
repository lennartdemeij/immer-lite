import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import { findPortionIndexForAnchor } from '../portioning/paginateBook';

/** Derives current reader markers after every pagination pass. */
export function getAnnotationPortionIndexes(
  annotations: TextAnnotation[],
  portions: ReaderPortion[]
): Set<number> {
  const indexes = new Set<number>();

  annotations.forEach((annotation) => {
    const index = findPortionIndexForAnchor(portions, {
      blockId: annotation.blockId,
      blockOrder: annotation.blockOrder,
      sentenceIndex: annotation.sentenceIndex,
      lineOffset: 0,
      locator: annotation.locator?.locator,
      sectionId: annotation.locator?.sectionId,
      sectionIndex: annotation.locator?.sectionIndex,
      sectionHref: annotation.locator?.sectionHref,
      excerpt: annotation.selectedText
    });
    if (index >= 0) {
      indexes.add(index);
    }
  });

  return indexes;
}
