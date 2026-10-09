export interface WordMotion {
  duration: number;
  cancel: () => void;
}

interface WordPose { x: number; y: number; rotation: number; scale: number }
interface WordGeometry { x: number; y: number; spin: number; priority: number; burst?: WordPose }
interface MotionOptions {
  style?: 'cascade' | 'vortex' | 'explosion';
  stage?: HTMLElement;
  origin?: { x: number; y: number };
  forwardDistance?: number;
  backwardDistance?: number;
  rest?: boolean;
  direction?: 'forward' | 'backward';
  isUpdatePending?: () => boolean;
}
const identity: WordPose = { x: 0, y: 0, rotation: 0, scale: 1 };
const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;
const rounded = (value: number) => Math.round(value * 100) / 100;
function transform(pose: WordPose, full = false) {
  const translation = `translate3d(${rounded(pose.x)}px, ${rounded(pose.y)}px, 0)`;
  return full ? `${translation} rotate(${rounded(pose.rotation)}deg) scale(${rounded(pose.scale)})` : translation;
}
function geometry(word: HTMLElement, index: number, bounds: DOMRect, origin?: MotionOptions['origin'], restingOffset = 0): WordGeometry {
  const rect = word.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const center = bounds.left + bounds.width / 2;
  const y = rect.top + rect.height / 2;
  const result: WordGeometry = { x, y,
    spin: x === center ? index % 2 ? 90 : -90 : x < center ? -90 : 90,
    priority: origin ? Math.min(1, Math.hypot(x - origin.x, y + restingOffset - origin.y) / Math.max(1, Math.hypot(bounds.width, bounds.height)))
      : Math.min(1, Math.abs(x - center) / Math.max(1, Math.min(700, bounds.width) / 2)) };
  if (origin) result.burst = explosion(result, bounds, origin, restingOffset);
  return result;
}
function role(pane: HTMLElement) {
  return pane.classList.contains('portion-pane-next') ? 'next'
    : pane.classList.contains('portion-pane-previous') ? 'previous' : 'current';
}

function explosion(g: WordGeometry, bounds: DOMRect, origin: NonNullable<MotionOptions['origin']>, restingOffset = 0): WordPose {
  const dx = g.x - origin.x;
  const dy = g.y + restingOffset - origin.y;
  const length = Math.hypot(dx, dy);
  // Even a word directly under the finger needs a finite direction of travel.
  const nx = length > 1 ? dx / length : Math.sin(g.x + g.y);
  const ny = length > 1 ? dy / length : Math.cos(g.x + g.y);
  const travel = Math.hypot(bounds.width, bounds.height) * 1.15;
  return { x: nx * travel, y: ny * travel,
    rotation: (nx < 0 ? -1 : 1) * (65 + Math.abs(ny) * 95), scale: 0.75 };
}

export interface WordDrag {
  update: (offset: number) => void;
  offsetFor: (word: HTMLElement) => number;
  cancel: () => void;
  poseFor: (word: HTMLElement) => WordPose | undefined;
  geometryFor: (word: HTMLElement) => WordGeometry | undefined;
  currentOffset: () => number;
}

