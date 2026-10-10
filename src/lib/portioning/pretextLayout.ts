import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges
} from '@chenglou/pretext/rich-inline';
import type { BookInline, TextBlock } from '../../types/book';
import type {
  PortionTextSlice,
  ReaderSettings,
  RenderFragment,
  RenderLine,
  ViewportMetrics
} from '../../types/reader';
import { getBlockTypography, getInlineFont } from './styleMap';
import { hyphenateText } from './hyphenation';

interface RichItemMeta {
  text: string;
  font: string;
  marks: string[];
  href?: string;
  blockStart?: number;
  blockEnd?: number;
  leadingSpaceOffset?: number;
}

interface RichSlice {
  items: Array<{
    text: string;
    font: string;
    break?: 'normal' | 'never';
  }>;
  meta: RichItemMeta[];
}

interface MaterializedRichFragment {
  itemIndex: number;
  gapBefore: number;
  text: string;
  start: {
    segmentIndex: number;
    graphemeIndex: number;
  };
}

interface MaterializedRichLine {
  fragments: MaterializedRichFragment[];
}

interface PreparedSlice {
  slice: RichSlice;
  prepared: ReturnType<typeof prepareRichInline>;
  width?: number;
  lineCount?: number;
  lines?: RenderLine[];
}

// Canonical blocks are immutable. Retain only the latest typography and a
// bounded set of candidate sentence ranges; closed books can be collected.
const preparedSlices = new WeakMap<TextBlock, { fontKey: string; slices: Map<string, PreparedSlice> }>();
const inlineIndexes = new WeakMap<TextBlock, Map<string, BookInline>>();

function getPreparedSlice(block: TextBlock, start: number, end: number, settings: ReaderSettings): PreparedSlice {
  const fontKey = `${settings.fontSize}:${settings.theme === 'paperback'}`;
  let cache = preparedSlices.get(block);
  if (!cache || cache.fontKey !== fontKey) {
    cache = { fontKey, slices: new Map() };
    preparedSlices.set(block, cache);
  }
  const key = `${start}:${end}:${Boolean(settings.hyphenation)}:${settings.hyphenationLanguage ?? ''}`;
  let entry = cache.slices.get(key);
  if (!entry) {
    const slice = buildRichSlice(block, start, end, settings);
    entry = { slice, prepared: prepareRichInline(slice.items) };
    if (cache.slices.size >= 16) {
      cache.slices.delete(cache.slices.keys().next().value!);
    }
    cache.slices.set(key, entry);
  }
  return entry;
}

function setSliceWidth(entry: PreparedSlice, width: number) {
  if (entry.width !== width) {
    entry.width = width;
    entry.lineCount = undefined;
    entry.lines = undefined;
  }
}

function dedupeMarks(marks: string[]): string[] {
  return Array.from(new Set(marks));
}

function getSentenceInlineSlice(
  block: TextBlock,
  sentenceIndex: number
): BookInline[] {
  const sentence = block.sentences[sentenceIndex];
  let byId = inlineIndexes.get(block);
  if (!byId) {
    byId = new Map(block.inlineContent.map((inline) => [inline.id, inline]));
    inlineIndexes.set(block, byId);
  }
  return sentence.inlineIds
    .map((id) => byId.get(id))
    .filter((value): value is BookInline => Boolean(value));
}

function normalizeSentenceInlines(inlines: BookInline[]): BookInline[] {
  const trimmed = inlines
    .map((inline, index): BookInline | null => {
      let text = inline.text;
      let startOffset = inline.startOffset;
      if (index === 0) {
        text = text.replace(/^\s+/, '');
        if (typeof startOffset === 'number') startOffset += inline.text.length - text.length;
      }
      if (index === inlines.length - 1) {
        text = text.replace(/\s+$/, '');
      }
      if (text.length === 0) {
        return null;
      }
      return {
        ...inline,
        text,
        startOffset
      };
    })
    .filter((value): value is BookInline => Boolean(value));

  const normalized: BookInline[] = [];

  for (const inline of trimmed) {
    if (/^\s+$/.test(inline.text)) {
      const nextSpace = inline.text.replace(/\s+/g, ' ');
      const previous = normalized[normalized.length - 1];

      if (previous) {
        previous.text = `${previous.text}${nextSpace}`;
        previous.endOffset = inline.endOffset ?? previous.endOffset;
        continue;
      }
    }

    normalized.push({ ...inline });
  }

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];
    const trailingSpaceMatch = current.text.match(/\s+$/);

    if (!trailingSpaceMatch || /^\s+$/.test(current.text)) {
      continue;
    }

    const normalizedSpace = trailingSpaceMatch[0].replace(/\s+/g, ' ');
    current.text = current.text.slice(0, -trailingSpaceMatch[0].length);
    current.endOffset =
      typeof current.endOffset === 'number'
        ? current.endOffset - trailingSpaceMatch[0].length
        : current.endOffset;
    next.text = `${normalizedSpace}${next.text}`;
    if (typeof current.endOffset === 'number') {
      next.startOffset = current.endOffset;
    }
  }

  return normalized.filter((inline) => inline.text.length > 0);
}

