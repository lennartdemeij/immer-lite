export type ThemeMode = 'light' | 'dark' | 'sepia';

export type InlineMark = 'bold' | 'italic' | 'link' | 'code';

export interface BookInline {
  id: string;
  text: string;
  marks: InlineMark[];
  href?: string;
}

export interface SentenceUnit {
  id: string;
  index: number;
  text: string;
  inlineIds: string[];
  startOffset: number;
  endOffset: number;
}

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'quote'
  | 'list-item'
  | 'scene-break'
  | 'image';

export interface TextBlock {
  id: string;
  order: number;
  kind: 'heading' | 'paragraph' | 'quote' | 'list-item';
  sectionId: string;
  level?: number;
  listIndex?: number;
  listOrdered?: boolean;
  inlineContent: BookInline[];
  text: string;
  sentences: SentenceUnit[];
}

export interface SceneBreakBlock {
  id: string;
  order: number;
  kind: 'scene-break';
  sectionId: string;
}

export interface ImageBlock {
  id: string;
  order: number;
  kind: 'image';
  sectionId: string;
  src: string;
  alt: string;
  caption?: string;
}

export type BookBlock = TextBlock | SceneBreakBlock | ImageBlock;

export interface BookSection {
  id: string;
  index: number;
  label: string;
  href: string;
  blocks: BookBlock[];
}

export interface BookMetadata {
  title: string;
  creator?: string;
  language?: string;
  publisher?: string;
  description?: string;
}

export interface BookResource {
  href: string;
  mediaType: string;
  objectUrl?: string;
}

export interface CanonicalBook {
  id: string;
  fingerprint: string;
  metadata: BookMetadata;
  sections: BookSection[];
  resources: Record<string, BookResource>;
  totalBlocks: number;
  totalSentences: number;
}
