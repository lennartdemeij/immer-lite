import { useEffect, useRef } from 'react';

export function ReaderBackground({ portionIndex, paginationPending }: {
  portionIndex: number;
  paginationPending: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const previousPortion = useRef(portionIndex);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => animations.current.forEach((animation) => animation.pause());
    animations.current = Array.from(root.current?.children ?? [], (layer, index) => {
      // The repeated tile makes each loop seamless. No animation runs while reading.
      const animation = layer.animate([
        { transform: 'translateY(0)' },
        { transform: 'translateY(-240px)' }
      ], { duration: [30000, 18000, 12000][index], iterations: Infinity });
      animation.pause();
      return animation;
    });
    reducedMotion.addEventListener('change', stop);
    return () => {
      reducedMotion.removeEventListener('change', stop);
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
    };
  }, []);

  useEffect(() => {
    const advancing = portionIndex > previousPortion.current;
    previousPortion.current = portionIndex;
    if (!advancing || paginationPending || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animations.current.forEach((animation) => animation.play());
    const timer = window.setTimeout(() => animations.current.forEach((animation) => animation.pause()), 2400);
    return () => {
      window.clearTimeout(timer);
      animations.current.forEach((animation) => animation.pause());
    };
  }, [portionIndex, paginationPending]);

  return <div ref={root} className="reader-dust" aria-hidden="true">
    <div className="reader-dust-layer reader-dust-far" />
    <div className="reader-dust-layer reader-dust-middle" />
    <div className="reader-dust-layer reader-dust-near" />
  </div>;
}
