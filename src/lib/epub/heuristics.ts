import type {
  BookComputedStyle,
  BookSection,
  ParseDiagnostic,
  SectionMatter,
  TextBlock,
  TocEntry
} from '../../types/book';
import { stripFragment } from './path';

const FRONT_MATTER_PATTERNS = [
  /\babout the author\b/,
  /\backnowledg(e)?ments?\b/,
  /\bafterword\b/,
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
  /\bpraise\b/,
  /\bpreface\b/,
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

const BACK_MATTER_PATTERNS = [
  /\babout the author\b/,
  /\backnowledg(e)?ments?\b/,
  /\bafterword\b/,
  /\bappendix\b/,
  /\bbibliograph(?:y|ies)\b/,
  /\bendnotes?\b/,
  /\bglossary\b/,
  /\bindex\b/,
  /\bnotes?\b/,
  /\breferences\b/
];

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenToc(entries: TocEntry[]): TocEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenToc(entry.children)]);
}

function hasHeadingLabel(section: BookSection): boolean {
  return getTextBlocks(section).some((block) => block.kind === 'heading');
}

function isSubstantialSection(section: BookSection): boolean {
  const textBlocks = getTextBlocks(section);
  const textLength = textBlocks.reduce((total, block) => total + block.text.length, 0);
  const sentenceCount = textBlocks.reduce((total, block) => total + block.sentences.length, 0);
  return sentenceCount >= 3 || textLength >= 320;
}

function findLastMatchingIndex<T>(
  values: T[],
  predicate: (value: T, index: number) => boolean
): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) {
      return index;
    }
  }
  return -1;
}

function getTextBlocks(section: BookSection): TextBlock[] {
  return section.blocks.filter(
    (block): block is TextBlock =>
      block.kind === 'heading' ||
      block.kind === 'paragraph' ||
      block.kind === 'quote' ||
      block.kind === 'list-item'
  );
}

function styleSignature(style?: BookComputedStyle): string {
  if (!style) {
    return '';
  }

  return [
    style.fontFamily,
    style.fontStyle,
    style.fontWeight,
    style.fontVariant,
    style.textAlign,
    style.display
  ].join('|');
}

function findBestStyleSignature(section: BookSection): string {
  const signatures = new Map<string, number>();
  getTextBlocks(section).forEach((block) => {
    if (block.kind === 'heading') {
      return;
    }

    const signature = styleSignature(block.computedStyle);
    if (!signature) {
      return;
    }

    signatures.set(signature, (signatures.get(signature) ?? 0) + block.text.length);
  });

  let best = '';
  let bestWeight = -1;
  signatures.forEach((weight, signature) => {
    if (weight >= bestWeight) {
      best = signature;
      bestWeight = weight;
    }
  });

  return best;
}

function buildSectionSearchText(section: BookSection): string {
  const headings = getTextBlocks(section)
    .filter((block) => block.kind === 'heading')
    .map((block) => block.text);
  const preview = getTextBlocks(section)
    .slice(0, 3)
    .map((block) => block.text)
    .join(' ');

  return normalizeForMatching(
    [section.label, section.navLabel, section.href, ...headings, preview].filter(Boolean).join(' ')
  );
}

function findSectionMatch(entry: TocEntry, sections: BookSection[]): number {
  const hrefWithoutFragment = stripFragment(entry.href);
  const fragment = entry.href.includes('#') ? entry.href.slice(entry.href.indexOf('#') + 1) : '';

  const fragmentMatch = fragment
    ? sections.findIndex(
        (section) =>
          stripFragment(section.href) === hrefWithoutFragment && section.anchorIds.includes(fragment)
      )
    : -1;
  if (fragmentMatch >= 0) {
    return fragmentMatch;
  }

  return sections.findIndex((section) => stripFragment(section.href) === hrefWithoutFragment);
}

