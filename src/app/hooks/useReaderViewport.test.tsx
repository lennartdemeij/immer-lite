import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderViewport } from './useReaderViewport';

let container: HTMLDivElement;
let root: Root;
let resize: ResizeObserverCallback;

function Probe({ composing = true }: { composing?: boolean }) {
  const { containerRef, viewport } = useReaderViewport(28);
  return createElement('div', { ref: containerRef },
    createElement('output', null, JSON.stringify(viewport)),
    composing ? createElement('textarea') : null);
}

function measure(width: number, height: number) {
  act(() => resize([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver));
}

function metrics() {
  return JSON.parse(container.querySelector('output')!.textContent!);
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Probe)));
  measure(390, 844);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('reader pagination viewport', () => {
  it('keeps the same portion layout while composing and saving a note as the keyboard animates', () => {
    const before = metrics();
    act(() => container.querySelector('textarea')!.focus());
    measure(390, 780);
    measure(390, 500);
    expect(metrics()).toEqual(before);
    // Saving removes the focused editor before the keyboard finishes closing.
    act(() => root.render(createElement(Probe, { composing: false })));
    measure(390, 610);
    expect(metrics()).toEqual(before);
    measure(390, 844);
    expect(metrics()).toEqual(before);
    measure(390, 900);
    expect(metrics().height).toBe(900);
  });

  it('still repaginates on rotation and ordinary resizing', () => {
    act(() => container.querySelector('textarea')!.focus());
    measure(390, 500);
    measure(844, 390);
    expect(metrics().width).toBe(844);
    expect(metrics().height).toBe(390);
    act(() => container.querySelector('textarea')!.blur());
    measure(844, 360);
    expect(metrics().height).toBe(360);
  });

  it('allows desktop window resizing while a note field is focused', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    act(() => container.querySelector('textarea')!.focus());
    measure(390, 500);
    expect(metrics().height).toBe(500);
  });
});
