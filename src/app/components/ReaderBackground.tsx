import { useLayoutEffect, useRef } from 'react';

const DEPTHS = [0.025, 0.065, 0.14];
const TRAIL = [8, 22, 48];
const TRAIL_DURATION = [1400, 1700, 2000];
const tileOffset = (offset: number) => ((offset % 240) + 240) % 240 - 240;
const dragDistance = (offset: number) => Math.max(-2000, Math.min(2000, offset));

export function ReaderBackground({ portionIndex, paginationPending, dragOffset, isDragging, snapDirection, transitionEnabled }: {
  portionIndex: number;
  paginationPending: boolean;
  dragOffset: number;
  isDragging: boolean;
  snapDirection: 'forward' | 'backward' | null;
  transitionEnabled: boolean;
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const settled = last.snapDirection !== null && snapDirection === null;
    const changed = portionIndex !== last.portionIndex && !paginationPending;
    const starting = (isDragging || snapDirection !== null) && !last.isDragging && last.snapDirection === null;
    const direction = settled
      ? last.snapDirection === 'forward' ? -1 : 1
      : changed ? Math.sign(last.portionIndex - portionIndex) : 0;

    Array.from(root.current?.children ?? []).forEach((child, index) => {
      const layer = child as HTMLElement;
      const measured = new DOMMatrixReadOnly(getComputedStyle(layer).transform).m42;
      const current = tileOffset(measured);
      bases.current[index] -= measured - current;
      if (starting || (changed && !settled)) bases.current[index] = tileOffset(current);
      if (settled) bases.current[index] += dragDistance(last.dragOffset) * DEPTHS[index];

      const targetDrag = dragDistance(dragOffset) * DEPTHS[index];
      let target = bases.current[index] + targetDrag;
      let duration = transitionEnabled ? 240 : 0;
      let easing = 'ease-out';
      if (settled || changed) {
        target = bases.current[index] + direction * TRAIL[index];
        bases.current[index] = target;
        duration = TRAIL_DURATION[index];
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
  }, [portionIndex, paginationPending, dragOffset, isDragging, snapDirection, transitionEnabled]);

  return <div ref={root} className="reader-dust" aria-hidden="true">
    <div className="reader-dust-layer reader-dust-far" />
    <div className="reader-dust-layer reader-dust-middle" />
    <div className="reader-dust-layer reader-dust-near" />
  </div>;
}
