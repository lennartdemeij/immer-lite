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
  it('lifts and tilts the centre of a line before its outside words, during drag and snap', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const current = document.createElement('div');
    current.className = 'portion-pane-current';
    current.innerHTML = '<span class="reader-word">left</span><span class="reader-word">middle</span><span class="reader-word">right</span>';
    const words = current.querySelectorAll<HTMLElement>('.reader-word');
    words.forEach((word, index) => vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(new DOMRect(100 + index * 260, 300, 80, 20)));
    const options = { style: 'vortex' as const, stage, forwardDistance: 600 };
    const drag = createWordDrag([current], options)!;
    now = 50;
    drag.update(-200);
    expect(drag.poseFor(words[1])!.y).toBeLessThan(drag.poseFor(words[0])!.y);
    expect(Math.abs(drag.poseFor(words[1])!.rotation)).toBeGreaterThan(Math.abs(drag.poseFor(words[0])!.rotation));
    drag.cancel();
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    animatePortionWords([current], -600, 480, null, options);
    expect((animate.mock.calls[1][1] as KeyframeAnimationOptions).delay).toBeLessThan((animate.mock.calls[0][1] as KeyframeAnimationOptions).delay!);
    const midY = (index: number) => Number(String((animate.mock.calls[index][0] as Keyframe[])[1].transform).match(/translate3d\([^,]+, ([\d.-]+)px/)![1]);
    expect(midY(1)).toBeLessThan(midY(0));
  });

  it('draws rotated words into the top centre and blows incoming words from the bottom centre', () => {
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const current = document.createElement('div');
    current.className = 'portion-pane-current';
    const next = document.createElement('div');
    next.className = 'portion-pane-next';
    current.innerHTML = '<span class="reader-word">out</span>';
    next.innerHTML = '<span class="reader-word">in</span>';
    vi.spyOn(current.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 300, 80, 20));
    vi.spyOn(next.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 900, 80, 20));
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    const motion = animatePortionWords([current, next], -600, 480, null, { style: 'vortex', stage })!;
    const outgoing = animate.mock.calls[0][0] as Keyframe[];
    const incoming = animate.mock.calls[1][0] as Keyframe[];
    expect(outgoing[outgoing.length - 1].transform).toBe('translate3d(260px, 358px, 0) rotate(-90deg) scale(0.2)');
    expect(incoming[0].transform).toBe('translate3d(-240px, 422px, 0) rotate(90deg) scale(0.2)');
    expect(incoming[incoming.length - 1].transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
    motion.cancel();
    expect((current.firstElementChild as HTMLElement).style.willChange).toBe('');
    animate.mockClear();
    animatePortionWords([current], 600, 480, null, { style: 'vortex', stage, direction: 'backward' });
    expect((animate.mock.calls[0][0] as Keyframe[])[2].transform).toBe('translate3d(260px, -178px, 0) rotate(90deg) scale(0.2)');
    current.innerHTML = '<span class="reader-word">word</span>'.repeat(80);
    expect(animatePortionWords([current], -600, 480)!.duration).toBe(720);
  });

  it('skips the hidden neighbour and avoids a second style update when a pointer frame is queued', () => {
    let now = 0;
    let pending = true;
    let nextFrame = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const panes = ['previous', 'current', 'next'].map((role) => {
      const pane = document.createElement('div');
      pane.className = `portion-pane-${role}`;
      pane.innerHTML = '<span class="reader-word">word</span>'.repeat(20);
      return pane;
    });
    const writes = vi.spyOn(CSSStyleDeclaration.prototype, 'transform', 'set');
    const drag = createWordDrag(panes, { isUpdatePending: () => pending })!;
    now = 20;
    drag.update(-60);
    expect(panes[0].querySelector<HTMLElement>('.reader-word')!.style.transform).toBe('');
    const count = writes.mock.calls.length;
    now = 32;
    const queued = Array.from(callbacks.values());
    callbacks.clear();
    queued.forEach((callback) => callback(now));
    expect(writes.mock.calls.length).toBe(count);
    pending = false;
    now = 40;
    const trailing = Array.from(callbacks.values());
    callbacks.clear();
    trailing.forEach((callback) => callback(now));
    expect(writes.mock.calls.length).toBeGreaterThan(count);
    drag.cancel();
    expect(callbacks.size).toBe(0);
    expect(panes.every((pane) => Array.from(pane.children).every((word) => (word as HTMLElement).style.willChange === ''))).toBe(true);
  });

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
    expect(animate.mock.calls[60][0]).toEqual([{ transform: 'translate3d(0px, 460px, 0)', offset: 0 }, { transform: 'translate3d(0px, 0px, 0)', offset: 1 }]);
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
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translate3d(0px, -500px, 0)', offset: 0 }, { transform: 'translate3d(0px, 0px, 0)', offset: 1 }]);
    const delays = animate.mock.calls.slice(0, 300).map((call) => (call[1] as KeyframeAnimationOptions).delay!);
    expect(delays[0]).toBe(0);
    expect(delays[299]).toBe(120);
    expect(delays.every((delay, i) => i === 0 || delay > delays[i - 1])).toBe(true);
    motion.cancel();
    expect(cancel).toHaveBeenCalledTimes(301);
    animate.mockClear();
    animatePortionWords([pane], -500, 240);
    expect(animate.mock.calls[0][0]).toEqual([{ transform: 'translate3d(0px, 500px, 0)', offset: 0 }, { transform: 'translate3d(0px, 0px, 0)', offset: 1 }]);
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
