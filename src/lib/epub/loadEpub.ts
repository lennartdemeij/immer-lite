import JSZip from 'jszip';
import type {
  BookBlock,
  BookComputedStyle,
  BookInline,
  BookMetadata,
  BookParseStats,
  ParseTiming,
  ParseDiagnostic,
  BookResource,
  BookSection,
  CanonicalBook,
  ImageBlock,
  SceneBreakBlock,
  SentenceUnit,
  TocEntry,
  TextBlock
} from '../../types/book';
import { segmentSentences } from '../segmentation/sentences';
import { dirname, joinPath, stripFragment } from './path';
import {
  annotateDocumentsWithComputedStyles,
  readComputedStyleSnapshot
} from './computeStyles';
import {
  classifySections,
  deriveTocFromSections,
  hasUsableToc,
  inferTextBlockKind
} from './heuristics';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

interface SpineItemRef {
  idref: string;
  linear: boolean;
}

function parseXml(xml: string, mimeType: DOMParserSupportedType): Document {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, mimeType);
  if (document.querySelector('parsererror')) {
    throw new Error('Failed to parse EPUB XML.');
  }
  return document;
}

function textContent(node: Element | null | undefined): string | undefined {
  const value = node?.textContent?.replace(/\s+/g, ' ').trim();
  return value || undefined;
}

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

function isSceneBreakText(text: string): boolean {
  const normalized = sanitizeText(text);
  if (!normalized || normalized.length > 24) {
    return false;
  }

  if (/^(?:\*+\s*){3,}|(?:·\s*){3,}|(?:•\s*){3,}$/.test(normalized)) {
    return true;
  }

  if (/\.\s*\.\s*\.(?:\s*\.)*$/.test(normalized)) {
    return true;
  }

  const ornamentOnly = normalized.replace(/[\s._*~\-–—=+|/\\·•⋅●○◦◆◇▪▫❖❦⁂※]+/g, '');
  if (ornamentOnly.length > 0) {
    return false;
  }

  const ornamentCount = normalized.replace(/[\s]/g, '').length;
  return ornamentCount >= 1 && ornamentCount <= 12;
}

function normalizeLinkHref(sectionHref: string, href: string): string {
  if (!href) {
    return href;
  }

  if (/^[a-z]+:/i.test(href)) {
    return href;
  }

  if (href.startsWith('#')) {
    return `${stripFragment(sectionHref)}${href}`;
  }

  const fragment = href.includes('#') ? href.slice(href.indexOf('#')) : '';
  return `${joinPath(dirname(sectionHref), stripFragment(href))}${fragment}`;
}

function addStyleMarks(
  inheritedMarks: BookInline['marks'],
  style?: BookComputedStyle
): BookInline['marks'] {
  if (!style) {
    return inheritedMarks;
  }

  const marks = new Set(inheritedMarks);
  const numericWeight = Number.parseInt(style.fontWeight, 10);
  if (style.fontWeight === 'bold' || (Number.isFinite(numericWeight) && numericWeight >= 600)) {
    marks.add('bold');
  }
  if (style.fontStyle === 'italic' || style.fontStyle === 'oblique') {
    marks.add('italic');
  }
  const decoration = style.textDecorationLine.toLowerCase();
  if (decoration.includes('underline')) {
    marks.add('underline');
  }
  if (decoration.includes('line-through')) {
    marks.add('strikethrough');
  }
  if (style.fontVariant.toLowerCase().includes('small-caps')) {
    marks.add('smallcaps');
  }

  return Array.from(marks);
}

function splitInlineRange(
  inline: BookInline,
  start: number,
  end: number,
  nextId: string
): BookInline | null {
  const slice = inline.text.slice(start, end);
  if (!slice) {
    return null;
  }
  return {
    ...inline,
    id: nextId,
    text: slice,
    startOffset: (inline.startOffset ?? 0) + start,
    endOffset: (inline.startOffset ?? 0) + end
  };
}