// Keep a short pointer history so later words follow the same path slightly later.
// No text measurements or React renders are needed for the trailing frames.
export function createWordDrag(panes: HTMLElement[], options: MotionOptions = {}): WordDrag | null {
  const bounds = options.style && options.style !== 'cascade' ? options.stage?.getBoundingClientRect() : undefined;
  const origin = bounds && options.style === 'explosion'
    ? options.origin ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : undefined;
  // Batch geometry reads before touching any styles; reuse them when releasing.
  const groups = panes.map((pane) => {
    const words = Array.from(pane.querySelectorAll<HTMLElement>('.reader-word'));
    const stagger = Math.min(120, Math.max(0, words.length - 1) * 2);
    const entries = words.map((word, index) => ({ word, original: word.style.transform,
      originalHint: word.style.willChange, lastTransform: '', promoted: false,
      pose: { ...identity },
      geometry: bounds ? geometry(word, index, bounds, origin,
        role(pane) === 'next' ? -(options.forwardDistance || bounds.height)
          : role(pane) === 'previous' ? options.backwardDistance || bounds.height : 0) : undefined,
      delay: words.length > 1 ? index / (words.length - 1) * stagger : 0 }));
    if (bounds) {
      entries.forEach((entry) => { entry.delay = entry.geometry!.priority * stagger; });
      entries.sort((left, right) => left.delay - right.delay);
    }
    return { role: role(pane), entries };
  });
  const entries = groups.flatMap((group) => group.entries);
  if (!entries.length) return null;
  const maxDelay = Math.max(...entries.map((entry) => entry.delay));
  const history = [{ at: performance.now(), offset: 0 }];
  const poses = new Map<HTMLElement, WordPose>();
  const geometries = new Map(entries.map((entry) => [entry.word, entry.geometry]));
  let currentOffset = 0;
  let frame: number | null = null;

  function render(now: number) {
    while (history.length > 1 && history[1].at <= now - maxDelay) history.shift();
    groups.forEach((group) => {
      if (group.role === 'next' && currentOffset >= 0 || group.role === 'previous' && currentOffset <= 0) return;
      let cursor = history.length - 1;
      group.entries.forEach((entry) => {
        const { word, delay } = entry;
        const at = now - delay;
        while (cursor > 0 && history[cursor].at > at) cursor -= 1;
        const previous = history[cursor];
        const next = history[cursor + 1];
        const offset = next ? mix(previous.offset, next.offset, Math.max(0, Math.min(1, (at - previous.at) / (next.at - previous.at)))) : previous.offset;
        const pose = entry.pose;
        pose.x = pose.rotation = 0;
        pose.scale = 1;
        pose.y = offset - currentOffset;
        if (bounds && entry.geometry) {
          const forward = currentOffset < 0;
          const distance = (forward ? options.forwardDistance : options.backwardDistance) || bounds.height;
          const globalProgress = Math.min(1, Math.max(0, (forward ? -offset : offset) / distance));
          const priorityDelay = entry.geometry.priority * (origin ? 0.25 : 0.6);
          const progress = Math.max(0, (globalProgress - priorityDelay) / (1 - priorityDelay));
          const lift = progress * (2 - progress);
          const center = bounds.left + bounds.width / 2;
          const portal = group.role === 'current'
            ? forward ? bounds.top - 32 : bounds.bottom + 32
            : forward ? bounds.bottom + 32 : bounds.top - 32;
          const g = entry.geometry;
          const amount = group.role === 'current' ? progress : 1 - progress;
          pose.x = (center - g.x) * amount;
          pose.y = group.role === 'current' ? mix(g.y, portal, lift) - g.y - currentOffset
            : mix(portal, g.y + (forward ? -distance : distance), lift) - g.y - currentOffset;
          pose.rotation = g.spin * (group.role === 'current' ? lift : 1 - lift) * (forward ? 1 : -1);
          pose.scale = 1 - amount * 0.8;
          if (origin) {
            const restingOffset = group.role === 'current' ? 0 : forward ? -distance : distance;
            const burst = g.burst!;
            const spread = group.role === 'current' ? lift : 1 - lift;
            pose.x = burst.x * spread;
            pose.y = restingOffset + burst.y * spread - currentOffset;
            pose.rotation = burst.rotation * spread;
            pose.scale = mix(1, burst.scale, spread);
          }
        }
        poses.set(word, pose);
        if (!entry.promoted) { word.style.willChange = 'transform'; entry.promoted = true; }
        const value = transform(pose, Boolean(bounds));
        if (value !== entry.lastTransform) { word.style.transform = value; entry.lastTransform = value; }
      });
    });
    if (now < history[history.length - 1].at + maxDelay) {
      scheduleTail();
    }
  }

  function scheduleTail() {
    frame = requestAnimationFrame((time) => {
      frame = null;
      // The reader already has an update queued for this frame. Let it render
      // once, instead of rewriting every word before and after the React commit.
      if (options.isUpdatePending?.()) scheduleTail();
      else render(time);
    });
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
    offsetFor: (word) => poses.get(word)?.y ?? 0,
    poseFor: (word) => poses.get(word),
    geometryFor: (word) => geometries.get(word),
    currentOffset: () => currentOffset,
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      entries.forEach(({ word, original, originalHint }) => {
        word.style.transform = original;
        word.style.willChange = originalHint;
      });
    }
  };
}

