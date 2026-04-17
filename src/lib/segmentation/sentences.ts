const COMMON_ABBREVIATIONS = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'sr.',
  'jr.',
  'st.',
  'vs.',
  'etc.',
  'e.g.',
  'i.e.',
  'u.s.',
  'u.k.',
  'no.',
  'fig.',
  'dept.',
  'inc.'
]);

function fallbackSegment(text: string): Array<{ segment: string; index: number }> {
  const segments: Array<{ segment: string; index: number }> = [];
  const matcher =
    /.+?(?:\.{3,}|[.!?]["')\]]*|[。！？]+["」』）】]*|$)(?:\s+|$)/gs;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const segment = match[0];
    if (!segment.trim()) {
      continue;
    }

    segments.push({
      segment,
      index: match.index
    });
  }

  if (segments.length === 0 && text.trim()) {
    segments.push({ segment: text, index: 0 });
  }

  return segments;
}

function joinFalseBoundaries(
  raw: Array<{ segment: string; index: number }>
): Array<{ segment: string; index: number }> {
  const merged: Array<{ segment: string; index: number }> = [];

  for (const current of raw) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push({ ...current });
      continue;
    }

    const previousTrimmed = previous.segment.trimEnd();
    const tokens = previousTrimmed.split(/\s+/);
    const lastToken = tokens[tokens.length - 1]?.toLowerCase() ?? '';
    const nextLead = current.segment.trimStart().slice(0, 1);

    const shouldMerge =
      COMMON_ABBREVIATIONS.has(lastToken) ||
      /^[a-z]/.test(nextLead) ||
      /(?:\b[A-Z]\.){2,}$/.test(previousTrimmed) ||
      /\.\.\.[)"'\]]*$/.test(previousTrimmed);

    if (shouldMerge) {
      previous.segment += current.segment;
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

export interface SentenceBoundary {
  text: string;
  start: number;
  end: number;
}

export function segmentSentences(
  text: string,
  locale?: string
): SentenceBoundary[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  let rawSegments: Array<{ segment: string; index: number }> = [];
  const SegmenterCtor = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: 'sentence' }
    ) => {
      segment(input: string): Iterable<{ segment: string; index: number }>;
    };
  }).Segmenter;

  if (typeof Intl !== 'undefined' && SegmenterCtor) {
    const segmenter = new SegmenterCtor(locale, { granularity: 'sentence' });
    rawSegments = Array.from(segmenter.segment(normalized)).map((entry) => ({
      segment: entry.segment,
      index: entry.index
    }));
  } else {
    rawSegments = fallbackSegment(normalized);
  }

  const merged = joinFalseBoundaries(rawSegments);
  return merged.map((entry) => ({
    text: entry.segment.trim(),
    start: entry.index,
    end: entry.index + entry.segment.length
  }));
}
