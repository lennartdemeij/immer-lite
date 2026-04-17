import JSZip from 'jszip';
import type {
  BookBlock,
  BookInline,
  BookMetadata,
  BookResource,
  BookSection,
  CanonicalBook,
  ImageBlock,
  SceneBreakBlock,
  SentenceUnit,
  TextBlock
} from '../../types/book';
import { segmentSentences } from '../segmentation/sentences';
import { dirname, joinPath, stripFragment } from './path';

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
    text: slice
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
      text
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
  const nextMarks = [...inheritedMarks];
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
    tag === 'a' ? node.getAttribute('href') ?? linkHref : linkHref;
  if (tag === 'a') {
    nextMarks.push('link');
  }

  node.childNodes.forEach((child) =>
    extractInlineContent(child, nextMarks, nextHref, acc, idPrefix)
  );
  return acc;
}

function createTextBlock(
  element: Element,
  kind: TextBlock['kind'],
  sectionId: string,
  order: number,
  locale: string | undefined,
  options: Partial<Pick<TextBlock, 'level' | 'listIndex' | 'listOrdered'>>
): TextBlock | null {
  const blockId = makeId(sectionId, kind, order);
  const inlineSeed = extractInlineContent(element, [], undefined, [], blockId);
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
    ...options
  };
}

function isSceneBreak(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag === 'hr') {
    return true;
  }
  const text = sanitizeText(element.textContent ?? '');
  return /^(?:\*+\s*){3,}|(?:·\s*){3,}|(?:•\s*){3,}$/.test(text);
}

function normalizeImageSrc(sectionDir: string, src: string): string {
  return joinPath(sectionDir, stripFragment(src));
}

function parseSectionBlocks(
  doc: Document,
  sectionId: string,
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

  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
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

    if (isSceneBreak(element)) {
      const block: SceneBreakBlock = {
        id: makeId(sectionId, 'scene-break', order),
        order,
        kind: 'scene-break',
        sectionId
      };
      blocks.push(block);
      order += 1;
      return;
    }

    if (/^h[1-6]$/.test(tag)) {
      const block = createTextBlock(
        element,
        'heading',
        sectionId,
        order,
        locale,
        { level: Number(tag.slice(1)) }
      );
      if (block) {
        blocks.push(block);
        order += 1;
      }
      return;
    }

    if (tag === 'blockquote') {
      const block = createTextBlock(
        element,
        'quote',
        sectionId,
        order,
        locale,
        {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
      }
      return;
    }

    if (tag === 'p') {
      const image = element.querySelector(':scope > img');
      if (image && sanitizeText(element.textContent ?? '') === '') {
        const src = image.getAttribute('src');
        if (src) {
          const resolved = normalizeImageSrc(sectionDir, src);
          const resource = resourceUrls[resolved];
          if (resource?.objectUrl) {
            const block: ImageBlock = {
              id: makeId(sectionId, 'image', order),
              order,
              kind: 'image',
              sectionId,
              src: resource.objectUrl,
              alt: image.getAttribute('alt') ?? '',
              caption: image.getAttribute('title') ?? undefined
            };
            blocks.push(block);
            order += 1;
            return;
          }
        }
      }

      const block = createTextBlock(
        element,
        'paragraph',
        sectionId,
        order,
        locale,
        {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
        return;
      }
    }

    if (tag === 'div' || tag === 'section' || tag === 'article') {
      if (hasNestedBlockChildren) {
        Array.from(element.children).forEach(visit);
        return;
      }

      const block = createTextBlock(
        element,
        'paragraph',
        sectionId,
        order,
        locale,
        {}
      );
      if (block) {
        blocks.push(block);
        order += 1;
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
      return;
    }

    if (tag === 'img') {
      const src = element.getAttribute('src');
      if (src) {
        const resolved = normalizeImageSrc(sectionDir, src);
        const resource = resourceUrls[resolved];
        if (resource?.objectUrl) {
          blocks.push({
            id: makeId(sectionId, 'image', order),
            order,
            kind: 'image',
            sectionId,
            src: resource.objectUrl,
            alt: element.getAttribute('alt') ?? '',
            caption: element.getAttribute('title') ?? undefined
          });
          order += 1;
        }
      }
      return;
    }

    Array.from(element.children).forEach(visit);
  };

  Array.from(body.children).forEach(visit);
  return blocks;
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

      if (!item.mediaType.startsWith('image/')) {
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

function makeFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export async function loadEpubBook(file: File): Promise<CanonicalBook> {
  if (!file.name.toLowerCase().endsWith('.epub')) {
    throw new Error('Please upload a valid .epub file.');
  }

  const fileBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(fileBuffer);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) {
    throw new Error('EPUB container.xml is missing.');
  }

  const containerXml = await containerEntry.async('text');
  const containerDoc = parseXml(containerXml, 'application/xml');
  const rootfile = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfile) {
    throw new Error('EPUB package path could not be resolved.');
  }

  const opfEntry = zip.file(rootfile);
  if (!opfEntry) {
    throw new Error('EPUB package document is missing.');
  }

  const opfDir = dirname(rootfile);
  const opfXml = await opfEntry.async('text');
  const opfDoc = parseXml(opfXml, 'application/xml');
  const manifest = readManifest(opfDoc, opfDir);
  const spine = readSpine(opfDoc).filter((item) => item.linear);
  const metadata = readMetadata(opfDoc);
  const resources = await loadResourceUrls(zip, manifest);

  const sections: BookSection[] = [];
  let globalOrder = 0;
  let totalSentences = 0;

  for (let sectionIndex = 0; sectionIndex < spine.length; sectionIndex += 1) {
    const spineItem = spine[sectionIndex];
    const manifestItem = manifest[spineItem.idref];
    if (!manifestItem) {
      continue;
    }

    const entry = zip.file(normalizeHref(manifestItem.href));
    if (!entry) {
      continue;
    }

    const rawXhtml = await entry.async('text');
    const mimeType = manifestItem.mediaType.includes('xhtml')
      ? 'application/xhtml+xml'
      : 'text/html';
    const doc = parseXml(rawXhtml, mimeType);
    const sectionId = makeId('section', sectionIndex);
    const sectionBlocks = parseSectionBlocks(
      doc,
      sectionId,
      globalOrder,
      dirname(manifestItem.href),
      resources,
      metadata.language
    );

    if (sectionBlocks.length === 0) {
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
      blocks: sectionBlocks
    });
  }

  if (sections.length === 0) {
    throw new Error('No readable spine content was found in this EPUB.');
  }

  return {
    id: createBookInstanceId(),
    fingerprint: makeFingerprint(file),
    metadata,
    sections,
    resources,
    totalBlocks: globalOrder,
    totalSentences
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
