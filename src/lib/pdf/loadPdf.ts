import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type {
  BookBlock,
  BookComputedStyle,
  BookInline,
  BookMetadata,
  BookParseStats,
  BookSection,
  CanonicalBook,
  ParseDiagnostic,
  ParseTiming,
  SentenceUnit,
  TextBlock,
  TocEntry
} from '../../types/book';
import { segmentSentences } from '../segmentation/sentences';

type PdfJsModule = typeof import('pdfjs-dist');

type PromiseWithResolversConstructor = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;

function ensurePromiseWithResolvers(): void {
  const PromiseCtor = Promise as PromiseWithResolversConstructor;
  if (typeof PromiseCtor.withResolvers === 'function') {
    return;
  }

  PromiseCtor.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    return { promise, resolve, reject };
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  ensurePromiseWithResolvers();
  pdfJsModulePromise ??= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc =
      typeof window === 'undefined'
        ? new URL(
            '../../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
            import.meta.url
          ).toString()
        : pdfWorkerUrl;
    return module;
  });
  return pdfJsModulePromise;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface PdfTextLine {
  text: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  gapAfter: number;
  startsParagraph: boolean;
}

interface PdfOutlineEntry {
  title: string;
  pageNumber: number;
  depth: number;
}

interface PdfSectionSeed {
  id: string;
  index: number;
  label: string;
  href: string;
  startPage: number;
  endPage: number;
  matter: BookSection['matter'];
  tocDepth: number;
}

const PDF_TEXT_STYLE: BookComputedStyle = {
  marginTop: 0,
  marginBottom: 12,
  marginLeft: 0,
  marginRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
  fontFamily: '',
  fontStyle: 'normal',
  fontWeight: '400',
  fontVariant: 'normal',
  textDecorationLine: 'none',
  textAlign: 'start',
  display: 'block'
};

const PDF_HEADING_STYLE: BookComputedStyle = {
  ...PDF_TEXT_STYLE,
  marginTop: 0,
  marginBottom: 20,
  fontWeight: '600',
  textAlign: 'center'
};

