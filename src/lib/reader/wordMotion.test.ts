import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animatePortionWords } from './wordMotion';

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: vi.fn() }));
afterEach(() => {
  vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

describe('portion word motion', () => {
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