function sentenceUnitsFromInlineContent(
  blockId: string,
  inlineContent: BookInline[],
  locale?: string
): { text: string; sentences: SentenceUnit[]; inlineContent: BookInline[] } {
  const collapsedText = inlineContent.map((inline) => inline.text).join('');
  const normalizedText = sanitizeText(collapsedText);
  if (!normalizedText) {
    return { text: '', sentences: [], inlineContent: [] };
  }

  const boundaries = segmentSentences(normalizedText, locale);
  if (boundaries.length === 0) {
    return { text: normalizedText, sentences: [], inlineContent };
  }

  const sourceInlineContent: BookInline[] = [];
  const offsetMap: Array<{ inline: BookInline; start: number; end: number }> = [];
  let cursor = 0;
  for (const inline of inlineContent) {
    const text = inline.text.replace(/\s+/g, ' ');
    if (text.length === 0) {
      continue;
    }

    sourceInlineContent.push({
      ...inline,
      text,
      startOffset: cursor,
      endOffset: cursor + text.length
    });
    const currentInline = sourceInlineContent[sourceInlineContent.length - 1];
    offsetMap.push({
      inline: currentInline,
      start: cursor,
      end: cursor + text.length
    });
    cursor += text.length;
  }

  const rebuiltInlineContent: BookInline[] = [];
  const sentences = boundaries.map((boundary, sentenceIndex) => {
    const inlineIds: string[] = [];

    for (const item of offsetMap) {
      const start = Math.max(boundary.start, item.start);
      const end = Math.min(boundary.end, item.end);
      if (end <= start) {
        continue;
      }

      const inlineSlice = splitInlineRange(
        item.inline,
        start - item.start,
        end - item.start,
        makeId(blockId, 'inline', sentenceIndex, inlineIds.length)
      );

      if (!inlineSlice) {
        continue;
      }

      rebuiltInlineContent.push(inlineSlice);
      inlineIds.push(inlineSlice.id);
    }

    return {
      id: makeId(blockId, 'sentence', sentenceIndex),
      index: sentenceIndex,
      text: boundary.text,
      inlineIds,
      startOffset: boundary.start,
      endOffset: boundary.end
    };
  });

  return {
    text: normalizedText,
    sentences,
    inlineContent: rebuiltInlineContent
  };
}

function extractInlineContent(
  node: Node,
  inheritedMarks: BookInline['marks'] = [],
  sectionHref = '',
  linkHref?: string,
  acc: BookInline[] = [],
  idPrefix = 'inline'
): BookInline[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, ' ') ?? '';
    if (text.length > 0) {
      acc.push({
        id: `${idPrefix}-${acc.length}`,
        text,
        marks: inheritedMarks,
        href: linkHref
      });
    }
    return acc;
  }

  if (!(node instanceof Element)) {
    return acc;
  }

  if (node.tagName.toLowerCase() === 'br') {
    acc.push({
      id: `${idPrefix}-${acc.length}`,
      text: ' ',
      marks: inheritedMarks,
      href: linkHref
    });
    return acc;
  }

  const tag = node.tagName.toLowerCase();
  const nextMarks = addStyleMarks([...inheritedMarks], readComputedStyleSnapshot(node));
  if (tag === 'em' || tag === 'i') {
    nextMarks.push('italic');
  }
  if (tag === 'strong' || tag === 'b') {
    nextMarks.push('bold');
  }
  if (tag === 'code') {
    nextMarks.push('code');
  }

  const nextHref =
    tag === 'a'
      ? normalizeLinkHref(sectionHref, node.getAttribute('href') ?? linkHref ?? '')
      : linkHref;
  if (tag === 'a') {
    nextMarks.push('link');
  }

  node.childNodes.forEach((child) =>
    extractInlineContent(child, nextMarks, sectionHref, nextHref, acc, idPrefix)
  );
  return acc;
}

