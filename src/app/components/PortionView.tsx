import { memo } from 'react';
import type { PortionBlock, ReaderPortion, ReaderSettings } from '../../types/reader';
import { getBlockTypography } from '../../lib/portioning/styleMap';

interface PortionViewProps {
  portion: ReaderPortion;
  settings: ReaderSettings;
}

const TextSlice = memo(function TextSlice({
  block,
  settings
}: {
  block: Extract<PortionBlock, { type: 'text' }>;
  settings: ReaderSettings;
}) {
  const typography = getBlockTypography(block.kind, settings);
  return (
    <article
      className={`reader-block reader-block-${block.kind}`}
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
              if (fragment.href) {
                return (
                  <a
                    key={fragment.key}
                    className={classNames}
                    href={fragment.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{ font: fragment.font }}
                  >
                    {fragment.text}
                  </a>
                );
              }

              return (
                <span
                  key={fragment.key}
                  className={classNames}
                  style={{ font: fragment.font }}
                >
                  {fragment.text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </article>
  );
});

export const PortionView = memo(function PortionView({ portion, settings }: PortionViewProps) {
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

        return <TextSlice key={block.key} block={block} settings={settings} />;
      })}
    </div>
  );
});
