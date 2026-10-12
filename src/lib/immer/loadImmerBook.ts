import type { BookInline, BookSection, CanonicalBook, InlineMark, TextBlock, TocEntry } from '../../types/book';
import { segmentSentences } from '../segmentation/sentences';

type ImmerItemContent =
  | { type: 'TEXT'; text: string }
  | { type: 'IMAGE'; uri: string; mediaType: string; imageType: 'BASE64' | 'LINK'; width: number; height: number };
type ImmerItem = ImmerItemContent & { itemLocationId: string; override?: ImmerItemContent | null };
interface ImmerSection { sectionLocationId: string; itemLocationIds: ImmerItem[] }
interface ImmerListRow {
  type: 'PARENT' | 'LEAF';
  children?: ImmerListRow[];
  startItemLocationId?: string;
  endItemLocationId?: string;
}
interface ImmerTocNode {
  type: 'TITLE' | 'PART' | 'CHAPTER' | 'SUBCHAPTER' | 'LEAF';
  id?: string;
  headerSectionLocationIds?: string[];
  headerTextOverride?: string | null;
  sectionLocationIds?: string[];
  children?: ImmerTocNode[];
}
export interface ImmerBookData {
  immerBookId: string;
  versionId: string;
  title: string;
  authors?: string[];
  locations: { sections: ImmerSection[] };
  metadata: {
    language?: string | null;
    selectedTocOptionId: string;
    tocOptions: ImmerTocNode[];
    hiddenItemLocationIds: Array<{ id: string }>;
    itemStyles: Record<string, Array<{ id: string; indexes?: number[] | null }>>;
    sectionClassifications: Array<{ id: string; type: string; rows?: ImmerListRow[] }>;
    internalBookLinks: Array<{ fromSectionLocationId: string; toSectionLocationId: string }>;
  };
}

const styleMarks: Record<string, InlineMark> = {
  bold: 'bold', italic: 'italic', underlined: 'underline', strikethrough: 'strikethrough', smallcaps: 'smallcaps'
};

function resolveItem(item: ImmerItem): ImmerItem {
  return item.override ? { ...item.override, itemLocationId: item.itemLocationId } : item;
}