function createTextBlock(
  element: Element,
  kind: TextBlock['kind'],
  sectionId: string,
  sectionHref: string,
  order: number,
  locale: string | undefined,
  options: Partial<Pick<TextBlock, 'level' | 'listIndex' | 'listOrdered'>>
): TextBlock | null {
  const blockId = makeId(sectionId, kind, order);
  const inlineSeed = extractInlineContent(element, [], sectionHref, undefined, [], blockId);
  const segmented = sentenceUnitsFromInlineContent(blockId, inlineSeed, locale);
  if (!segmented.text || segmented.inlineContent.length === 0) {
    return null;
  }

  return {
    id: blockId,
    order,
    kind,
    sectionId,
    text: segmented.text,
    inlineContent: segmented.inlineContent,
    sentences: segmented.sentences,
    computedStyle: readComputedStyleSnapshot(element),
    ...options
  };
}

function isSceneBreak(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'hr') {
    return true;
  }
  return isSceneBreakText(element.textContent ?? '');
}

function makeSceneBreakBlock(
  sectionId: string,
  order: number,
  computedStyle?: BookComputedStyle
): SceneBreakBlock {
  return {
    id: makeId(sectionId, 'scene-break', order),
    order,
    kind: 'scene-break',
    sectionId,
    computedStyle
  };
}

function normalizeImageSrc(sectionDir: string, src: string): string {
  return joinPath(sectionDir, stripFragment(src));
}

function getElementImage(
  element: Element,
  selector = ':scope > img'
): HTMLImageElement | null {
  const image = element.querySelector(selector);
  return image instanceof HTMLImageElement ? image : null;
}

function createImageBlock(
  sectionId: string,
  order: number,
  wrapperElement: Element,
  image: HTMLImageElement,
  sectionDir: string,
  resourceUrls: Record<string, BookResource>
): ImageBlock | null {
  const src = image.getAttribute('src');
  if (!src) {
    return null;
  }

  const resolved = normalizeImageSrc(sectionDir, src);
  const resource = resourceUrls[resolved];
  if (!resource?.objectUrl) {
    return null;
  }

  const figureCaption =
    wrapperElement.querySelector(':scope > figcaption')?.textContent?.trim() ?? '';

  return {
    id: makeId(sectionId, 'image', order),
    order,
    kind: 'image',
    sectionId,
    src: resource.objectUrl,
    alt: image.getAttribute('alt') ?? '',
    caption:
      figureCaption ||
      image.getAttribute('title') ||
      wrapperElement.getAttribute('title') ||
      undefined,
    computedStyle: readComputedStyleSnapshot(wrapperElement)
  };
}

function hasOnlyDirectListItems(element: Element): boolean {
  return (
    element.children.length > 0 &&
    Array.from(element.children).every((child) => child.tagName.toLowerCase() === 'li')
  );
}

function normalizeParsedBlocks(blocks: BookBlock[]): BookBlock[] {
  const normalized: BookBlock[] = [];

  blocks.forEach((block) => {
    if (block.kind === 'scene-break') {
      if (
        normalized.length === 0 ||
        normalized[normalized.length - 1].kind === 'scene-break'
      ) {
        return;
      }
    }

    normalized.push(block);
  });

  while (normalized[normalized.length - 1]?.kind === 'scene-break') {
    normalized.pop();
  }

  return normalized;
}

