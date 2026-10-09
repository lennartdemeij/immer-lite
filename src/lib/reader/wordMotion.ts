export interface WordMotion {
  duration: number;
  cancel: () => void;
}

// Only the visible portion and its neighbour participate; pagination stays untouched.
export function animatePortionWords(
  panes: HTMLElement[], displacement: number, duration: number
): WordMotion | null {
  const words = panes.map((pane) => Array.from(pane.querySelectorAll<HTMLElement>('.reader-word')));
  if (!words.some((group) => group.length) || typeof HTMLElement.prototype.animate !== 'function') return null;

  const stagger = Math.min(120, Math.max(...words.map((group) => Math.max(0, group.length - 1))) * 2);
  const animations: Animation[] = [];
  const frames = [{ transform: `translateY(${-displacement}px)` }, { transform: 'translateY(0)' }];
  try {
    panes.forEach((pane, paneIndex) => {
      const group = words[paneIndex];
      group.forEach((word, index) => {
        animations.push(word.animate(frames, {
          duration, delay: group.length > 1 ? index / (group.length - 1) * stagger : 0,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards'
        }));
      });
      pane.querySelectorAll<HTMLElement>('.image-block, .list-label, .scene-break, .annotation-live-overlay')
        .forEach((element) => animations.push(element.animate(frames, {
          duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards'
        })));
    });
  } catch {
    animations.forEach((animation) => animation.cancel());
    return null;
  }
  return { duration: duration + stagger, cancel: () => animations.forEach((animation) => animation.cancel()) };
}
