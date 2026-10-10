import { useLayoutEffect, useRef } from 'react';

const DEPTHS = [0.025, 0.065, 0.14];
const TRAIL = [8, 22, 48];
const TRAIL_DURATION = [1400, 1700, 2000];
const PAPER_DEPTHS = [0.045];
const PAPER_TRAIL = [10];
const PAPER_TRAIL_DURATION = [1700];
const tileOffset = (offset: number, period: number) => ((offset % period) + period) % period - period;
const dragDistance = (offset: number) => Math.max(-2000, Math.min(2000, offset));

export function ReaderBackground({ portionIndex, paginationPending, dragOffset, isDragging, snapDirection, transitionEnabled, variant = 'dust', motionEnabled = true, transitionDuration = 240 }: {
  portionIndex: number;
  paginationPending: boolean;
  dragOffset: number;
  isDragging: boolean;
  snapDirection: 'forward' | 'backward' | null;
  transitionEnabled: boolean;
  variant?: 'dust' | 'paper';
  motionEnabled?: boolean;
  transitionDuration?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const animations = useRef<(Animation | null)[]>([]);
  const bases = useRef([0, 0, 0]);
  const previous = useRef({ portionIndex, dragOffset, isDragging, snapDirection });

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => animations.current.forEach((animation) => animation?.cancel());
    reducedMotion.addEventListener('change', stop);
    return () => {
      reducedMotion.removeEventListener('change', stop);
      stop();
    };
  }, []);

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { portionIndex, dragOffset, isDragging, snapDirection };
    if (!motionEnabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animations.current.forEach((animation) => animation?.cancel());
      return;
    }
    const period = variant === 'paper' ? 1800 : 240;
    // Keep the large paper tile centred inside its overscan, including reverse drags.
    const normalizeOffset = (offset: number) => variant === 'paper'
      ? tileOffset(offset + period / 2, period) + period / 2
      : tileOffset(offset, period);
    const depths = variant === 'paper' ? PAPER_DEPTHS : DEPTHS;
    const trail = variant === 'paper' ? PAPER_TRAIL : TRAIL;
    const trailDuration = variant === 'paper' ? PAPER_TRAIL_DURATION : TRAIL_DURATION;

    const settled = last.snapDirection !== null && snapDirection === null;
    const changed = portionIndex !== last.portionIndex && !paginationPending;
    const starting = (isDragging || snapDirection !== null) && !last.isDragging && last.snapDirection === null;
    const direction = settled
      ? last.snapDirection === 'forward' ? -1 : 1
      : changed ? Math.sign(last.portionIndex - portionIndex) : 0;

    Array.from(root.current?.children ?? []).forEach((child, index) => {
      const layer = child as HTMLElement;
      const measured = new DOMMatrixReadOnly(getComputedStyle(layer).transform).m42;
      const current = normalizeOffset(measured);
      bases.current[index] -= measured - current;
      if (starting || (changed && !settled)) bases.current[index] = normalizeOffset(current);
      if (settled) bases.current[index] += dragDistance(last.dragOffset) * depths[index];

      const targetDrag = dragDistance(dragOffset) * depths[index];
      let target = bases.current[index] + targetDrag;
      let duration = transitionEnabled ? (variant === 'paper' ? transitionDuration : 240) : 0;
      let easing = 'ease-out';
      if (settled || changed) {
        target = bases.current[index] + direction * trail[index];
        bases.current[index] = target;
        duration = trailDuration[index];
        easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
      } else if (!starting && !isDragging && !transitionEnabled) {
        return; // Keep the tail running after the text has settled.
      }

      animations.current[index]?.cancel();
      // Rebase by whole tiles so both directions stay covered indefinitely.
      layer.style.transform = `translateY(${target}px)`;
      animations.current[index] = duration ? layer.animate([
        { transform: `translateY(${current}px)` },
        { transform: `translateY(${target}px)` }
      ], { duration, easing }) : null;
    });
  }, [portionIndex, paginationPending, dragOffset, isDragging, snapDirection, transitionEnabled, variant, motionEnabled, transitionDuration]);

  if (variant === 'paper') return <div ref={root} className="reader-paper" aria-hidden="true">
    <div className="reader-paper-layer" />
  </div>;

  return <div ref={root} className="reader-dust" aria-hidden="true">
    <div className="reader-dust-layer reader-dust-far" />
    <div className="reader-dust-layer reader-dust-middle" />
    <div className="reader-dust-layer reader-dust-near" />
  </div>;
}
