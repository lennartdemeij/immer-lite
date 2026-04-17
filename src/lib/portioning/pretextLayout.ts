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
  let firstSeen = false;

  const normalized = inlines
    .map((inline, index) => {
      let text = inline.text;
      if (!firstSeen) {
        text = text.replace(/^\s+/, '');
      }
      if (index === inlines.length - 1) {
        text = text.replace(/\s+$/, '');
      }
      if (text.length === 0) {
        return null;
      }
      firstSeen = true;
      return {
        ...inline,
        text
      };
    })
    .filter((value): value is BookInline => Boolean(value));

  return normalized;
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

    if (index < endSentence - 1 && items.length > 0) {
      const lastItem = items[items.length - 1];
      const lastMeta = meta[meta.length - 1];
      if (!/\s$/.test(lastItem.text)) {
        lastItem.text += ' ';
        lastMeta.text += ' ';
      }
    }
  }

  return { items, meta };
}

function materializeLines(
  slice: RichSlice,
  width: number
): RenderLine[] {
  const prepared = prepareRichInline(slice.items);
  const lines: RenderLine[] = [];
  let lineIndex = 0;

  walkRichInlineLineRanges(prepared, width, (range) => {
    const materialized = materializeRichInlineLineRange(prepared, range);
    const fragments: RenderFragment[] = materialized.fragments.map((fragment, index) => {
      const meta = slice.meta[fragment.itemIndex];
      return {
        key: `fragment-${lineIndex}-${index}`,
        text: fragment.text,
        font: meta?.font ?? slice.items[fragment.itemIndex]?.font ?? '',
        marks: meta?.marks ?? [],
        href: meta?.href
      };
    });

    lines.push({
      key: `line-${lineIndex}`,
      fragments
    });
    lineIndex += 1;
  });

  return lines;
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
