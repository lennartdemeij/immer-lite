import { useEffect, useState } from 'react';

function getBottomInset(): number {
  const viewport = window.visualViewport;
  return viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
}

/** Keep fixed annotation controls above the keyboard, including viewport panning. */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(getBottomInset);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setInset(getBottomInset());
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return inset;
}