function parseSectionBlocks(
  doc: Document,
  sectionId: string,
  sectionHref: string,
  orderStart: number,
  sectionDir: string,
  resourceUrls: Record<string, BookResource>,
  locale?: string
): BookBlock[] {
  const body = doc.querySelector('body');
  if (!body) {
    return [];
  }

  const blocks: BookBlock[] = [];
  let order = orderStart;

  const pushSceneBreak = (computedStyle?: BookComputedStyle) => {
    if (blocks.length === 0 || blocks[blocks.length - 1].kind === 'scene-break') {
      return;
    }

    blocks.push(makeSceneBreakBlock(sectionId, order, computedStyle));
    order += 1;
  };

  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    const computedStyle = readComputedStyleSnapshot(element);
    const hasNestedBlockChildren = Array.from(element.children).some((child) => {
      const childTag = child.tagName.toLowerCase();
      return (
        childTag === 'p' ||
        childTag === 'blockquote' ||
        childTag === 'ul' ||
        childTag === 'ol' ||
        childTag === 'figure' ||
        childTag === 'img' ||
        /^h[1-6]$/.test(childTag)
      );
    });

    if (computedStyle?.cssDefinedPageBreak === 'before') {
      pushSceneBreak(computedStyle);
    }

    if (isSceneBreak(element)) {
      pushSceneBreak(computedStyle);
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const block = createTextBlock(
        element,
        'heading',
        sectionId,
        sectionHref,
        order,
        locale,
        { level: Number(tag.slice(1)) }
      );
      if (block) {
        blocks.push(block);
        order += 1;
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
      }
      return;
    }

    if (tag === 'blockquote') {
      const block = createTextBlock(
        element,
        'quote',
        sectionId,
        sectionHref,
        order,
        locale,
        {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
      }
      return;
    }

    if (tag === 'figure') {
      const image = getElementImage(element);
      if (image) {
        const block = createImageBlock(
          sectionId,
          order,
          element,
          image,
          sectionDir,
          resourceUrls
        );
        if (block) {
          blocks.push(block);
          order += 1;
          if (computedStyle?.cssDefinedPageBreak === 'after') {
            pushSceneBreak(computedStyle);
          }
          return;
        }
      }
    }

    if (tag === 'p') {
      const image = getElementImage(element);
      if (image && sanitizeText(element.textContent ?? '') === '') {
        const block = createImageBlock(
          sectionId,
          order,
          element,
          image,
          sectionDir,
          resourceUrls
        );
        if (block) {
          blocks.push(block);
          order += 1;
          if (computedStyle?.cssDefinedPageBreak === 'after') {
            pushSceneBreak(computedStyle);
          }
          return;
        }
      }

      const kind = inferTextBlockKind(
        tag,
        sanitizeText(element.textContent ?? ''),
        computedStyle
      );
      const block = createTextBlock(
        element,
        kind,
        sectionId,
        sectionHref,
        order,
        locale,
        kind === 'heading'
          ? { level: 2 }
          : {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
        return;
      }
    }

    if (tag === 'div' || tag === 'section' || tag === 'article') {
      const directImage = getElementImage(element);
      if (directImage && sanitizeText(element.textContent ?? '') === '') {
        const block = createImageBlock(
          sectionId,
          order,
          element,
          directImage,
          sectionDir,
          resourceUrls
        );
        if (block) {
          blocks.push(block);
          order += 1;
          if (computedStyle?.cssDefinedPageBreak === 'after') {
            pushSceneBreak(computedStyle);
          }
          return;
        }
      }

      if (hasOnlyDirectListItems(element)) {
        Array.from(element.children).forEach((item, index) => {
          const block = createTextBlock(
            item,
            'list-item',
            sectionId,
            sectionHref,
            order,
            locale,
            {
              listIndex: index + 1,
              listOrdered: false
            }
          );
          if (block) {
            blocks.push(block);
            order += 1;
          }
        });
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
        return;
      }

      if (hasNestedBlockChildren) {
        Array.from(element.children).forEach(visit);
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
        return;
      }

      const kind = inferTextBlockKind(
        tag,
        sanitizeText(element.textContent ?? ''),
        computedStyle
      );
      const block = createTextBlock(
        element,
        kind,
        sectionId,
        sectionHref,
        order,
        locale,
        kind === 'heading' ? { level: 2 } : {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
        if (computedStyle?.cssDefinedPageBreak === 'after') {
          pushSceneBreak(computedStyle);
        }
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      const items = element.querySelectorAll(':scope > li');
      items.forEach((item, index) => {
        const block = createTextBlock(
          item,
          'list-item',
          sectionId,
          sectionHref,
          order,
          locale,
          {
            listIndex: index + 1,
            listOrdered: tag === 'ol'
          }
        );
        if (block) {
          blocks.push(block);
          order += 1;
        }
      });
      if (computedStyle?.cssDefinedPageBreak === 'after') {
        pushSceneBreak(computedStyle);
      }
      return;
    }

    if (tag === 'img') {
      if (element instanceof HTMLImageElement) {
        const block = createImageBlock(
          sectionId,
          order,
          element,
          element,
          sectionDir,
          resourceUrls
        );
        if (block) {
          blocks.push(block);
          order += 1;
          if (computedStyle?.cssDefinedPageBreak === 'after') {
            pushSceneBreak(computedStyle);
          }
        }
      }
      return;
    }

    Array.from(element.children).forEach(visit);
    if (computedStyle?.cssDefinedPageBreak === 'after') {
      pushSceneBreak(computedStyle);
    }
  };

  Array.from(body.children).forEach(visit);
  return normalizeParsedBlocks(blocks);
}

function readManifest(doc: Document, opfDir: string): Record<string, ManifestItem> {
  const manifest: Record<string, ManifestItem> = {};
  doc.querySelectorAll('manifest > item').forEach((element) => {
    const id = element.getAttribute('id');
    const href = element.getAttribute('href');
    const mediaType = element.getAttribute('media-type');
    if (!id || !href || !mediaType) {
      return;
    }

    manifest[id] = {
      id,
      href: joinPath(opfDir, href),
      mediaType,
      properties: (element.getAttribute('properties') ?? '')
        .split(/\s+/)
        .filter(Boolean)
    };
  });
  return manifest;
}

function readSpine(doc: Document): SpineItemRef[] {
  return Array.from(doc.querySelectorAll('spine > itemref')).map((item) => ({
    idref: item.getAttribute('idref') ?? '',
    linear: item.getAttribute('linear') !== 'no'
  }));
}

function readMetadata(doc: Document): BookMetadata {
  return {
    title: textContent(doc.querySelector('metadata > title, metadata > dc\\:title')) ?? 'Untitled EPUB',
    creator: textContent(
      doc.querySelector('metadata > creator, metadata > dc\\:creator')
    ),
    language: textContent(
      doc.querySelector('metadata > language, metadata > dc\\:language')
    ),
    publisher: textContent(
      doc.querySelector('metadata > publisher, metadata > dc\\:publisher')
    ),
    description: textContent(
      doc.querySelector('metadata > description, metadata > dc\\:description')
    )
  };
}

function normalizeHref(href: string): string {
  return href.replace(/^\/+/, '');
}

function shouldCreateObjectUrl(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

function sanitizeStylesheetForMeasurement(cssText: string): string {
  return cssText
    .replace(/@import[^;]+;/g, '')
    .replace(/@font-face\s*{[^}]*}/gms, '')
    .replace(/url\(([^)]+)\)/g, 'url("")');
}

async function loadStylesheetTexts(
  zip: JSZip,
  manifest: Record<string, ManifestItem>
): Promise<Record<string, string>> {
  const stylesheets: Record<string, string> = {};

  await Promise.all(
    Object.values(manifest)
      .filter((item) => item.mediaType === 'text/css')
      .map(async (item) => {
        const entry = zip.file(item.href);
        if (!entry) {
          return;
        }

        const cssText = await entry.async('text');
        stylesheets[item.href] = sanitizeStylesheetForMeasurement(cssText);
      })
  );

  return stylesheets;
}

function getInlineStyleTexts(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('style'))
    .map((element) => element.textContent ?? '')
    .filter(Boolean);
}

function getLinkedStyleTexts(
  doc: Document,
  sectionHref: string,
  stylesheetTexts: Record<string, string>
): string[] {
  const linked = Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))
    .map((element) => element.getAttribute('href'))
    .filter((href): href is string => Boolean(href))
    .map((href) => joinPath(dirname(sectionHref), href))
    .map((href) => stylesheetTexts[href])
    .filter(Boolean);

  if (linked.length > 0) {
    return linked;
  }

  return Object.values(stylesheetTexts);
}

