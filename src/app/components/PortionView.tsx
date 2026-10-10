import { memo, type CSSProperties } from 'react';
import type {
  PortionBlock,
  ReaderPortion,
  ReaderSettings,
  RenderFragment,
  TextAnnotation
} from '../../types/reader';
import { getBlockTypography } from '../../lib/portioning/styleMap';

interface PortionViewProps {
  portion: ReaderPortion;
  settings: ReaderSettings;
  annotationsByBlock: Map<string, TextAnnotation[]>;
  onAnnotationPress?: (annotation: TextAnnotation) => void;
  hideLeadingBoundarySceneBreak?: boolean;
  hideTrailingBoundarySceneBreak?: boolean;
}

interface FragmentSegment {
  text: string;
  annotation?: TextAnnotation;
  start?: number;
  end?: number;
}

function renderWords(segment: FragmentSegment, animateWords: boolean, paperInk: boolean) {
  return Array.from(segment.text.matchAll(/\s+|\S+/gu), (match) => {
    const start = segment.start === undefined ? undefined : segment.start + match.index;
    const end = start === undefined ? undefined : Math.min(start + match[0].length, segment.end ?? Infinity);
    return (
      <span key={match.index} className={/\S/u.test(match[0]) ? [animateWords && 'reader-word', paperInk && 'paper-ink'].filter(Boolean).join(' ') : undefined}
        data-block-start={start} data-block-end={end}>
        {match[0]}
      </span>
    );
  });
}

function splitFragmentByAnnotations(
  fragment: RenderFragment,
  annotations: TextAnnotation[]
): FragmentSegment[] {
  if (
    annotations.length === 0 ||
    typeof fragment.blockStart !== 'number' ||
    typeof fragment.blockEnd !== 'number' ||
    fragment.blockEnd <= fragment.blockStart
  ) {
    return [{ text: fragment.text, start: fragment.blockStart, end: fragment.blockEnd }];
  }

  const relevant = annotations.filter(
    (annotation) =>
      annotation.endOffset > fragment.blockStart! &&
      annotation.startOffset < fragment.blockEnd!
  );

  if (relevant.length === 0) {
    return [{ text: fragment.text, start: fragment.blockStart, end: fragment.blockEnd }];
  }

  const cutPoints = new Set<number>([fragment.blockStart, fragment.blockEnd]);
  relevant.forEach((annotation) => {
    cutPoints.add(Math.max(fragment.blockStart!, annotation.startOffset));
    cutPoints.add(Math.min(fragment.blockEnd!, annotation.endOffset));
  });

  const orderedCuts = Array.from(cutPoints).sort((left, right) => left - right);
  const segments: FragmentSegment[] = [];

  for (let index = 0; index < orderedCuts.length - 1; index += 1) {
    const start = orderedCuts[index];
    const end = orderedCuts[index + 1];
    if (end <= start) {
      continue;
    }

    const text = fragment.text.slice(start - fragment.blockStart!, end - fragment.blockStart!);
    if (!text) {
      continue;
    }

    segments.push({
      text,
      start,
      end,
      annotation: relevant.find(
        (annotation) => annotation.startOffset <= start && annotation.endOffset >= end
      )
    });
  }

  return segments.length > 0
    ? segments
    : [{ text: fragment.text, start: fragment.blockStart, end: fragment.blockEnd }];
}

