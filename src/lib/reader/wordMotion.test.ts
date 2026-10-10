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
  it.each(['forward', 'backward'] as const)('swooshes words around a curved path outside the %s viewport and settles the new portion', direction => {
    const forward = direction === 'forward';
    const displacement = forward ? -600 : 600;
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const panes = ['current', forward ? 'next' : 'previous'].map((role, index) => {
      const pane = document.createElement('div');
      pane.className = `portion-pane-${role}`;
      pane.innerHTML = '<span class="reader-word">wind</span>';
      vi.spyOn(pane.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 300 - index * displacement, 80, 20));
      return pane;
    });
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    const motion = animatePortionWords(panes, displacement, 480, null, { style: 'wind', stage, direction })!;
    const outgoing = animate.mock.calls[0][0] as Keyframe[];
    const incoming = animate.mock.calls[1][0] as Keyframe[];
    const position = (frame: Keyframe) => String(frame.transform).match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
    const outY = 310 + displacement + Number(position(outgoing.at(-1)!)[2]);
    const inY = 310 + Number(position(incoming[0])[2]);
    expect(forward ? outY < 0 : outY > window.innerHeight).toBe(true);
    expect(forward ? inY > window.innerHeight : inY < 0).toBe(true);
    expect(incoming.at(-1)!.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
    // A straight funnel would keep every intermediate x between its endpoints.
    const xs = outgoing.map(frame => Number(position(frame)[1]));
    expect(xs.some(x => x > Math.max(xs[0], xs.at(-1)!))).toBe(true);
    expect(outgoing.every(frame => frame.opacity === undefined)).toBe(true);
    expect(motion.duration).toBe(720);
    motion.cancel();
    expect((panes[0].firstElementChild as HTMLElement).style.willChange).toBe('');
  });

  it('continues the wind path from the displayed drag pose and restores a cancelled gesture', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const current = document.createElement('div');
    current.className = 'portion-pane-current';
    current.innerHTML = '<span class="reader-word">wind</span>';
    const word = current.firstElementChild as HTMLElement;
    vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 300, 80, 20));
    const options = { style: 'wind' as const, stage, forwardDistance: 600 };
    const drag = createWordDrag([current], options)!;
    now = 50;
    drag.update(-180);
    const pose = { ...drag.poseFor(word)! };
    expect(pose.x).not.toBe(0);
    expect(pose.rotation).not.toBe(0);
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    drag.cancel();
    const motion = animatePortionWords([current], -420, 480, drag, options)!;
    const round = (value: number) => Math.round(value * 100) / 100;
    const frames = animate.mock.calls[0][0] as Keyframe[];
    expect(frames[0].transform).toContain(`translate3d(${round(pose.x)}px, ${round(pose.y + 420)}px`);
    motion.cancel();
    animate.mockClear();
    animatePortionWords([current], 180, 480, drag, { ...options, rest: true });
    expect((animate.mock.calls[0][0] as Keyframe[]).at(-1)!.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
    expect(word.style.transform).toBe('');
  });

  it.each(['forward', 'backward'] as const)('grows the %s portion from the same interaction point at a slower pace', (direction) => {
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const forward = direction === 'forward';
    const neighbor = document.createElement('div');
    neighbor.className = forward ? 'portion-pane-next' : 'portion-pane-previous';
    neighbor.innerHTML = '<span class="reader-word">first</span><span class="reader-word">second</span>';
    const displacement = forward ? -600 : 600;
    const origin = { x: 250, y: 430 };
    const rects = [new DOMRect(100, forward ? 900 : -300, 80, 20), new DOMRect(500, forward ? 1100 : -100, 100, 20)];
    Array.from(neighbor.children).forEach((word, index) => vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(rects[index]));
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    animatePortionWords([neighbor], displacement, 480, null, { style: 'explosion', stage, origin, direction });
    animate.mock.calls.forEach(([rawFrames, rawTiming], index) => {
      const frames = rawFrames as Keyframe[];
      const start = String(frames[0].transform);
      const translation = start.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
      const rect = rects[index];
      expect(rect.left + rect.width / 2 + Number(translation[1])).toBe(origin.x);
      expect(rect.top + rect.height / 2 + displacement + Number(translation[2])).toBe(origin.y);
      expect(Number(start.match(/scale\(([\d.]+)\)/)![1])).toBeLessThan(0.1);
      expect((rawTiming as KeyframeAnimationOptions).duration).toBeGreaterThanOrEqual(960);
      expect(frames.at(-1)!.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
    });
  });

  it('keeps the incoming words at the touch point before they grow during a drag', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const neighbor = document.createElement('div');
    neighbor.className = 'portion-pane-next';
    neighbor.innerHTML = '<span class="reader-word">word</span>';
    const word = neighbor.firstElementChild as HTMLElement;
    vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 900, 80, 20));
    const drag = createWordDrag([neighbor], { style: 'explosion', stage, origin: { x: 250, y: 430 }, forwardDistance: 600 })!;
    now = 50;
    drag.update(-1);
    const start = drag.poseFor(word)!;
    expect(140 + start.x).toBeCloseTo(250, 0);
    expect(910 - 1 + start.y).toBeCloseTo(430, 0);
    expect(start.scale).toBeLessThan(0.1);
    drag.cancel();
  });

  it('explodes away from the touch point, including the word directly under it', () => {
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const current = document.createElement('div');
    current.className = 'portion-pane-current';
    current.innerHTML = '<span class="reader-word">left</span><span class="reader-word">touch</span><span class="reader-word">right</span>';
    current.querySelectorAll<HTMLElement>('.reader-word').forEach((word, index) => {
      vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(new DOMRect(100 + index * 200, 300, 80, 20));
    });
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    const options = { style: 'explosion' as const, stage, origin: { x: 340, y: 310 } };
    const translation = (index: number) => {
      const frames = animate.mock.calls[index][0] as Keyframe[];
      return String(frames[frames.length - 1].transform).match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
    };
    animatePortionWords([current], -600, 480, null, options);
    expect(Number(translation(0)[1])).toBeLessThan(-800);
    expect(Number(translation(2)[1])).toBeGreaterThan(800);
    expect(animate.mock.calls.every(([frames]) => !JSON.stringify(frames).match(/NaN|Infinity/))).toBe(true);
    expect((animate.mock.calls[1][1] as KeyframeAnimationOptions).delay).toBe(0);
    // Moving the touch point across the same words reverses their radial path.
    animate.mockClear();
    animatePortionWords([current], -600, 480, null, { ...options, origin: { x: 40, y: 200 } });
    expect(Number(translation(0)[1])).toBeGreaterThan(0);
    expect(Number(translation(0)[2]) - 600).toBeGreaterThan(0);
  });

  it('keeps the explosion continuous from drag into snap, and restores cancelled drags', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const stage = document.createElement('main');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const panes = ['current', 'next'].map((role, index) => {
      const pane = document.createElement('div');
      pane.className = `portion-pane-${role}`;
      pane.innerHTML = '<span class="reader-word">word</span>';
      vi.spyOn(pane.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 300 + index * 600, 80, 20));
      return pane;
    });
    const options = { style: 'explosion' as const, stage, origin: { x: 400, y: 400 }, forwardDistance: 600 };
    const drag = createWordDrag(panes, options)!;
    now = 50;
    drag.update(-160);
    const word = panes[0].firstElementChild as HTMLElement;
    const pose = { ...drag.poseFor(word)! };
    expect(pose.x).toBeLessThan(0);
    expect(pose.y - 160).toBeLessThan(0);
    expect(pose.rotation).not.toBe(0);
    drag.cancel();
    const animate = vi.spyOn(HTMLElement.prototype, 'animate').mockReturnValue({ cancel: vi.fn() } as unknown as Animation);
    const motion = animatePortionWords(panes, -440, 480, drag, options)!;
    const frames = animate.mock.calls[0][0] as Keyframe[];
    const round = (value: number) => Math.round(value * 100) / 100;
    expect(frames[0].transform).toContain(`translate3d(${round(pose.x)}px, ${round(pose.y + 440)}px`);
    expect((animate.mock.calls[1][0] as Keyframe[]).at(-1)!.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
    motion.cancel();
    expect(word.style.transform).toBe('');
    expect(word.style.willChange).toBe('');
    animate.mockClear();
    animatePortionWords([panes[0]], 160, 480, drag, { ...options, rest: true });
    expect((animate.mock.calls[0][0] as Keyframe[]).at(-1)!.transform).toBe('translate3d(0px, 0px, 0) rotate(0deg) scale(1)');
  });

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
