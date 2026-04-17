import type { BookBlock } from '../../types/book';
import type { ReaderSettings } from '../../types/reader';

export interface BlockTypography {
  font: string;
  lineHeightPx: number;
  marginTop: number;
  marginBottom: number;
  indent: number;
  imageMaxHeightRatio: number;
}

const BODY_FONT_FAMILY =
  '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const DISPLAY_FONT_FAMILY =
  '"Avenir Next Condensed", "Gill Sans", "Trebuchet MS", sans-serif';
const MONO_FONT_FAMILY =
  '"SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace';

function bodyFont(size: number, weight = 400, italic = false): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${BODY_FONT_FAMILY}`;
}

export function getInlineFont(
  settings: ReaderSettings,
  marks: string[],
  kind: Extract<BookBlock['kind'], 'heading' | 'paragraph' | 'quote' | 'list-item'>
): string {
  const baseSize =
    kind === 'heading'
      ? settings.fontSize * 1.5
      : kind === 'quote'
        ? settings.fontSize * 1.05
        : settings.fontSize;

  if (marks.includes('code')) {
    return `500 ${Math.round(baseSize * 0.94)}px ${MONO_FONT_FAMILY}`;
  }

  const weight = marks.includes('bold') || kind === 'heading' ? 650 : 400;
  const italic = marks.includes('italic') || kind === 'quote';
  if (kind === 'heading') {
    return `${italic ? 'italic ' : ''}${weight} ${Math.round(baseSize)}px ${DISPLAY_FONT_FAMILY}`;
  }

  return bodyFont(Math.round(baseSize), weight, italic);
}

export function getBlockTypography(
  kind: BookBlock['kind'],
  settings: ReaderSettings
): BlockTypography {
  switch (kind) {
    case 'heading':
      return {
        font: getInlineFont(settings, ['bold'], 'heading'),
        lineHeightPx: Math.round(settings.fontSize * 1.55),
        marginTop: 0,
        marginBottom: Math.round(settings.fontSize * 0.9),
        indent: 0,
        imageMaxHeightRatio: 0
      };
    case 'quote':
      return {
        font: getInlineFont(settings, ['italic'], 'quote'),
        lineHeightPx: Math.round(settings.fontSize * (settings.lineHeight + 0.12)),
        marginTop: Math.round(settings.fontSize * 0.4),
        marginBottom: Math.round(settings.fontSize * 0.8),
        indent: Math.round(settings.fontSize * 0.6),
        imageMaxHeightRatio: 0
      };
    case 'list-item':
      return {
        font: getInlineFont(settings, [], 'list-item'),
        lineHeightPx: Math.round(settings.fontSize * settings.lineHeight),
        marginTop: Math.round(settings.fontSize * 0.18),
        marginBottom: Math.round(settings.fontSize * 0.35),
        indent: Math.round(settings.fontSize * 1.1),
        imageMaxHeightRatio: 0
      };
    case 'image':
      return {
        font: '',
        lineHeightPx: 0,
        marginTop: Math.round(settings.fontSize * 0.7),
        marginBottom: Math.round(settings.fontSize * 0.7),
        indent: 0,
        imageMaxHeightRatio: 0.36
      };
    case 'scene-break':
      return {
        font: '',
        lineHeightPx: 0,
        marginTop: Math.round(settings.fontSize * 0.8),
        marginBottom: Math.round(settings.fontSize * 0.8),
        indent: 0,
        imageMaxHeightRatio: 0
      };
    case 'paragraph':
    default:
      return {
        font: getInlineFont(settings, [], 'paragraph'),
        lineHeightPx: Math.round(settings.fontSize * settings.lineHeight),
        marginTop: Math.round(settings.fontSize * 0.25),
        marginBottom: Math.round(settings.fontSize * 0.55),
        indent: 0,
        imageMaxHeightRatio: 0
      };
  }
}
