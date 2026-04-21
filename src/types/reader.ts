import type { BookBlock, ThemeMode } from './book';

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  horizontalPadding: number;
  theme: ThemeMode;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
}

export interface ReaderAnchor {
  blockId: string;
  blockOrder: number;
  sentenceIndex: number;
  lineOffset: number;
}

export interface RenderFragment {
  key: string;
  text: string;
  font: string;
  marks: string[];
  href?: string;
  blockStart?: number;
  blockEnd?: number;
}

export interface RenderLine {
  key: string;
  fragments: RenderFragment[];
}

export interface PortionTextSlice {
  type: 'text';
  key: string;
  blockId: string;
  blockOrder: number;
  kind: Extract<BookBlock['kind'], 'heading' | 'paragraph' | 'quote' | 'list-item'>;
  lines: RenderLine[];
  startSentence: number;
  endSentence: number;
  continuationStart: boolean;
  continuationEnd: boolean;
  label?: string;
}

export interface PortionSceneBreak {
  type: 'scene-break';
  key: string;
  blockId: string;
}

export interface PortionImage {
  type: 'image';
  key: string;
  blockId: string;
  src: string;
  alt: string;
  caption?: string;
}

export type PortionBlock = PortionTextSlice | PortionSceneBreak | PortionImage;

export interface ReaderPortion {
  id: string;
  index: number;
  sectionId: string;
  sectionLabel: string;
  start: ReaderAnchor;
  end: ReaderAnchor;
  blocks: PortionBlock[];
}

export interface PaginationResult {
  portions: ReaderPortion[];
}

export interface TextAnnotation {
  id: string;
  fingerprint: string;
  blockId: string;
  blockOrder: number;
  startOffset: number;
  endOffset: number;
  sentenceIndex: number;
  selectedText: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}
