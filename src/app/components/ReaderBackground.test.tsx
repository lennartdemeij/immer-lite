import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReaderBackground } from './ReaderBackground';

const animateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const animate = vi.fn(() => ({ cancel: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m42: number;
    constructor(transform: string) { this.m42 = Number(transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0); }
  });
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  animate.mockClear();
});

afterEach(() => {
  if (animateDescriptor) Object.defineProperty(HTMLElement.prototype, 'animate', animateDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  vi.unstubAllGlobals();
});

describe('paper parallax', () => {
  it('follows the drag, trails the page turn and reverses without exposing an edge', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = (portionIndex: number, dragOffset: number, isDragging: boolean, snapDirection: 'forward' | 'backward' | null) => {
      act(() => root.render(<ReaderBackground variant="paper" portionIndex={portionIndex}
        dragOffset={dragOffset} isDragging={isDragging} snapDirection={snapDirection}
        transitionEnabled={snapDirection !== null} transitionDuration={960} paginationPending={false} />));
      return container.querySelector<HTMLElement>('.reader-paper-layer')!.style.transform;
    };
    render(0, 0, false, null);
    expect(render(0, -100, true, null)).toBe('translateY(-4.5px)');
    expect(render(0, -600, false, 'forward')).toBe('translateY(-27px)');
    expect(animate.mock.calls.at(-1)).toEqual(expect.arrayContaining([expect.objectContaining({ duration: 960 })]));
    expect(render(1, 0, false, null)).toBe('translateY(-37px)');
    expect(animate.mock.calls.at(-1)).toEqual(expect.arrayContaining([expect.objectContaining({ duration: 1700 })]));
    render(1, 100, true, null);
    render(1, 600, false, 'backward');
    expect(render(0, 0, false, null)).toBe('translateY(0px)');
    act(() => root.unmount());
    container.remove();
  });

  it('keeps the paper visible with background animation disabled', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(<ReaderBackground variant="paper" motionEnabled={false} portionIndex={0}
      dragOffset={-300} isDragging snapDirection={null} transitionEnabled={false} paginationPending={false} />));
    expect(container.querySelector('.reader-paper-layer')).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
    act(() => root.unmount());
    container.remove();
  });
});