function makeId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}-${parts.join('-')}`;
}

function createBookInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizePdfTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = sanitizeText(value.replace(/\u0000/g, ''));
  return normalized || undefined;
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  const candidate = item as Partial<PdfTextItem>;
  return (
    typeof candidate.str === 'string' &&
    Array.isArray(candidate.transform) &&
    candidate.transform.length >= 6
  );
}

function fontSizeFromTransform(item: PdfTextItem): number {
  const [, b, c, d] = item.transform;
  const transformedSize = Math.max(Math.hypot(c, d), Math.hypot(item.transform[0], b));
  return Number.isFinite(transformedSize) && transformedSize > 0
    ? transformedSize
    : item.height || 12;
}

function looksLikeDropCapText(text: string): boolean {
  return text.length <= 4 && /^[\p{L}'’,.]+$/u.test(text);
}

function shouldJoinDropCapToTarget(dropCapText: string, targetText: string): boolean {
  if (!/^[\p{L}]$/u.test(dropCapText)) {
    return false;
  }

  if (dropCapText === 'I') {
    return /^['’][a-z]/.test(targetText) || /^[a-z]\b/.test(targetText);
  }

  return /^[\p{L}]/u.test(targetText);
}

function median(values: number[], fallback: number): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) {
    return fallback;
  }

  return sorted[Math.floor(sorted.length / 2)];
}

function joinTextItems(items: PdfTextItem[]): string {
  let text = '';
  let previous: PdfTextItem | null = null;

  for (const item of items) {
    const value = item.str.replace(/\s+/g, ' ');
    if (!value.trim()) {
      continue;
    }

    if (!text) {
      text = value.trimStart();
      previous = item;
      continue;
    }

    const previousEnd = previous
      ? previous.transform[4] + Math.max(0, previous.width)
      : item.transform[4];
    const gap = item.transform[4] - previousEnd;
    const needsSpace =
      gap > Math.max(1.2, fontSizeFromTransform(item) * 0.16) &&
      !/\s$/.test(text) &&
      !/^[,.;:!?)}\]'”’]/.test(value);

    text += `${needsSpace ? ' ' : ''}${value.trimStart()}`;
    previous = item;
  }

  return sanitizeText(text);
}

function groupTextItemsIntoLines(
  pageNumber: number,
  items: PdfTextItem[]
): PdfTextLine[] {
  const nonBlankItems = items.filter((item) => item.str.trim());
  if (nonBlankItems.length === 0) {
    return [];
  }

  const bodyFontSize = median(
    nonBlankItems.map(fontSizeFromTransform).filter((size) => size < 40),
    12
  );
  const yTolerance = Math.max(2, bodyFontSize * 0.35);
  const dropCapItems = new Set(
    nonBlankItems.filter(
      (item) =>
        fontSizeFromTransform(item) >= bodyFontSize * 2.4 &&
        looksLikeDropCapText(sanitizeText(item.str))
    )
  );
  const rows: PdfTextItem[][] = [];

  for (const item of [...nonBlankItems].sort((left, right) => {
    const yDelta = right.transform[5] - left.transform[5];
    return Math.abs(yDelta) > yTolerance ? yDelta : left.transform[4] - right.transform[4];
  })) {
    if (dropCapItems.has(item)) {
      rows.push([item]);
      continue;
    }

    const row = rows.find((candidate) => {
      if (candidate.some((rowItem) => dropCapItems.has(rowItem))) {
        return false;
      }
      const rowY = median(candidate.map((rowItem) => rowItem.transform[5]), item.transform[5]);
      return Math.abs(rowY - item.transform[5]) <= yTolerance;
    });

    if (row) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  const lines: PdfTextLine[] = [];
  for (const row of rows) {
    const ordered = [...row].sort((left, right) => left.transform[4] - right.transform[4]);
    const text = joinTextItems(ordered);
    if (!text) {
      continue;
    }

    const x = Math.min(...ordered.map((item) => item.transform[4]));
    const right = Math.max(
      ...ordered.map((item) => item.transform[4] + Math.max(0, item.width))
    );
    lines.push({
      text,
      pageNumber,
      x,
      y: median(ordered.map((item) => item.transform[5]), ordered[0].transform[5]),
      width: Math.max(0, right - x),
      fontSize: median(ordered.map(fontSizeFromTransform), bodyFontSize),
      gapAfter: 0,
      startsParagraph: false
    });
  }

  lines.sort((left, right) => right.y - left.y);

  for (let index = 0; index < lines.length; index += 1) {
    const nextLine = lines[index + 1];
    lines[index].gapAfter = nextLine ? lines[index].y - nextLine.y : 0;
  }

  const leftEdge = median(
    lines
      .filter((line) => line.fontSize <= bodyFontSize * 1.3)
      .map((line) => line.x),
    lines[0]?.x ?? 0
  );
  const indentThreshold = Math.max(10, bodyFontSize * 0.9);
  for (const line of lines) {
    line.startsParagraph = line.x - leftEdge >= indentThreshold;
  }

  return mergeDropCaps(lines, bodyFontSize);
}

function mergeDropCaps(lines: PdfTextLine[], bodyFontSize: number): PdfTextLine[] {
  const dropCaps = lines.filter(
    (line) =>
      line.fontSize >= bodyFontSize * 2.4 &&
      looksLikeDropCapText(line.text)
  );
  const consumed = new Set<PdfTextLine>();

  for (const dropCap of dropCaps) {
    const rightEdge =
      dropCap.x + Math.max(bodyFontSize * 0.9, Math.min(dropCap.width, bodyFontSize * 2.2));
    const verticalTop = dropCap.y + dropCap.fontSize;
    const verticalBottom = dropCap.y - bodyFontSize * 0.7;
    const candidates = lines
      .filter(
        (line) =>
          line !== dropCap &&
          line.pageNumber === dropCap.pageNumber &&
          line.fontSize <= bodyFontSize * 1.7 &&
          line.x >= rightEdge - bodyFontSize * 0.4 &&
          line.y <= verticalTop &&
          line.y >= verticalBottom
      )
      .sort((left, right) => right.y - left.y || left.x - right.x);

    const target = candidates[0];
    if (!target) {
      continue;
    }

    const joinsAsWord = shouldJoinDropCapToTarget(dropCap.text, target.text);
    target.text = `${dropCap.text}${joinsAsWord ? '' : ' '}${target.text}`;
    target.x = Math.min(dropCap.x, target.x);
    target.width = Math.max(target.width, dropCap.x + dropCap.width - target.x);
    target.fontSize = Math.max(target.fontSize, bodyFontSize);
    target.startsParagraph = true;

    for (const candidate of candidates) {
      if (candidate === target) {
        continue;
      }
      candidate.startsParagraph = false;
    }
    consumed.add(dropCap);
  }

  return lines.filter((line) => !consumed.has(line));
}

function stripRepeatedPageNoise(linesByPage: PdfTextLine[][]): PdfTextLine[][] {
  const occurrences = new Map<string, Set<number>>();
  for (const lines of linesByPage) {
    for (const line of lines) {
      const normalized = line.text.toLowerCase();
      if (!normalized || normalized.length > 70 || /^\d+$/.test(normalized)) {
        continue;
      }
      const pages = occurrences.get(normalized) ?? new Set<number>();
      pages.add(line.pageNumber);
      occurrences.set(normalized, pages);
    }
  }

  const repeated = new Set(
    Array.from(occurrences.entries())
      .filter(([, pages]) => pages.size >= Math.max(4, linesByPage.length * 0.28))
      .map(([text]) => text)
  );

  return linesByPage.map((lines) =>
    lines.filter((line) => {
      if (/^\d+$/.test(line.text) && (line.y < 80 || line.y > 720)) {
        return false;
      }
      return !repeated.has(line.text.toLowerCase());
    })
  );
}

function createParseStats(
  diagnostics: ParseDiagnostic[],
  startTime: number,
  timings: ParseTiming[]
): BookParseStats {
  const confidence = Math.max(
    0,
    Math.min(
      1,
      diagnostics.reduce((score, diagnostic) => {
        if (diagnostic.severity === 'error') {
          return score - 0.28;
        }
        if (diagnostic.severity === 'warning') {
          return score - 0.08;
        }
        return score;
      }, 0.92)
    )
  );

  return {
    confidence,
    diagnostics,
    parsedAt: new Date().toISOString(),
    durationMs: performance.now() - startTime,
    timings
  };
}

async function makeFingerprint(file: File, fileBuffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', fileBuffer);
    const bytes = Array.from(new Uint8Array(digest));
    const hash = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hash}`;
  }

  return `file:${file.name}:${file.size}`;
}

