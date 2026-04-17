import type { CanonicalBook } from '../../types/book';
import type { ReaderAnchor, ReaderPortion } from '../../types/reader';
import { findPortionIndexForAnchor } from '../portioning/paginateBook';

const FRONT_MATTER_PATTERNS = [
  /\babout the author\b/,
  /\backnowledg(e)?ments?\b/,
  /\backnowledgements?\b/,
  /\bappendix\b/,
  /\bauthor'?s note\b/,
  /\bcontents?\b/,
  /\bcopyright\b/,
  /\bcover\b/,
  /\bcredits?\b/,
  /\bdedication\b/,
  /\bepigraph\b/,
  /\bforeword\b/,
  /\bfront ?matter\b/,
  /\bhalf[- ]title\b/,
  /\bimprint\b/,
  /\bnav(?:igation)?\b/,
  /\bnotes on\b/,
  /\bpraise\b/,
  /\bpreface\b/,
  /\btable of contents\b/,
  /\btitle page\b/,
  /\btoc\b/
];

const BODY_START_PATTERNS = [
  /\bintroduction\b/,
  /\bintro\b/,
  /\bprologue\b/,
  /\bchapter\s*(?:1|one)\b/,
  /\bpart\s*(?:1|one)\b/,
  /\bbook\s*(?:1|one)\b/
];

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTextualBlock(
  block: CanonicalBook['sections'][number]['blocks'][number]
): block is CanonicalBook['sections'][number]['blocks'][number] & { text: string; sentences: unknown[] } {
  return (
    block.kind === 'heading' ||
    block.kind === 'paragraph' ||
    block.kind === 'quote' ||
    block.kind === 'list-item'
  );
}

function getAnchorForSection(section: CanonicalBook['sections'][number]): ReaderAnchor {
  const firstTextualBlock = section.blocks.find(isTextualBlock);
  const firstBlock = firstTextualBlock ?? section.blocks[0];

  return {
    blockId: firstBlock.id,
    blockOrder: firstBlock.order,
    sentenceIndex: 0,
    lineOffset: 0
  };
}

function summarizeSection(section: CanonicalBook['sections'][number]) {
  const textualBlocks = section.blocks.filter(isTextualBlock);
  const headings = textualBlocks.filter((block) => block.kind === 'heading');
  const firstHeading = headings[0]?.text ?? '';
  const previewText = textualBlocks
    .slice(0, 3)
    .map((block) => block.text)
    .join(' ');
  const searchText = normalizeForMatching(
    [section.label, section.href, firstHeading, previewText].filter(Boolean).join(' ')
  );
  const textLength = textualBlocks.reduce((total, block) => total + block.text.trim().length, 0);
  const sentenceCount = textualBlocks.reduce((total, block) => total + block.sentences.length, 0);

  return {
    section,
    searchText,
    textLength,
    sentenceCount,
    textualBlockCount: textualBlocks.length
  };
}

export function getInitialAnchor(book: CanonicalBook): ReaderAnchor {
  const firstSection = book.sections[0];
  return getAnchorForSection(firstSection);
}

export function getPreferredStartAnchor(book: CanonicalBook): ReaderAnchor {
  if (book.sections.length === 0) {
    throw new Error('Cannot derive a start anchor for an empty book.');
  }

  const summaries = book.sections.map(summarizeSection);
  const strongStart = summaries.find(
    (summary) =>
      summary.textualBlockCount > 0 &&
      !FRONT_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText)) &&
      BODY_START_PATTERNS.some((pattern) => pattern.test(summary.searchText))
  );

  if (strongStart) {
    return getAnchorForSection(strongStart.section);
  }

  let skippedFrontMatter = false;
  let firstReadable: (typeof summaries)[number] | null = null;

  for (const summary of summaries) {
    if (summary.textualBlockCount === 0) {
      skippedFrontMatter = true;
      continue;
    }

    if (FRONT_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText))) {
      skippedFrontMatter = true;
      continue;
    }

    if (!firstReadable) {
      firstReadable = summary;
    }

    const substantial = summary.sentenceCount >= 3 || summary.textLength >= 320;
    if (skippedFrontMatter || substantial) {
      return getAnchorForSection(summary.section);
    }
  }

  if (firstReadable) {
    return getAnchorForSection(firstReadable.section);
  }

  return getInitialAnchor(book);
}

export function clampAnchorToBook(book: CanonicalBook, anchor?: ReaderAnchor): ReaderAnchor {
  if (!anchor) {
    return getInitialAnchor(book);
  }

  for (const section of book.sections) {
    for (const block of section.blocks) {
      if (block.id === anchor.blockId) {
        return {
          blockId: block.id,
          blockOrder: block.order,
          sentenceIndex: anchor.sentenceIndex,
          lineOffset: anchor.lineOffset
        };
      }
    }
  }

  return getInitialAnchor(book);
}

export function preserveAnchorAfterRepagination(
  portions: ReaderPortion[],
  anchor: ReaderAnchor
): number {
  return findPortionIndexForAnchor(portions, anchor);
}