export function hasUsableToc(toc: TocEntry[], sections: BookSection[]): boolean {
  const flatToc = flattenToc(toc);
  if (flatToc.length === 0) {
    return false;
  }

  const matchedCount = flatToc.reduce((count, entry) => {
    return count + (findSectionMatch(entry, sections) >= 0 ? 1 : 0);
  }, 0);

  if (flatToc.length === 1) {
    return matchedCount === 1;
  }

  const requiredMatches = Math.max(2, Math.ceil(flatToc.length * 0.35));
  return matchedCount >= requiredMatches;
}

function isReciprocalFootnoteSection(
  section: BookSection,
  sectionIndex: number,
  sections: BookSection[]
): boolean {
  const textBlocks = getTextBlocks(section);
  const textLength = textBlocks.reduce((total, block) => total + block.text.length, 0);
  const sentenceCount = textBlocks.reduce((total, block) => total + block.sentences.length, 0);
  if (textLength > 900 || sentenceCount > 8 || section.localLinks.length === 0) {
    return false;
  }

  const ownTargets = new Set(section.anchorIds.map((anchorId) => `${stripFragment(section.href)}#${anchorId}`));

  return section.localLinks.some((link) => {
    const ownerIndex = sections.findIndex((candidate, candidateIndex) => {
      if (candidateIndex >= sectionIndex) {
        return false;
      }
      return candidate.anchorIds.some(
        (anchorId) => `${stripFragment(candidate.href)}#${anchorId}` === link
      );
    });

    if (ownerIndex < 0) {
      return false;
    }

    return sections[ownerIndex].localLinks.some((candidateLink) => ownTargets.has(candidateLink));
  });
}

export function inferTextBlockKind(
  tag: string,
  text: string,
  style?: BookComputedStyle
): TextBlock['kind'] {
  if (/^h[1-6]$/.test(tag)) {
    return 'heading';
  }
  if (tag === 'blockquote') {
    return 'quote';
  }
  if (tag === 'li') {
    return 'list-item';
  }

  const normalized = text.trim();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const shortText = normalized.length <= 120 && wordCount <= 14;
  const centered = style?.textAlign === 'center';
  const italic = style?.fontStyle === 'italic' || style?.fontStyle === 'oblique';
  const smallCaps = style?.fontVariant.toLowerCase().includes('small-caps');
  const numericWeight = Number.parseInt(style?.fontWeight ?? '', 10);
  const bold = style?.fontWeight === 'bold' || Number.isFinite(numericWeight) && numericWeight >= 600;
  const hasPageBreakHint =
    style?.cssDefinedPageBreak === 'before' || style?.cssDefinedPageBreak === 'after';

  if (shortText && (centered || bold || smallCaps || hasPageBreakHint)) {
    return 'heading';
  }

  if (shortText && centered && italic) {
    return 'quote';
  }

  return 'paragraph';
}