async function readMetadata(pdf: PDFDocumentProxy, file: File): Promise<BookMetadata> {
  const metadata = await pdf.getMetadata().catch(() => null);
  const info = metadata?.info as Record<string, unknown> | undefined;
  const fileTitle = normalizePdfTitle(file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
  const title =
    normalizePdfTitle(info?.Title) ??
    fileTitle ??
    'Untitled PDF';

  return {
    title,
    creator: normalizePdfTitle(info?.Author),
    language: normalizePdfTitle(info?.Language)
  };
}

async function resolveOutlinePageNumber(
  pdf: PDFDocumentProxy,
  destination: unknown
): Promise<number | null> {
  const resolvedDestination =
    typeof destination === 'string'
      ? await pdf.getDestination(destination).catch(() => null)
      : destination;

  if (!Array.isArray(resolvedDestination) || !resolvedDestination[0]) {
    return null;
  }

  const pageRef = resolvedDestination[0];
  if (typeof pageRef === 'number') {
    return Math.max(1, Math.min(pdf.numPages, pageRef + 1));
  }

  try {
    return (await pdf.getPageIndex(pageRef)) + 1;
  } catch {
    return null;
  }
}

async function flattenOutline(
  pdf: PDFDocumentProxy,
  items: unknown[],
  depth = 0
): Promise<PdfOutlineEntry[]> {
  const entries: PdfOutlineEntry[] = [];

  for (const item of items) {
    const outlineItem = item as {
      title?: unknown;
      dest?: unknown;
      items?: unknown[];
    };
    const label = normalizePdfTitle(outlineItem.title);
    const pageNumber =
      outlineItem.dest != null
        ? await resolveOutlinePageNumber(pdf, outlineItem.dest)
        : null;

    if (label && pageNumber != null) {
      entries.push({
        title: label,
        pageNumber,
        depth
      });
    }

    if (Array.isArray(outlineItem.items) && outlineItem.items.length > 0) {
      entries.push(...(await flattenOutline(pdf, outlineItem.items, depth + 1)));
    }
  }

  return entries;
}

async function readOutlineEntries(pdf: PDFDocumentProxy): Promise<PdfOutlineEntry[]> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline) {
    return [];
  }

  const flattened = await flattenOutline(pdf, outline);
  const seen = new Set<string>();
  return flattened
    .filter((entry) => entry.pageNumber >= 1 && entry.pageNumber <= pdf.numPages)
    .sort((left, right) => left.pageNumber - right.pageNumber || left.depth - right.depth)
    .filter((entry) => {
      const key = `${entry.pageNumber}:${entry.depth}:${entry.title.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function lineLooksLikeHeading(line: PdfTextLine, bodyFontSize: number): boolean {
  const text = line.text.trim();
  if (text.length < 2 || text.length > 110) {
    return false;
  }

  if (/^(chapter|part|book|section)\b/i.test(text)) {
    return true;
  }

  const hasLowercase = /[a-z]/.test(text);
  const mostlyCaps =
    !hasLowercase && /[A-Z]/.test(text) && text.replace(/[^A-Z]/g, '').length >= 3;
  return line.fontSize >= bodyFontSize * 1.35 && (mostlyCaps || text.length < 60);
}

function deriveSectionSeedsFromLines(
  linesByPage: PdfTextLine[][],
  diagnostics: ParseDiagnostic[]
): PdfSectionSeed[] {
  const allLines = linesByPage.flat();
  const bodyFontSize = median(allLines.map((line) => line.fontSize), 12);
  const headingLines = allLines.filter((line) => lineLooksLikeHeading(line, bodyFontSize));
  const usableHeadings =
    headingLines.length >= 2 && headingLines.length <= 120 ? headingLines : [];

  if (usableHeadings.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'PDF did not expose a usable table of contents; generated page-based sections.'
    });

    return linesByPage.map((lines, index) => ({
      id: makeId('pdf-section', index),
      index,
      label: `Page ${index + 1}`,
      href: `page-${index + 1}`,
      startPage: index + 1,
      endPage: index + 1,
      matter: index === 0 ? 'front' : 'body',
      tocDepth: 0
    }));
  }

  diagnostics.push({
    severity: 'info',
    message: 'PDF did not expose a table of contents; generated sections from heading-like lines.'
  });

  return usableHeadings.map((line, index) => {
    const nextLine = usableHeadings[index + 1];
    return {
      id: makeId('pdf-section', index),
      index,
      label: line.text,
      href: `page-${line.pageNumber}`,
      startPage: line.pageNumber,
      endPage: nextLine ? Math.max(line.pageNumber, nextLine.pageNumber - 1) : linesByPage.length,
      matter: index === 0 ? 'front' : 'body',
      tocDepth: 0
    };
  });
}

function deriveSectionSeedsFromOutline(
  outlineEntries: PdfOutlineEntry[],
  pageCount: number,
  diagnostics: ParseDiagnostic[]
): PdfSectionSeed[] {
  const shallowEntries = outlineEntries.filter((entry) => entry.depth <= 1);
  const sourceEntries = shallowEntries.length >= 2 ? shallowEntries : outlineEntries;
  const deduped: PdfOutlineEntry[] = [];
  const seenPagesAndLabels = new Set<string>();

  for (const entry of sourceEntries) {
    const key = `${entry.pageNumber}:${entry.title.toLowerCase()}`;
    if (seenPagesAndLabels.has(key)) {
      continue;
    }
    seenPagesAndLabels.add(key);
    deduped.push(entry);
  }

  if (deduped.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'PDF table of contents was empty after resolving destinations.'
    });
    return [];
  }

  return deduped.map((entry, index) => {
    const nextEntry = deduped[index + 1];
    return {
      id: makeId('pdf-section', index),
      index,
      label: entry.title,
      href: `page-${entry.pageNumber}`,
      startPage: entry.pageNumber,
      endPage: nextEntry ? Math.max(entry.pageNumber, nextEntry.pageNumber - 1) : pageCount,
      matter: /^(praise|title|copyright|dedication|contents|table of contents)$/i.test(entry.title)
        ? 'front'
        : 'body',
      tocDepth: entry.depth
    };
  });
}

function buildTocFromSections(sections: BookSection[]): TocEntry[] {
  return sections.map((section) => ({
    id: makeId('pdf-toc', section.index),
    label: section.label,
    href: section.href,
    depth: section.tocDepth ?? 0,
    children: []
  }));
}

function normalizeParagraphText(lines: PdfTextLine[]): string {
  let text = '';

  for (const line of lines) {
    if (!text) {
      text = line.text;
      continue;
    }

    if (/-$/.test(text) && /^[a-z]/.test(line.text)) {
      text = `${text.slice(0, -1)}${line.text}`;
      continue;
    }

    text = `${text} ${line.text}`;
  }

  return sanitizeText(text);
}

function shouldStartNewParagraph(previous: PdfTextLine, current: PdfTextLine): boolean {
  if (current.startsParagraph) {
    return true;
  }

  if (current.pageNumber !== previous.pageNumber) {
    return current.startsParagraph;
  }

  const expectedLineGap = Math.max(previous.fontSize, current.fontSize) * 1.35;
  if (previous.gapAfter > expectedLineGap) {
    return true;
  }

  return false;
}

function createTextBlockFromText(
  sectionId: string,
  order: number,
  text: string,
  kind: TextBlock['kind'],
  locale: string | undefined,
  options: Partial<Pick<TextBlock, 'level'>> = {}
): TextBlock | null {
  const normalizedText = sanitizeText(text);
  if (!normalizedText) {
    return null;
  }

  const blockId = makeId(sectionId, kind, order);
  const inline: BookInline = {
    id: makeId(blockId, 'inline', 0),
    text: normalizedText,
    marks: [],
    startOffset: 0,
    endOffset: normalizedText.length
  };
  const boundaries = segmentSentences(normalizedText, locale);
  const sentences: SentenceUnit[] = boundaries.map((boundary, index) => ({
    id: makeId(blockId, 'sentence', index),
    index,
    text: boundary.text,
    inlineIds: [inline.id],
    startOffset: boundary.start,
    endOffset: boundary.end
  }));

  return {
    id: blockId,
    order,
    kind,
    sectionId,
    text: normalizedText,
    inlineContent: [inline],
    sentences,
    computedStyle: kind === 'heading' ? PDF_HEADING_STYLE : PDF_TEXT_STYLE,
    ...options
  };
}

function isSceneBreakLine(line: PdfTextLine): boolean {
  return /^[-–—*•·. ]{1,12}$/.test(line.text) && line.text.replace(/\s/g, '').length <= 4;
}

function buildSectionBlocks(
  seed: PdfSectionSeed,
  lines: PdfTextLine[],
  orderStart: number,
  locale: string | undefined
): BookBlock[] {
  const blocks: BookBlock[] = [];
  let order = orderStart;
  const heading = createTextBlockFromText(seed.id, order, seed.label, 'heading', locale, {
    level: Math.max(1, Math.min(6, seed.tocDepth + 1))
  });
  if (heading) {
    blocks.push(heading);
    order += 1;
  }

  let paragraphLines: PdfTextLine[] = [];
  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    const block = createTextBlockFromText(
      seed.id,
      order,
      normalizeParagraphText(paragraphLines),
      'paragraph',
      locale
    );
    if (block) {
      blocks.push(block);
      order += 1;
    }
    paragraphLines = [];
  };

  for (const line of lines) {
    if (line.text.toLowerCase() === seed.label.toLowerCase()) {
      continue;
    }

    if (isSceneBreakLine(line)) {
      flushParagraph();
      blocks.push({
        id: makeId(seed.id, 'scene-break', order),
        order,
        kind: 'scene-break',
        sectionId: seed.id,
        computedStyle: PDF_TEXT_STYLE
      });
      order += 1;
      continue;
    }

    const previous = paragraphLines[paragraphLines.length - 1];
    if (previous && shouldStartNewParagraph(previous, line)) {
      flushParagraph();
    }
    paragraphLines.push(line);
  }

  flushParagraph();
  return blocks;
}

async function extractLinesByPage(
  pdf: PDFDocumentProxy,
  measureAsync: <T>(stage: string, work: () => Promise<T>) => Promise<T>
): Promise<PdfTextLine[][]> {
  const linesByPage: PdfTextLine[][] = [];

  await measureAsync('extract-pages', async () => {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false
      });
      const items = (content.items as unknown[]).filter(isPdfTextItem);
      linesByPage.push(groupTextItemsIntoLines(pageNumber, items));
      page.cleanup();
    }
  });

  return stripRepeatedPageNoise(linesByPage);
}

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

export async function loadPdfBook(file: File): Promise<CanonicalBook> {
  if (!isPdfFile(file)) {
    throw new Error('Please upload a valid .pdf file.');
  }

  const parseStartTime = performance.now();
  const diagnostics: ParseDiagnostic[] = [];
  const timings: ParseTiming[] = [];
  const measureAsync = async <T>(
    stage: string,
    work: () => Promise<T>
  ): Promise<T> => {
    const stageStart = performance.now();
    try {
      return await work();
    } finally {
      timings.push({ stage, durationMs: performance.now() - stageStart });
    }
  };
  const measureSync = <T>(stage: string, work: () => T): T => {
    const stageStart = performance.now();
    try {
      return work();
    } finally {
      timings.push({ stage, durationMs: performance.now() - stageStart });
    }
  };

  const fileBuffer = await measureAsync('read-file', () => file.arrayBuffer());
  const fingerprint = await measureAsync('fingerprint', () =>
    makeFingerprint(file, fileBuffer)
  );
  const { getDocument } = await measureAsync('load-pdf-runtime', () => loadPdfJs());
  const pdf = await measureAsync('open-pdf', () =>
    getDocument({
      data: new Uint8Array(fileBuffer),
      isEvalSupported: false
    }).promise
  );

  try {
    const metadata = await measureAsync('read-metadata', () => readMetadata(pdf, file));
    const outlineEntries = await measureAsync('read-outline', () =>
      readOutlineEntries(pdf)
    );
    const linesByPage = await extractLinesByPage(pdf, measureAsync);
    const selectableLineCount = linesByPage.reduce((sum, lines) => sum + lines.length, 0);
    if (selectableLineCount === 0) {
      throw new Error(
        'No selectable text was found in this PDF. Scanned image-only PDFs are not supported yet.'
      );
    }

    const seeds = measureSync('build-section-seeds', () => {
      const outlineSeeds = outlineEntries.length
        ? deriveSectionSeedsFromOutline(outlineEntries, pdf.numPages, diagnostics)
        : [];
      return outlineSeeds.length > 0
        ? outlineSeeds
        : deriveSectionSeedsFromLines(linesByPage, diagnostics);
    });

    const sections: BookSection[] = [];
    let globalOrder = 0;
    let totalSentences = 0;

    measureSync('build-sections', () => {
      for (const seed of seeds) {
        const sectionLines = linesByPage
          .slice(seed.startPage - 1, seed.endPage)
          .flat();
        if (sectionLines.length === 0) {
          diagnostics.push({
            severity: 'info',
            message: `Skipped empty PDF section ${seed.label}.`,
            sectionId: seed.id
          });
          continue;
        }

        const blocks = buildSectionBlocks(
          seed,
          sectionLines,
          globalOrder,
          metadata.language
        );

        if (blocks.length === 0) {
          diagnostics.push({
            severity: 'info',
            message: `Skipped empty PDF section ${seed.label}.`,
            sectionId: seed.id
          });
          continue;
        }

        totalSentences += blocks.reduce(
          (sum, block) => sum + ('sentences' in block ? block.sentences.length : 0),
          0
        );
        globalOrder += blocks.length;
        sections.push({
          id: seed.id,
          index: seed.index,
          label: seed.label,
          href: seed.href,
          blocks,
          matter: seed.matter,
          navLabel: seed.label,
          tocDepth: seed.tocDepth,
          anchorIds: [],
          localLinks: []
        });
      }
    });

    if (sections.length === 0) {
      throw new Error('No readable text was found in this PDF.');
    }

    if (outlineEntries.length === 0) {
      diagnostics.push({
        severity: 'warning',
        message: 'PDF had no outline, so chapter detection is heuristic.'
      });
    }

    return {
      id: createBookInstanceId(),
      fingerprint,
      metadata,
      sections,
      toc: buildTocFromSections(sections),
      resources: {},
      totalBlocks: globalOrder,
      totalSentences,
      parseStats: createParseStats(diagnostics, parseStartTime, timings)
    };
  } finally {
    pdf.cleanup();
    await pdf.destroy();
  }
}