function textContentOrFallback(element: Element, fallback: string): string {
  return textContent(element) ?? fallback;
}

function parseNavList(
  list: Element,
  baseHref: string,
  depth: number,
  idPrefix: string
): TocEntry[] {
  return Array.from(list.children)
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((item, index) => {
      const link =
        item.querySelector(':scope > a, :scope > span') ??
        item.querySelector('a, span');
      if (!link) {
        return null;
      }

      const hrefValue =
        link.tagName.toLowerCase() === 'a'
          ? normalizeLinkHref(baseHref, link.getAttribute('href') ?? '')
          : stripFragment(baseHref);
      const nestedList = item.querySelector(':scope > ol, :scope > ul');

      return {
        id: `${idPrefix}-${index}`,
        label: textContentOrFallback(link, `Section ${index + 1}`),
        href: hrefValue,
        depth,
        children: nestedList ? parseNavList(nestedList, baseHref, depth + 1, `${idPrefix}-${index}`) : []
      };
    })
    .filter((entry): entry is TocEntry => Boolean(entry));
}

function parseNavDocument(doc: Document, navHref: string): TocEntry[] {
  const nav =
    doc.querySelector('nav[epub\\:type="toc"]') ??
    doc.querySelector('nav[*|type="toc"]') ??
    doc.querySelector('nav[role="doc-toc"]') ??
    doc.querySelector('nav');
  const list = nav?.querySelector('ol, ul');
  if (!nav || !list) {
    return [];
  }

  return parseNavList(list, navHref, 0, 'toc');
}