export function classifySections(
  sections: BookSection[],
  toc: TocEntry[],
  diagnostics: ParseDiagnostic[]
): BookSection[] {
  const flatToc = flattenToc(toc);
  const tocAssignments = new Map<number, { label: string; depth: number }>();

  flatToc.forEach((entry) => {
    const sectionIndex = findSectionMatch(entry, sections);
    if (sectionIndex < 0 || tocAssignments.has(sectionIndex)) {
      return;
    }
    tocAssignments.set(sectionIndex, { label: entry.label, depth: entry.depth });
  });

  if (flatToc.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'No navigable table of contents was found; section classification uses content heuristics only.'
    });
  }

  const textLengths = sections.map((section) =>
    getTextBlocks(section).reduce((total, block) => total + block.text.length, 0)
  );
  const averageTextLength =
    textLengths.length > 0
      ? textLengths.reduce((total, length) => total + length, 0) / textLengths.length
      : 0;

  const summaries = sections.map((section, index) => {
    const searchText = buildSectionSearchText(section);
    const textBlocks = getTextBlocks(section);
    const sentenceCount = textBlocks.reduce((total, block) => total + block.sentences.length, 0);

    return {
      index,
      section,
      searchText,
      sentenceCount,
      textLength: textLengths[index],
      substantial: sentenceCount >= 3 || textLengths[index] >= 320,
      styleSignature: findBestStyleSignature(section),
      footnoteLike: isReciprocalFootnoteSection(section, index, sections)
    };
  });

  const styleCounts = new Map<string, number>();
  summaries.forEach((summary) => {
    if (!summary.styleSignature || !summary.substantial) {
      return;
    }
    styleCounts.set(
      summary.styleSignature,
      (styleCounts.get(summary.styleSignature) ?? 0) + 1
    );
  });

  let dominantStyle = '';
  let dominantStyleCount = -1;
  Array.from(styleCounts.entries()).forEach(([signature, count]) => {
    if (count >= dominantStyleCount) {
      dominantStyle = signature;
      dominantStyleCount = count;
    }
  });

  let bodyStartIndex = summaries.findIndex(
    (summary) =>
      !FRONT_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText)) &&
      BODY_START_PATTERNS.some((pattern) => pattern.test(summary.searchText))
  );

  if (bodyStartIndex < 0) {
    bodyStartIndex = summaries.findIndex(
      (summary) =>
        !FRONT_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText)) &&
        !summary.footnoteLike &&
        (summary.styleSignature === dominantStyle || summary.textLength >= averageTextLength) &&
        summary.substantial
    );
  }

  if (bodyStartIndex < 0) {
    bodyStartIndex = summaries.findIndex((summary) => summary.textLength > 0);
  }

  let bodyEndIndex = summaries.length - 1;
  const explicitBackMatter = summaries.findIndex(
    (summary, index) =>
      index > bodyStartIndex &&
      BACK_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText))
  );
  if (explicitBackMatter > bodyStartIndex) {
    bodyEndIndex = explicitBackMatter - 1;
  } else {
    const fallbackBodyEnd = findLastMatchingIndex(
      summaries,
      (summary, index) =>
        index >= bodyStartIndex &&
        !summary.footnoteLike &&
        (summary.styleSignature === dominantStyle || summary.substantial)
    );
    if (fallbackBodyEnd >= bodyStartIndex) {
      bodyEndIndex = fallbackBodyEnd;
    }
  }

  return sections.map((section, index) => {
    const tocAssignment = tocAssignments.get(index);
    const summary = summaries[index];
    let matter: SectionMatter;

    if (summary.footnoteLike || BACK_MATTER_PATTERNS.some((pattern) => pattern.test(summary.searchText))) {
      matter = 'back';
    } else if (index < bodyStartIndex) {
      matter = 'front';
    } else if (index > bodyEndIndex) {
      matter = 'back';
    } else {
      matter = 'body';
    }

    const firstHeading = getTextBlocks(section).find((block) => block.kind === 'heading');
    const nextLabel = tocAssignment?.label || firstHeading?.text || section.label;

    return {
      ...section,
      label: nextLabel,
      navLabel: tocAssignment?.label,
      tocDepth: tocAssignment?.depth,
      matter
    };
  });
}

function inferDerivedTocDepth(section: BookSection): number {
  const normalizedLabel = normalizeForMatching(section.label);
  if (/^(?:part|book)\b/.test(normalizedLabel)) {
    return 0;
  }
  if (/^(?:chapter|introduction|prologue|epilogue)\b/.test(normalizedLabel)) {
    return 1;
  }

  const firstHeading = getTextBlocks(section).find((block) => block.kind === 'heading');
  if (typeof firstHeading?.level === 'number') {
    return Math.max(0, Math.min(2, firstHeading.level - 1));
  }

  return 1;
}

export function deriveTocFromSections(sections: BookSection[]): TocEntry[] {
  const candidates = sections.filter(
    (section) =>
      section.matter === 'body' &&
      getTextBlocks(section).length > 0 &&
      (hasHeadingLabel(section) || isSubstantialSection(section))
  );

  const root: TocEntry[] = [];
  const stack: TocEntry[] = [];

  candidates.forEach((section, index) => {
    const entry: TocEntry = {
      id: `derived-toc-${index}`,
      label: section.label,
      href: section.href,
      depth: inferDerivedTocDepth(section),
      children: []
    };

    while (stack.length > 0 && stack[stack.length - 1].depth >= entry.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(entry);
    } else {
      stack[stack.length - 1].children.push(entry);
    }

    stack.push(entry);
  });

  return root;
}
