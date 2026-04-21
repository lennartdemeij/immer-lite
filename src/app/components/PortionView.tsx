import { memo } from 'react';
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
}

interface FragmentSegment {
  text: string;
  annotation?: TextAnnotation;
  start?: number;
  end?: number;
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
              if (fragment.href) {
                return (
                  <a
                    key={fragment.key}
                    className={classNames}
                    href={fragment.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ font: fragment.font }}
                    data-block-start={fragment.blockStart}
                    data-block-end={fragment.blockEnd}
                  >
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
                        {segment.text}
                      </span>
                    ))}
                  </a>
                );
              }

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
                      {segment.text}
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
  onAnnotationPress
}: PortionViewProps) {
  return (
    <div className="portion-sheet">
      {portion.blocks.map((block) => {
        if (block.type === 'scene-break') {
          return (
            <div key={block.key} className="scene-break" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