export function buildRichSlice(
  block: TextBlock,
  startSentence: number,
  endSentence: number,
  settings: ReaderSettings
): RichSlice {
  const items: RichSlice['items'] = [];
  const meta: RichItemMeta[] = [];

  for (let index = startSentence; index < endSentence; index += 1) {
    const sentenceInlines = normalizeSentenceInlines(getSentenceInlineSlice(block, index));

    if (index > startSentence && sentenceInlines.length > 0) {
      const firstInline = sentenceInlines[0];
      const leadingSpaceOffset =
        typeof firstInline.startOffset === 'number' &&
        firstInline.startOffset > 0 &&
        /\s/.test(block.text[firstInline.startOffset - 1] ?? '')
          ? firstInline.startOffset - 1
          : undefined;
      sentenceInlines[0] = {
        ...firstInline,
        text: /^\s/.test(firstInline.text) ? firstInline.text : ` ${firstInline.text}`,
        startOffset: firstInline.startOffset,
        endOffset: firstInline.endOffset
      };
      (sentenceInlines[0] as BookInline & { leadingSpaceOffset?: number }).leadingSpaceOffset =
        leadingSpaceOffset;
    }

    sentenceInlines.forEach((inline) => {
      items.push({
        text: settings.hyphenation && !inline.href && block.kind !== 'heading'
          ? hyphenateText(inline.text, settings.hyphenationLanguage)
          : inline.text.replace(/\u00ad/g, ''),
        font: getInlineFont(settings, inline.marks, block.kind)
      });
      const leadingSpaceOffset = (inline as BookInline & { leadingSpaceOffset?: number }).leadingSpaceOffset;
      meta.push({
        text: inline.text,
        font: getInlineFont(settings, inline.marks, block.kind),
        marks: dedupeMarks(inline.marks),
        href: inline.href,
        blockStart: inline.startOffset,
        blockEnd: inline.endOffset,
        leadingSpaceOffset
      });
    });
  }

  return { items, meta };
}

function fragmentStartsItemBoundary(fragment: MaterializedRichFragment): boolean {
  return fragment.start.segmentIndex === 0 && fragment.start.graphemeIndex === 0;
}

function itemHasCollapsedLeadingSpace(
  item: RichSlice['items'][number] | undefined
): boolean {
  return item ? /^[ \t\n\f\r]+/.test(item.text) : false;
}

