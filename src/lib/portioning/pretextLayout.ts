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

interface RichItemMeta {
  text: string;
  font: string;
  marks: string[];
  href?: string;
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

function dedupeMarks(marks: string[]): string[] {
  return Array.from(new Set(marks));
}

function getSentenceInlineSlice(
  block: TextBlock,
  sentenceIndex: number
): BookInline[] {
  const sentence = block.sentences[sentenceIndex];
  const byId = new Map(block.inlineContent.map((inline) => [inline.id, inline]));
  return sentence.inlineIds
    .map((id) => byId.get(id))
    .filter((value): value is BookInline => Boolean(value));
}

function normalizeSentenceInlines(inlines: BookInline[]): BookInline[] {
  return inlines
    .map((inline, index) => {
      let text = inline.text;
      if (index === 0) {
        text = text.replace(/^\s+/, '');
      }
      if (index === inlines.length - 1) {
        text = text.replace(/\s+$/, '');
      }
      if (text.length === 0) {
        return null;
      }
      return {
        ...inline,
        text
      };
    })
    .filter((value): value is BookInline => Boolean(value));
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
      sentenceInlines[0] = {
        ...firstInline,
        text: /^\s/.test(firstInline.text) ? firstInline.text : ` ${firstInline.text}`
      };
    }

    sentenceInlines.forEach((inline) => {
      items.push({
        text: inline.text,
        font: getInlineFont(settings, inline.marks, block.kind)
      });
      meta.push({
        text: inline.text,
        font: getInlineFont(settings, inline.marks, block.kind),
        marks: dedupeMarks(inline.marks),
        href: inline.href
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

  lines.forEach((line, lineIndex) => {
    const fragments: RenderFragment[] = [];

    line.fragments.forEach((fragment, fragmentIndex) => {
      const meta = slice.meta[fragment.itemIndex];
      const item = slice.items[fragment.itemIndex];
      let text = fragment.text;

      if (
        fragmentStartsItemBoundary(fragment) &&
        itemHasCollapsedLeadingSpace(item)
      ) {
        const previousFragmentInLine = fragments[fragments.length - 1];
        if (previousFragmentInLine) {
          text = ` ${text}`;
        } else {
          const previousLine = renderedLines[lineIndex - 1];
          const previousLineFragment = previousLine?.fragments[previousLine.fragments.length - 1];
          if (previousLineFragment && !/\s$/.test(previousLineFragment.text)) {
            previousLineFragment.text = `${previousLineFragment.text} `;
          }
        }
      }

      fragments.push({
        key: `fragment-${lineIndex}-${fragmentIndex}`,
        text,
        font: meta?.font ?? item?.font ?? '',
        marks: meta?.marks ?? [],
        href: meta?.href
      });
    });

    renderedLines.push({
      key: `line-${lineIndex}`,
      fragments
    });
  });

  return renderedLines;
}

function materializeLines(
  slice: RichSlice,
  width: number
): RenderLine[] {
  const prepared = prepareRichInline(slice.items);
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

  return restoreCollapsedSpacesForRender(materializedLines, slice);
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
  const slice = buildRichSlice(block, startSentence, endSentence, settings);
  const prepared = prepareRichInline(slice.items);
  const stats = measureRichInlineStats(prepared, viewport.contentWidth - typography.indent);
  const marginTop = continuationStart ? 0 : typography.marginTop;
  const marginBottom = continuationEnd ? 0 : typography.marginBottom;

  return {
    height: stats.lineCount * typography.lineHeightPx + marginTop + marginBottom,
    lineCount: stats.lineCount,
    slice
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
  const slice = buildRichSlice(block, startSentence, endSentence, settings);
  const lines = materializeLines(slice, viewport.contentWidth - typography.indent);

  return {
    type: 'text',
    key: `${block.id}:${startSentence}-${endSentence}`,
    blockId: block.id,
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
  const slice = buildRichSlice(block, sentenceIndex, sentenceIndex + 1, settings);
  const allLines = materializeLines(slice, viewport.contentWidth - typography.indent);
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
