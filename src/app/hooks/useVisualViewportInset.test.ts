import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisualViewportInset } from './useVisualViewportInset';

let container: HTMLDivElement;
let root: Root;
let viewport: EventTarget & { height: number; offsetTop: number };

function InsetProbe() {
  return createElement('output', null, useVisualViewportInset());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('innerHeight', 844);
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  vi.stubGlobal('visualViewport', viewport);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('useVisualViewportInset', () => {
  it('follows keyboard opening, automatic viewport panning and closing', () => {
    act(() => root.render(createElement(InsetProbe)));
    expect(container.textContent).toBe('0');
    act(() => {
      viewport.height = 500;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(container.textContent).toBe('344');
    act(() => {
      viewport.offsetTop = 60;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(container.textContent).toBe('284');
    act(() => {
      viewport.height = 844;
      viewport.offsetTop = 0;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(container.textContent).toBe('0');
  });

  it('does not double-count a keyboard when the layout viewport also shrinks', () => {
    act(() => root.render(createElement(InsetProbe)));
    act(() => {
      vi.stubGlobal('innerHeight', 500);
      viewport.height = 500;
      window.dispatchEvent(new Event('resize'));
    });
    expect(container.textContent).toBe('0');
  });

  it('works without the VisualViewport API', () => {
    vi.stubGlobal('visualViewport', undefined);
    act(() => root.render(createElement(InsetProbe)));
    expect(container.textContent).toBe('0');
  });
});