// Only the visible portion and its neighbour participate; pagination stays untouched.
export function animatePortionWords(
  panes: HTMLElement[], displacement: number, duration: number, drag?: WordDrag | null, options: MotionOptions = {}
): WordMotion | null {
  const words = panes.map((pane) => Array.from(pane.querySelectorAll<HTMLElement>('.reader-word')));
  if (!words.some((group) => group.length) || typeof HTMLElement.prototype.animate !== 'function') return null;

  const stagger = Math.min(duration / 2, Math.max(...words.map((group) => Math.max(0, group.length - 1))) * duration / 120);
  const animations: Animation[] = [];
  const hints = new Map<HTMLElement, string>();
  const frames = [{ transform: transform({ ...identity, y: -displacement }) }, { transform: transform(identity) }];
  const bounds = options.style && options.style !== 'cascade' ? options.stage?.getBoundingClientRect() : undefined;
  const origin = bounds && options.style === 'explosion'
    ? options.origin ?? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : undefined;
  const totalOffset = displacement + (drag?.currentOffset() ?? 0);
  const geometries = bounds ? words.map((group, paneIndex) => group.map((word, index) => drag?.geometryFor(word)
    ?? geometry(word, index, bounds, origin, role(panes[paneIndex]) === 'current' ? 0 : totalOffset))) : [];
  const cancel = () => {
    animations.forEach((animation) => animation.cancel());
    hints.forEach((hint, word) => { word.style.willChange = hint; });
  };
  try {
    panes.forEach((pane, paneIndex) => {
      const group = words[paneIndex];
      group.forEach((word, index) => {
        const dragPose = drag?.poseFor(word);
        const pose = dragPose ?? identity;
        let start = { ...pose, y: pose.y - displacement };
        let end = identity;
        if (bounds && !options.rest) {
          const g = geometries[paneIndex][index];
          const forward = options.direction ? options.direction === 'forward' : displacement < 0;
          const portal = role(pane) === 'current'
            ? forward ? bounds.top - 32 : bounds.bottom + 32
            : forward ? bounds.bottom + 32 : bounds.top - 32;
          const funnel: WordPose = { x: bounds.left + bounds.width / 2 - g.x,
            y: portal - g.y - displacement - (drag?.currentOffset() ?? 0),
            rotation: g.spin * (forward ? 1 : -1), scale: 0.2 };
          if (role(pane) === 'current') end = funnel;
          else if (!dragPose) start = funnel;
          if (origin) {
            const outgoing = role(pane) === 'current';
            const burst = g.burst!;
            if (outgoing) end = { ...burst, y: burst.y - totalOffset };
            else if (!dragPose) start = burst;
          }
        }
        hints.set(word, word.style.willChange);
        word.style.willChange = 'transform';
        const keyframes: Keyframe[] = [{ transform: transform(start, Boolean(bounds)), offset: 0 }];
        if (bounds && !origin && !options.rest) {
          const lift = 0.85 - geometries[paneIndex][index].priority * 0.55;
          keyframes.push({ offset: 0.5, transform: transform({
            x: mix(start.x, end.x, 0.55), y: mix(start.y, end.y, lift),
            rotation: mix(start.rotation, end.rotation, lift), scale: mix(start.scale, end.scale, 0.5)
          }, true) });
        }
        keyframes.push({ transform: transform(end, Boolean(bounds)), offset: 1 });
        animations.push(word.animate(keyframes, {
          duration, delay: bounds ? geometries[paneIndex][index].priority * stagger
            : group.length > 1 ? index / (group.length - 1) * stagger : 0,
          easing: bounds && !origin ? 'cubic-bezier(0.4, 0, 0.2, 1)' : 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both'
        }));
      });
      pane.querySelectorAll<HTMLElement>('.image-block, .list-label, .scene-break, .annotation-live-overlay')
        .forEach((element) => animations.push(element.animate(frames, {
          duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards'
        })));
    });
  } catch {
    cancel();
    return null;
  }
  return { duration: duration + stagger, cancel };
}
