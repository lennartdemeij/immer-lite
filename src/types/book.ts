export type ThemeMode = 'light' | 'dark' | 'sepia';

export type InlineMark =
  | 'bold'
  | 'italic'
  | 'link'
  | 'code'
  | 'underline'
  | 'strikethrough'
  | 'smallcaps';

export interface BookComputedStyle {
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  fontFamily: string;
  fontStyle: string;
  fontWeight: string;
  fontVariant: string;
  textDecorationLine: string;
  textAlign: string;
  display: string;
  cssDefinedPageBreak?: 'before' | 'after';
}

export interface BookInline {
  id: string;
  text: string;
  marks: InlineMark[];
  href?: string;
  startOffset?: number;
  endOffset?: number;
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
  computedStyle?: BookComputedStyle;
}

export interface SceneBreakBlock {
  id: string;
  order: number;
  kind: 'scene-break';
  sectionId: string;
  computedStyle?: BookComputedStyle;
}

export interface ImageBlock {
  id: string;
  order: number;
  kind: 'image';
  sectionId: string;
  src: string;
  alt: string;
  caption?: string;
  computedStyle?: BookComputedStyle;
}

export type BookBlock = TextBlock | SceneBreakBlock | ImageBlock;

export interface TocEntry {
  id: string;
  label: string;
  href: string;
  depth: number;
  children: TocEntry[];
}

export type SectionMatter = 'front' | 'body' | 'back';

export interface BookSection {
  id: string;
  index: number;
  label: string;
  href: string;
  blocks: BookBlock[];
  matter: SectionMatter;
  navLabel?: string;
  tocDepth?: number;
  anchorIds: string[];
  localLinks: string[];
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

export interface ParseDiagnostic {
  severity: 'info' | 'warning' | 'error';
  message: string;
  sectionId?: string;
}

export interface ParseTiming {
  stage: string;
  durationMs: number;
}

export interface BookParseStats {
  confidence: number;
  diagnostics: ParseDiagnostic[];
  parsedAt: string;
  durationMs: number;
  timings?: ParseTiming[];
}

export interface CanonicalBook {
  id: string;
  fingerprint: string;
  metadata: BookMetadata;
  sections: BookSection[];
  toc: TocEntry[];
  resources: Record<string, BookResource>;
  totalBlocks: number;
  totalSentences: number;
  parseStats: BookParseStats;
}
