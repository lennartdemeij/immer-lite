import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animatePortionWords, createWordDrag } from './wordMotion';

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('portion word motion', () => {
  it('trails the pointer per word, carries the displayed positions into the snap, and cleans up', () => {
    let now = 0;
    let nextFrame = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const pane = document.createElement('div');
    pane.innerHTML = '<span class="reader-word">word</span>'.repeat(61);
    const words = pane.querySelectorAll<HTMLElement>('.reader-word');
    const drag = createWordDrag([pane])!;
    now = 20;
    drag.update(-60);
    expect(drag.offsetFor(words[0])).toBe(0);
    expect(drag.offsetFor(words[60])).toBe(60);
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    animatePortionWords([pane], -400, 240, drag);
    expect(animate.mock.calls[60][0]).toEqual([{ transform: 'translateY(460px)' }, { transform: 'translateY(0)' }]);
    now = 140;
    const pending = Array.from(callbacks.values());
    callbacks.clear();
    pending.forEach((callback) => callback(now));
    expect(drag.offsetFor(words[60])).toBe(0);
    expect(callbacks.size).toBe(0);
    now = 160;
    drag.update(40);
    expect(drag.offsetFor(words[60])).toBe(-100);
    drag.cancel();
    expect(callbacks.size).toBe(0);
    expect(Array.from(words).every((word) => word.style.transform === '')).toBe(true);
  });

  it('bounds the stagger for long portions, reverses travel, and cancels all animations', () => {
    const cancel = vi.fn();
    const animate = vi.fn<HTMLElement['animate']>(() => ({ cancel } as unknown as Animation));
    vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(animate);
    const pane = document.createElement('div');
    pane.innerHTML = '<span class="reader-word">word</span>'.repeat(300) + '<figure class="image-block"></figure>';
    const motion = animatePortionWords([pane], 500, 240)!;
    expect(motion.duration).toBe(360);
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translateY(-500px)' }, { transform: 'translateY(0)' }]);
    const delays = animate.mock.calls.slice(0, 300).map((call) => (call[1] as KeyframeAnimationOptions).delay!);
    expect(delays[0]).toBe(0);
    expect(delays[299]).toBe(120);
    expect(delays.every((delay, i) => i === 0 || delay > delays[i - 1])).toBe(true);
    motion.cancel();
    expect(cancel).toHaveBeenCalledTimes(301);
    animate.mockClear();
    animatePortionWords([pane], -500, 240);
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translateY(500px)' }, { transform: 'translateY(0)' }]);
  });

  it('falls back for image-only portions and rolls back partial animation failures', () => {
    const cancel = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'animate')
      .mockReturnValueOnce({ cancel } as unknown as Animation)
      .mockImplementationOnce(() => { throw new Error('unavailable'); });
    const pane = document.createElement('div');
    pane.innerHTML = '<figure class="image-block"></figure>';
    expect(animatePortionWords([pane], 100, 240)).toBeNull();
    pane.innerHTML += '<span class="reader-word">first</span><span class="reader-word">second</span>';
    expect(animatePortionWords([pane], 100, 240)).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
