export interface WordMotion {
  duration: number;
  cancel: () => void;
}

export interface WordDrag {
  update: (offset: number) => void;
  offsetFor: (word: HTMLElement) => number;
  cancel: () => void;
}

// Keep a short pointer history so later words follow the same path slightly later.
// No text measurements or React renders are needed for the trailing frames.
export function createWordDrag(panes: HTMLElement[]): WordDrag | null {
  const entries = panes.flatMap((pane) => {
    const words = Array.from(pane.querySelectorAll<HTMLElement>('.reader-word'));
    const stagger = Math.min(120, Math.max(0, words.length - 1) * 2);
    return words.map((word, index) => ({ word, original: word.style.transform,
      delay: words.length > 1 ? index / (words.length - 1) * stagger : 0 }));
  });
  if (!entries.length) return null;
  const maxDelay = Math.max(...entries.map((entry) => entry.delay));
  const history = [{ at: performance.now(), offset: 0 }];
  const offsets = new Map<HTMLElement, number>();
  let currentOffset = 0;
  let frame: number | null = null;

  function render(now: number) {
    while (history.length > 1 && history[1].at <= now - maxDelay) history.shift();
    entries.forEach(({ word, delay }) => {
      const at = now - delay;
      let offset = history[0].offset;
      for (let index = 1; index < history.length; index += 1) {
        const next = history[index];
        const previous = history[index - 1];
        if (next.at > at) {
          const progress = Math.max(0, (at - previous.at) / (next.at - previous.at));
          offset = previous.offset + (next.offset - previous.offset) * progress;
          break;
        }
        offset = next.offset;
      }
      const translation = offset - currentOffset;
      offsets.set(word, translation);
      word.style.transform = `translateY(${translation}px)`;
    });
    if (now < history[history.length - 1].at + maxDelay) {
      frame = requestAnimationFrame((time) => { frame = null; render(time); });
    }
  }

  return {
    update(offset) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      const at = performance.now();
      // A stationary pointer must stay stationary in the history, rather than
      // interpolating a new movement across the entire pause between events.
      if (at - history[history.length - 1].at > 16) history.push({ at: at - 16, offset: currentOffset });
      currentOffset = offset;
      if (history[history.length - 1].at === at) history[history.length - 1].offset = offset;
      else history.push({ at, offset });
      render(at);
    },
    offsetFor: (word) => offsets.get(word) ?? 0,
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      entries.forEach(({ word, original }) => { word.style.transform = original; });
    }
  };
}

// Only the visible portion and its neighbour participate; pagination stays untouched.
export function animatePortionWords(
  panes: HTMLElement[], displacement: number, duration: number, drag?: WordDrag | null
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
        animations.push(word.animate([
          { transform: `translateY(${-displacement + (drag?.offsetFor(word) ?? 0)}px)` }, frames[1]
        ], {
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