function parseNcxPoints(
  nodes: Element[],
  baseHref: string,
  depth: number,
  idPrefix: string
): TocEntry[] {
  return nodes.map((node, index) => {
    const src = node.querySelector(':scope > content')?.getAttribute('src') ?? '';
    const label = textContent(node.querySelector(':scope > navLabel > text')) ?? `Section ${index + 1}`;
    const children = parseNcxPoints(
      Array.from(node.querySelectorAll(':scope > navPoint')),
      baseHref,
      depth + 1,
      `${idPrefix}-${index}`
    );

    return {
      id: `${idPrefix}-${index}`,
      label,
      href: normalizeLinkHref(baseHref, src),
      depth,
      children
    };
  });
}

function parseNcxDocument(doc: Document, ncxHref: string): TocEntry[] {
  const navMap = doc.querySelector('navMap');
  if (!navMap) {
    return [];
  }

  return parseNcxPoints(
    Array.from(navMap.querySelectorAll(':scope > navPoint')),
    ncxHref,
    0,
    'ncx'
  );
}

async function loadTocEntries(
  zip: JSZip,
  manifest: Record<string, ManifestItem>,
  opfDoc: Document
): Promise<TocEntry[]> {
  const navItem = Object.values(manifest).find((item) => item.properties.includes('nav'));
  if (navItem) {
    const entry = zip.file(navItem.href);
    if (entry) {
      const rawNav = await entry.async('text');
      const navDoc = parseXml(rawNav, navItem.mediaType.includes('xhtml') ? 'application/xhtml+xml' : 'text/html');
      const navEntries = parseNavDocument(navDoc, navItem.href);
      if (navEntries.length > 0) {
        return navEntries;
      }
    }
  }

  const spineTocId = opfDoc.querySelector('spine')?.getAttribute('toc');
  const ncxItem =
    (spineTocId ? manifest[spineTocId] : undefined) ??
    Object.values(manifest).find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (!ncxItem) {
    return [];
  }

  const entry = zip.file(ncxItem.href);
  if (!entry) {
    return [];
  }

  const rawNcx = await entry.async('text');
  return parseNcxDocument(parseXml(rawNcx, 'application/xml'), ncxItem.href);
}