export function adaptImmerBook(data: ImmerBookData): CanonicalBook {
  const started = performance.now();
  if (!data.immerBookId || !data.versionId || !Array.isArray(data.locations?.sections) || !data.metadata) {
    throw new Error('Invalid Immer book data.');
  }
  const { metadata } = data;
  const tocSource = metadata.tocOptions.find((option) => option.id === metadata.selectedTocOptionId);
  if (!tocSource) throw new Error('The selected Immer table of contents is missing.');
  const language = metadata.language?.replaceAll('_', '-') || 'en';
  const hidden = new Set(metadata.hiddenItemLocationIds.map((item) => item.id));
  const sources = new Map(data.locations.sections.map((section) => [section.sectionLocationId, {
    ...section, itemLocationIds: section.itemLocationIds.filter((item) => !hidden.has(item.itemLocationId)).map(resolveItem)
  }]));
  const classifications = new Map(metadata.sectionClassifications.map((entry) => [entry.id, entry]));
  const styles = new Map<string, Array<{ mark: InlineMark; indexes?: Set<number> }>>();
  for (const [style, entries] of Object.entries(metadata.itemStyles)) {
    const mark = styleMarks[style];
    if (!mark) continue;
    for (const entry of entries) {
      const list = styles.get(entry.id) ?? [];
      list.push({ mark, indexes: entry.indexes ? new Set(entry.indexes) : undefined });
      styles.set(entry.id, list);
    }
  }

  const groups: Array<{ section: BookSection; sourceIds: string[] }> = [];
  const seen = new Set<string>();
  const headings = new Map<string, number>();
  const groupBySource = new Map<string, BookSection>();
  function getSource(id: string): ImmerSection {
    const source = sources.get(id);
    if (!source) throw new Error(`Immer content is missing section ${id}.`);
    return source;
  }
  function createGroup(id: string, label: string, depth: number) {
    const section: BookSection = {
      id: `immer-section-${id}`, index: groups.length, label, navLabel: label, tocDepth: depth,
      href: `immer/${id}`, blocks: [], matter: 'body', anchorIds: [], localLinks: []
    };
    const group = { section, sourceIds: [] as string[] };
    groups.push(group);
    return group;
  }
  function addSource(id: string, group: (typeof groups)[number]) {
    getSource(id);
    if (seen.has(id)) return;
    seen.add(id);
    group.sourceIds.push(id);
    group.section.anchorIds.push(id);
    groupBySource.set(id, group.section);
  }
  function visit(node: ImmerTocNode, inherited?: (typeof groups)[number], depth = 0): TocEntry[] {
    if (node.type === 'LEAF') {
      let group = inherited;
      for (const id of node.sectionLocationIds ?? []) {
        group ??= createGroup(id, data.title, depth);
        addSource(id, group);
      }
      return [];
    }
    const headers = node.headerSectionLocationIds ?? [];
    if (headers.length === 0) return (node.children ?? []).flatMap((child) => visit(child, inherited, depth));
    const label = node.headerTextOverride ?? headers.map((id) => getSource(id).itemLocationIds
      .filter((item) => item.type === 'TEXT').map((item) => item.text).join(' ')).join(' ');
    const group = createGroup(headers[0], label, depth);
    for (const id of headers) {
      headings.set(id, node.type === 'PART' ? 1 : node.type === 'CHAPTER' ? 2 : 3);
      addSource(id, group);
    }
    return [{
      id: `immer-toc-${headers[0]}`, label, href: group.section.href, depth,
      children: (node.children ?? []).flatMap((child) => visit(child, group, depth + 1))
    }];
  }
  const toc = visit(tocSource);
  const links = new Map(metadata.internalBookLinks.map((link) => [link.fromSectionLocationId, link.toSectionLocationId]));
  let order = 0;
  let totalSentences = 0;

  function makeTextBlock(items: ImmerItem[], id: string, section: BookSection, kind: TextBlock['kind'], level?: number): TextBlock | null {
    const seed: BookInline[] = [];
    let text = '';
    for (const item of items) {
      if (item.type !== 'TEXT') continue;
      const value = item.text.replace(/\s+/g, ' ').trim();
      if (!value) continue;
      if (text) {
        seed[seed.length - 1].text += ' ';
        seed[seed.length - 1].endOffset! += 1;
        text += ' ';
      }
      const itemStyles = styles.get(item.itemLocationId) ?? [];
      const targetId = links.get(id);
      const target = targetId ? groupBySource.get(targetId) : undefined;
      for (let index = 0; index < value.length; index += 1) {
        const marks = itemStyles.filter((style) => !style.indexes || style.indexes.has(index)).map((style) => style.mark);
        if (target) marks.push('link');
        const previous = seed[seed.length - 1];
        if (previous?.sourceItemLocationId === item.itemLocationId && previous.marks.join() === marks.join()) {
          previous.text += value[index];
          previous.endOffset! += 1;
        } else {
          seed.push({ id: `${item.itemLocationId}:${index}`, sourceItemLocationId: item.itemLocationId,
            text: value[index], marks, startOffset: text.length + index, endOffset: text.length + index + 1,
            href: target ? `${target.href}#${targetId}` : undefined });
        }
      }
      text += value;
    }
    if (!text) return null;
    const inlineContent: BookInline[] = [];
    let seedIndex = 0;
    const sentences = segmentSentences(text, language).map((boundary, index) => {
      const inlineIds: string[] = [];
      while (seedIndex < seed.length && seed[seedIndex].endOffset! <= boundary.start) seedIndex += 1;
      for (let i = seedIndex; i < seed.length && seed[i].startOffset! < boundary.end; i += 1) {
        const inline = seed[i];
        const startOffset = Math.max(boundary.start, inline.startOffset!);
        const endOffset = Math.min(boundary.end, inline.endOffset!);
        const slice = { ...inline, id: `${inline.id}:sentence-${index}`, startOffset, endOffset,
          text: inline.text.slice(startOffset - inline.startOffset!, endOffset - inline.startOffset!) };
        inlineContent.push(slice);
        inlineIds.push(slice.id);
      }
      return { id: `${id}:sentence-${index}`, index, text: boundary.text, inlineIds, startOffset: boundary.start, endOffset: boundary.end };
    });
    totalSentences += sentences.length;
    return { id, order: order++, sectionId: section.id, kind, level, text, inlineContent, sentences };
  }

  function listRows(rows: ImmerListRow[]): ImmerListRow[] {
    return rows.flatMap((row) => row.type === 'PARENT' ? listRows(row.children ?? []) : [row]);
  }
  for (const { section, sourceIds } of groups) {
    for (const sourceId of sourceIds) {
      const source = getSource(sourceId);
      const classification = classifications.get(sourceId);
      const level = headings.get(sourceId);
      const isList = classification?.type === 'ORDERED_LIST' || classification?.type === 'UNORDERED_LIST';
      const kind = level ? 'heading' : isList ? 'list-item'
        : classification?.type.startsWith('EMPHASIZED') || classification?.type === 'EPIGRAPH' ? 'quote' : 'paragraph';
      const rows = isList && classification.rows?.length ? listRows(classification.rows).map((row) => {
        const start = source.itemLocationIds.findIndex((item) => item.itemLocationId === row.startItemLocationId);
        const end = source.itemLocationIds.findIndex((item) => item.itemLocationId === row.endItemLocationId);
        return source.itemLocationIds.slice(Math.max(0, start), end < 0 ? undefined : end + 1);
      }) : [source.itemLocationIds];
      let part = 0;
      rows.forEach((items, rowIndex) => {
        let pending: ImmerItem[] = [];
        const flush = () => {
          const id = part === 0 ? sourceId : `${sourceId}:${part}`;
          const block = makeTextBlock(pending, id, section, kind, level);
          pending = [];
          if (!block) return;
          part += 1;
          if (isList) Object.assign(block, { listIndex: rowIndex + 1, listOrdered: classification?.type === 'ORDERED_LIST' });
          section.blocks.push(block);
        };
        for (const item of items) {
          if (item.type === 'TEXT') { pending.push(item); continue; }
          flush();
          const src = item.imageType === 'LINK' || item.uri.startsWith('data:') ? item.uri : `data:${item.mediaType};base64,${item.uri}`;
          section.blocks.push({ id: item.itemLocationId, order: order++, kind: 'image', sectionId: section.id, src, alt: '' });
        }
        flush();
      });
      const targetId = links.get(sourceId);
      const target = targetId ? groupBySource.get(targetId) : undefined;
      if (target) section.localLinks.push(`${target.href}#${targetId}`);
    }
  }
  const sections = groups.map((group) => group.section).filter((section) => section.blocks.length > 0);
  sections.forEach((section, index) => { section.index = index; });
  if (sections.length === 0) throw new Error('No readable content found in the Immer book.');
  return {
    id: `immer:${data.immerBookId}:${data.versionId}`, fingerprint: `immer:${data.immerBookId}:${data.versionId}`,
    metadata: { title: data.title, creator: data.authors?.join(', '), language }, sections, toc, resources: {},
    totalBlocks: order, totalSentences,
    parseStats: { confidence: 1, diagnostics: [
      { severity: 'info', message: 'Loaded parsed Immer book data; pagination runs locally with Pretext.' },
      ...(sources.size > seen.size ? [{ severity: 'info' as const,
        message: `${sources.size - seen.size} source sections are outside the selected Immer table of contents and were excluded.` }] : [])
    ],
      parsedAt: new Date().toISOString(), durationMs: performance.now() - started }
  };
}

export async function loadDemoImmerBook(): Promise<CanonicalBook> {
  const response = await fetch(`${import.meta.env.BASE_URL}immer-demo-book.json`);
  if (!response.ok) throw new Error(`Could not load the Immer demo book (${response.status}).`);
  return adaptImmerBook(await response.json());
}