export function restoreCollapsedSpacesForRender(
  lines: MaterializedRichLine[],
  slice: RichSlice
): RenderLine[] {
  const renderedLines: RenderLine[] = [];
  const itemTextOffsets = new Map<number, number>();

  lines.forEach((line, lineIndex) => {
    const fragments: RenderFragment[] = [];

    line.fragments.forEach((fragment, fragmentIndex) => {
      const meta = slice.meta[fragment.itemIndex];
      const item = slice.items[fragment.itemIndex];
      let text = fragment.text;
      const localCursor = itemTextOffsets.get(fragment.itemIndex) ?? 0;
      let blockStart =
        typeof meta?.blockStart === 'number' ? meta.blockStart + localCursor : undefined;
      let blockEnd =
        typeof blockStart === 'number' ? blockStart + fragment.text.length : undefined;
      itemTextOffsets.set(fragment.itemIndex, localCursor + fragment.text.length);

      if (
        fragmentStartsItemBoundary(fragment) &&
        itemHasCollapsedLeadingSpace(item)
      ) {
        // A restored inline space occupies a canonical character. A synthetic
        // sentence separator instead has its own leadingSpaceOffset.
        if (typeof meta?.leadingSpaceOffset !== 'number') {
          itemTextOffsets.set(fragment.itemIndex, localCursor + fragment.text.length + 1);
          if (typeof blockEnd === 'number') blockEnd += 1;
        }
        const previousFragmentInLine = fragments[fragments.length - 1];
        if (previousFragmentInLine) {
          text = ` ${text}`;
          if (typeof meta?.leadingSpaceOffset === 'number') {
            blockStart = meta.leadingSpaceOffset;
          }
        } else {
          if (typeof meta?.leadingSpaceOffset !== 'number' && typeof blockStart === 'number') {
            blockStart += 1;
          }
          const previousLine = renderedLines[lineIndex - 1];
          const previousLineFragment = previousLine?.fragments[previousLine.fragments.length - 1];
          if (previousLineFragment && !/\s$/.test(previousLineFragment.text)) {
            previousLineFragment.text = `${previousLineFragment.text} `;
            if (typeof meta?.leadingSpaceOffset === 'number') {
              previousLineFragment.blockEnd = meta.leadingSpaceOffset + 1;
              blockStart = meta.leadingSpaceOffset + 1;
              blockEnd =
                typeof blockStart === 'number' ? blockStart + fragment.text.length : undefined;
            } else if (typeof meta?.blockStart === 'number') {
              previousLineFragment.blockEnd = meta.blockStart + 1;
            }
          }
        }
      }

      fragments.push({
        key: `fragment-${lineIndex}-${fragmentIndex}`,
        text,
        font: meta?.font ?? item?.font ?? '',
        marks: meta?.marks ?? [],
        href: meta?.href,
        blockStart,
        blockEnd
      });
    });

    renderedLines.push({
      key: `line-${lineIndex}`,
      fragments
    });
  });

  return renderedLines;
}

// Pretext hides soft hyphens and adds a visible dash only at a chosen break.
// Keep that dash separate from canonical text so selection/search/TTS offsets
// never count layout-only characters.
export function restoreHyphenatedLines(lines: MaterializedRichLine[], slice: RichSlice): RenderLine[] {
  const cursors = new Map<number, number>();
  const rendered: RenderLine[] = [];
  const sources = slice.meta.map((meta) => {
    const start = meta.leadingSpaceOffset ?? meta.blockStart ?? 0;
    const offsets: number[] = [];
    let text = '';
    for (let index = 0; index < meta.text.length; index += 1) {
      if (meta.text[index] === '\u00ad') continue;
      text += meta.text[index];
      offsets.push(start + index);
    }
    return { text, offsets };
  });
  for (const [lineIndex, line] of lines.entries()) {
    const fragments: RenderFragment[] = [];
    const appendSource = (itemIndex: number, start: number, end: number, target = fragments) => {
      const meta = slice.meta[itemIndex];
      const { text: source, offsets } = sources[itemIndex];
      for (let run = start; run < end;) {
        let stop = run + 1;
        while (stop < end && offsets[stop] === offsets[stop - 1] + 1) stop += 1;
        target.push({ key: `hyphen-${lineIndex}-${target.length}`, text: source.slice(run, stop),
          font: meta.font, marks: meta.marks, href: meta.href,
          blockStart: typeof meta.blockStart === 'number' ? offsets[run] : undefined,
          blockEnd: typeof meta.blockStart === 'number' ? offsets[stop - 1] + 1 : undefined });
        run = stop;
      }
    };
    for (const fragment of line.fragments) {
      const meta = slice.meta[fragment.itemIndex];
      const source = sources[fragment.itemIndex].text;
      const cursor = cursors.get(fragment.itemIndex) ?? 0;
      const visible = fragment.text.replace(/\u00ad/g, '');
      const fullStart = source.indexOf(visible, cursor);
      const withoutDash = visible.endsWith('-') ? visible.slice(0, -1) : null;
      const brokenStart = withoutDash ? source.indexOf(withoutDash, cursor) : -1;
      const generatedDash = brokenStart >= 0 && (fullStart < 0 || brokenStart < fullStart);
      const text = generatedDash ? withoutDash! : visible;
      const start = generatedDash ? brokenStart : fullStart;
      if (start < 0) throw new Error('Unable to map hyphenated text to the publication');
      if (start > cursor && /^\s+$/.test(source.slice(cursor, start))) {
        // Retain collapsed separators for cross-line selection and search.
        const previous = fragments.length ? fragments : rendered.at(-1)?.fragments;
        if (previous?.length) appendSource(fragment.itemIndex, cursor, start, previous);
      }
      appendSource(fragment.itemIndex, start, start + text.length);
      if (generatedDash) fragments.push({ key: `hyphen-${lineIndex}-${fragments.length}`,
        text: '-', font: meta.font, marks: meta.marks, href: meta.href });
      cursors.set(fragment.itemIndex, start + text.length);
    }
    rendered.push({ key: `line-${lineIndex}`, fragments });
  }
  return rendered;
}