const TextSlice = memo(function TextSlice({
  block,
  settings,
  annotationsByBlock,
  onAnnotationPress
}: {
  block: Extract<PortionBlock, { type: 'text' }>;
  settings: ReaderSettings;
  annotationsByBlock: Map<string, TextAnnotation[]>;
  onAnnotationPress?: (annotation: TextAnnotation) => void;
}) {
  const typography = getBlockTypography(block.kind, settings);
  const blockAnnotations = annotationsByBlock.get(block.blockId) ?? [];
  return (
    <article
      className={`reader-block reader-block-${block.kind}`}
      data-block-id={block.blockId}
      data-block-order={block.blockOrder}
      data-start-sentence={block.startSentence}
      data-end-sentence={block.endSentence}
      style={{
        '--block-line-height': `${typography.lineHeightPx}px`,
        '--block-indent': `${typography.indent}px`,
        '--block-margin-top': `${block.continuationStart ? 0 : typography.marginTop}px`,
        '--block-margin-bottom': `${block.continuationEnd ? 0 : typography.marginBottom}px`
      } as React.CSSProperties}
    >
      {block.label ? <span className="list-label">{block.label}</span> : null}
      <div className="reader-lines">
        {block.lines.map((line) => (
          <div key={line.key} className="reader-line">
            {line.fragments.map((fragment) => {
              const classNames = fragment.marks.map((mark) => `mark-${mark}`).join(' ');
              const segments = splitFragmentByAnnotations(fragment, blockAnnotations);
              return (
                <span key={fragment.key} className={classNames} style={{ font: fragment.font }}>
                  {segments.map((segment, segmentIndex) => (
                    <span
                      key={`${fragment.key}-segment-${segmentIndex}`}
                      className={segment.annotation ? 'annotation-text' : undefined}
                      data-block-start={segment.start}
                      data-block-end={segment.end}
                      data-annotation-id={segment.annotation?.id}
                      data-reader-interactive={segment.annotation ? 'true' : undefined}
                      onClick={
                        segment.annotation && onAnnotationPress
                          ? (event) => {
                              event.stopPropagation();
                              onAnnotationPress(segment.annotation!);
                            }
                          : undefined
                      }
                    >
                      {settings.wordAnimation || settings.theme === 'paperback'
                        ? renderWords(segment, Boolean(settings.wordAnimation), settings.theme === 'paperback') : segment.text}
                    </span>
                  ))}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </article>
  );
});

export const PortionView = memo(function PortionView({
  portion,
  settings,
  annotationsByBlock,
  onAnnotationPress,
  hideLeadingBoundarySceneBreak = false,
  hideTrailingBoundarySceneBreak = false
}: PortionViewProps) {
  // Stable per portion: revisiting a page keeps the same paper and reverse-side ink.
  const paperSeed = Array.from(portion.id ?? '').reduce((seed, letter) =>
    (Math.imul(seed, 31) + letter.charCodeAt(0)) >>> 0, portion.index ?? 0);
  const reverseLines = settings.theme === 'paperback'
    ? portion.blocks.flatMap((block) => block.type === 'text'
      ? block.lines.map((line) => line.fragments.map((fragment) => fragment.text).join('')) : [])
    : [];
  const reverseOffset = reverseLines.length ? (paperSeed % reverseLines.length) : 0;
  return (
    <div className="portion-sheet" style={settings.theme === 'paperback' ? {
      '--paper-x': `${paperSeed % 389}px`,
      '--paper-y': `${paperSeed % 521}px`,
      '--paper-ink-offset': `${8 + paperSeed % 13}px`,
      '--paper-ink-angle': `${(paperSeed % 7 - 3) * 0.12}deg`,
      '--paper-font-size': `${settings.fontSize}px`,
      '--paper-line-height': `${Math.round(settings.fontSize * settings.lineHeight)}px`
    } as CSSProperties : undefined}>
      {reverseLines.length > 0 ? (
        <div className="paper-reverse-ink" aria-hidden="true">
          {reverseLines.map((_, index) => (
            <div key={index}>{reverseLines[(index + reverseOffset) % reverseLines.length]}</div>
          ))}
        </div>
      ) : null}
      {portion.blocks.map((block, index) => {
        if (block.type === 'scene-break') {
          const isLeadingBoundary = index === 0 && hideLeadingBoundarySceneBreak;
          const isTrailingBoundary =
            index === portion.blocks.length - 1 && hideTrailingBoundarySceneBreak;
          if (isLeadingBoundary || isTrailingBoundary) {
            return null;
          }

          return (
            <div key={block.key} className="scene-break" aria-hidden="true" />
          );
        }

        if (block.type === 'image') {
          return (
            <figure key={block.key} className="image-block">
              <img src={block.src} alt={block.alt} />
              {block.caption ? <figcaption>{block.caption}</figcaption> : null}
            </figure>
          );
        }

        return (
          <TextSlice
            key={block.key}
            block={block}
            settings={settings}
            annotationsByBlock={annotationsByBlock}
            onAnnotationPress={onAnnotationPress}
          />
        );
      })}
    </div>
  );
});