function collectAnchorIds(doc: Document): string[] {
  return Array.from(doc.querySelectorAll('[id]'))
    .map((element) => element.getAttribute('id'))
    .filter((value): value is string => Boolean(value));
}

function collectLocalLinks(blocks: BookBlock[]): string[] {
  return blocks.flatMap((block) =>
    'inlineContent' in block
      ? block.inlineContent
          .map((inline) => inline.href)
          .filter(
            (href): href is string =>
              typeof href === 'string' && !/^[a-z]+:/i.test(href)
          )
      : []
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
      }, 1)
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

async function loadResourceUrls(
  zip: JSZip,
  manifest: Record<string, ManifestItem>
): Promise<Record<string, BookResource>> {
  const resources: Record<string, BookResource> = {};

  await Promise.all(
    Object.values(manifest).map(async (item) => {
      const file = zip.file(item.href);
      if (!file) {
        return;
      }

      if (!shouldCreateObjectUrl(item.mediaType)) {
        resources[item.href] = {
          href: item.href,
          mediaType: item.mediaType
        };
        return;
      }

      const blob = await file.async('blob');
      resources[item.href] = {
        href: item.href,
        mediaType: item.mediaType,
        objectUrl: URL.createObjectURL(blob)
      };
    })
  );

  return resources;
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

export async function loadEpubBook(file: File): Promise<CanonicalBook> {
  if (!file.name.toLowerCase().endsWith('.epub')) {
    throw new Error('Please upload a valid .epub file.');
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
  const zip = await measureAsync('open-zip', () => JSZip.loadAsync(fileBuffer));
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) {
    throw new Error('EPUB container.xml is missing.');
  }

  const containerXml = await measureAsync('read-container', () =>
    containerEntry.async('text')
  );
  const containerDoc = measureSync('parse-container', () =>
    parseXml(containerXml, 'application/xml')
  );
  const rootfile = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfile) {
    throw new Error('EPUB package path could not be resolved.');
  }

  const opfEntry = zip.file(rootfile);
  if (!opfEntry) {
    throw new Error('EPUB package document is missing.');
  }

  const opfDir = dirname(rootfile);
  const opfXml = await measureAsync('read-package', () => opfEntry.async('text'));
  const opfDoc = measureSync('parse-package', () =>
    parseXml(opfXml, 'application/xml')
  );
  const manifest = measureSync('read-manifest', () => readManifest(opfDoc, opfDir));
  const spine = measureSync('read-spine', () =>
    readSpine(opfDoc).filter((item) => item.linear)
  );
  const metadata = measureSync('read-metadata', () => readMetadata(opfDoc));
  const resources = await measureAsync('load-resources', () =>
    loadResourceUrls(zip, manifest)
  );
  const stylesheetTexts = await measureAsync('load-stylesheets', () =>
    loadStylesheetTexts(zip, manifest)
  );
  const toc = await measureAsync('load-toc', () =>
    loadTocEntries(zip, manifest, opfDoc)
  );

  const preparedSections: Array<{
    sectionIndex: number;
    sectionId: string;
    manifestItem: ManifestItem;
    doc: Document;
    styleTexts: string[];
  }> = [];

  await measureAsync('prepare-sections', async () => {
    for (let sectionIndex = 0; sectionIndex < spine.length; sectionIndex += 1) {
      const spineItem = spine[sectionIndex];
      const manifestItem = manifest[spineItem.idref];
      if (!manifestItem) {
        continue;
      }

      const entry = zip.file(normalizeHref(manifestItem.href));
      if (!entry) {
        diagnostics.push({
          severity: 'warning',
          message: `Spine document ${manifestItem.href} could not be found in the archive.`
        });
        continue;
      }

      const rawXhtml = await entry.async('text');
      const mimeType = manifestItem.mediaType.includes('xhtml')
        ? 'application/xhtml+xml'
        : 'text/html';
      const doc = parseXml(rawXhtml, mimeType);
      preparedSections.push({
        sectionIndex,
        sectionId: makeId('section', sectionIndex),
        manifestItem,
        doc,
        styleTexts: [
          ...getLinkedStyleTexts(doc, manifestItem.href, stylesheetTexts),
          ...getInlineStyleTexts(doc)
        ]
      });
    }
  });

  const computedStyleResults = await measureAsync('compute-styles', () =>
    annotateDocumentsWithComputedStyles(
      preparedSections.map(({ doc, styleTexts }) => ({ doc, styleTexts }))
    )
  );

  const sections: BookSection[] = [];
  let globalOrder = 0;
  let totalSentences = 0;

  measureSync('build-sections', () => {
    for (let preparedIndex = 0; preparedIndex < preparedSections.length; preparedIndex += 1) {
      const { sectionIndex, sectionId, manifestItem, doc } = preparedSections[preparedIndex];
      const computedStylesApplied = computedStyleResults[preparedIndex] ?? false;
      if (!computedStylesApplied) {
        diagnostics.push({
          severity: 'warning',
          message: `Computed styles could not be fully resolved for ${manifestItem.href}.`,
          sectionId: sectionId
        });
      }
      const sectionBlocks = parseSectionBlocks(
        doc,
        sectionId,
        manifestItem.href,
        globalOrder,
        dirname(manifestItem.href),
        resources,
        metadata.language
      );

      if (sectionBlocks.length === 0) {
        diagnostics.push({
          severity: 'info',
          message: `Skipped empty spine document ${manifestItem.href}.`,
          sectionId
        });
        continue;
      }

      totalSentences += sectionBlocks.reduce(
        (sum, block) => sum + ('sentences' in block ? block.sentences.length : 0),
        0
      );
      globalOrder += sectionBlocks.length;
      sections.push({
        id: sectionId,
        index: sectionIndex,
        label:
          (sectionBlocks.find((block) => block.kind === 'heading') as TextBlock | undefined)
            ?.text ??
          `Section ${sectionIndex + 1}`,
        href: manifestItem.href,
        blocks: sectionBlocks,
        matter: 'body',
        anchorIds: collectAnchorIds(doc),
        localLinks: collectLocalLinks(sectionBlocks)
      });
    }
  });

  if (sections.length === 0) {
    throw new Error('No readable spine content was found in this EPUB.');
  }

  if (sections.length === 1) {
    diagnostics.push({
      severity: 'warning',
      message: 'Only one readable spine section was found; extraction quality may be degraded.'
    });
  }

  const classifiedSections = measureSync('classify-sections', () =>
    classifySections(sections, toc, diagnostics)
  );
  const effectiveToc = measureSync('finalize-toc', () => {
    if (hasUsableToc(toc, classifiedSections)) {
      return toc;
    }

    const derivedToc = deriveTocFromSections(classifiedSections);
    if (derivedToc.length > 0) {
      diagnostics.push({
        severity: toc.length === 0 ? 'info' : 'warning',
        message:
          toc.length === 0
            ? 'Generated a derived table of contents from classified body sections.'
            : 'Parsed table of contents was too weak; generated a derived table of contents from classified body sections.'
      });
      return derivedToc;
    }

    return toc;
  });
  const parseStats = createParseStats(diagnostics, parseStartTime, timings);

  return {
    id: createBookInstanceId(),
    fingerprint,
    metadata,
    sections: classifiedSections,
    toc: effectiveToc,
    resources,
    totalBlocks: globalOrder,
    totalSentences,
    parseStats
  };
}

export function revokeBookResources(book: CanonicalBook | null): void {
  if (!book) {
    return;
  }

  Object.values(book.resources).forEach((resource) => {
    if (resource.objectUrl) {
      URL.revokeObjectURL(resource.objectUrl);
    }
  });
}