function materializeLines(
  entry: PreparedSlice,
  width: number
): RenderLine[] {
  setSliceWidth(entry, width);
  if (entry.lines) {
    return entry.lines;
  }
  const { prepared, slice } = entry;
  const materializedLines: MaterializedRichLine[] = [];

  walkRichInlineLineRanges(prepared, width, (range) => {
    const materialized = materializeRichInlineLineRange(prepared, range);
    materializedLines.push({
      fragments: materialized.fragments.map((fragment) => ({
        itemIndex: fragment.itemIndex,
        gapBefore: fragment.gapBefore,
        text: fragment.text,
        start: fragment.start
      }))
    });
  });

  entry.lines = slice.items.some((item, index) => item.text.includes('\u00ad') || slice.meta[index].text.includes('\u00ad'))
    ? restoreHyphenatedLines(materializedLines, slice)
    : restoreCollapsedSpacesForRender(materializedLines, slice);
  entry.lineCount = entry.lines.length;
  return entry.lines;
}

export interface TextSliceMeasurement {
  height: number;
  lineCount: number;
  slice: RichSlice;
}

export function measureTextSlice(
  block: TextBlock,
  startSentence: number,
  endSentence: number,
  viewport: ViewportMetrics,
  settings: ReaderSettings,
  continuationStart: boolean,
  continuationEnd: boolean
): TextSliceMeasurement {
  const typography = getBlockTypography(block.kind, settings);
  const entry = getPreparedSlice(block, startSentence, endSentence, settings);
  setSliceWidth(entry, viewport.contentWidth - typography.indent);
  entry.lineCount ??= measureRichInlineStats(entry.prepared, entry.width!).lineCount;
  const marginTop = continuationStart ? 0 : typography.marginTop;
  const marginBottom = continuationEnd ? 0 : typography.marginBottom;

  return {
    height: entry.lineCount * typography.lineHeightPx + marginTop + marginBottom,
    lineCount: entry.lineCount,
    slice: entry.slice
  };
}

export function renderTextSlice(
  block: TextBlock,
  startSentence: number,
  endSentence: number,
  viewport: ViewportMetrics,
  settings: ReaderSettings,
  continuationStart: boolean,
  continuationEnd: boolean
): PortionTextSlice {
  const typography = getBlockTypography(block.kind, settings);
  const entry = getPreparedSlice(block, startSentence, endSentence, settings);
  const lines = materializeLines(entry, viewport.contentWidth - typography.indent);

  return {
    type: 'text',
    key: `${block.id}:${startSentence}-${endSentence}`,
    blockId: block.id,
    blockOrder: block.order,
    kind: block.kind,
    lines,
    startSentence,
    endSentence,
    continuationStart,
    continuationEnd,
    label:
      block.kind === 'list-item'
        ? block.listOrdered
          ? `${block.listIndex}.`
          : '•'
        : undefined
  };
}

export function renderSentenceLineWindow(
  block: TextBlock,
  sentenceIndex: number,
  lineOffset: number,
  maxLines: number,
  viewport: ViewportMetrics,
  settings: ReaderSettings
): { totalLines: number; visibleLines: RenderLine[]; height: number } {
  const typography = getBlockTypography(block.kind, settings);
  const entry = getPreparedSlice(block, sentenceIndex, sentenceIndex + 1, settings);
  const allLines = materializeLines(entry, viewport.contentWidth - typography.indent);
  const visibleLines = allLines.slice(lineOffset, lineOffset + maxLines);

  return {
    totalLines: allLines.length,
    visibleLines,
    height:
      visibleLines.length * typography.lineHeightPx +
      (lineOffset === 0 ? typography.marginTop : 0) +
      (lineOffset + visibleLines.length >= allLines.length ? typography.marginBottom : 0)
  };
}
