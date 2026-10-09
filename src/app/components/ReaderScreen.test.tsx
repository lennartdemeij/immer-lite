import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBook } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';
import { ReaderScreen } from './ReaderScreen';

vi.mock('../hooks/useReadAloud', () => ({
  useReadAloud: () => ({ isPlaying: false, supported: false, status: 'idle', toggle: vi.fn() })
}));

const book: CanonicalBook = {
  id: 'book', fingerprint: 'book', metadata: { title: 'Test book' }, sections: [], toc: [], resources: {},
  totalBlocks: 0, totalSentences: 0, parseStats: { confidence: 1, diagnostics: [], parsedAt: '', durationMs: 0 }
};
const anchor = { blockId: 'paragraph', blockOrder: 0, sentenceIndex: 0, lineOffset: 0 };
const portion: ReaderPortion = {
  id: 'current', index: 0, sectionId: 'chapter', sectionLabel: 'Chapter', start: anchor, end: anchor,
  blocks: [{ type: 'text', key: 'paragraph', blockId: 'paragraph', blockOrder: 0, kind: 'paragraph',
    startSentence: 0, endSentence: 0, continuationStart: false, continuationEnd: false,
    lines: [{ key: 'line', fragments: [{ key: 'text', text: 'First word.', font: '20px serif', marks: [], blockStart: 0, blockEnd: 11 }] }]
  }]
};
const settings = { fontSize: 20, lineHeight: 1.6, horizontalPadding: 28, theme: 'light' as const,
  wordAnimation: true, wordAnimationStyle: 'explosion' as const };
let container: HTMLDivElement;
let root: Root;
let onNext: ReturnType<typeof vi.fn>;
const captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture');

function pointer(target: Element, type: string) {
  target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 200 }),
    { pointerId: 1, pointerType: 'mouse' }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  window.getSelection()?.removeAllRanges();
  onNext = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const next = { ...portion, id: 'next', index: 1 };
  act(() => root.render(createElement(ReaderScreen, {
    book, portion, previousPortion: null, nextPortion: next, portions: [portion, next], portionCount: 2,
    portionIndex: 0, viewport: null, paginationPending: false, settings, requestedSettings: settings,
    annotations: [], containerRef: null, onNext, onPrevious: vi.fn(), onJumpToPortion: vi.fn(),
    onSettingsChange: vi.fn(), onFileSelected: vi.fn(), onSaveAnnotation: vi.fn(), onDeleteAnnotation: vi.fn()
  })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (captureDescriptor) Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', captureDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('desktop reader navigation', () => {
  it.each(['wheel', 'tap'])('allows %s navigation after holding the mouse without selecting text', (input) => {
    const word = container.querySelector('.portion-pane-current .reader-word')!;
    act(() => pointer(word, 'pointerdown'));
    act(() => vi.advanceTimersByTime(350));
    expect(container.querySelector('.selection-enabled')).not.toBeNull();
    act(() => pointer(word, 'pointerup'));
    act(() => vi.advanceTimersByTime(300));
    const stage = container.querySelector('main')!;
    act(() => {
      if (input === 'wheel') stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }));
      else { pointer(stage, 'pointerdown'); pointer(stage, 'pointerup'); }
    });
    expect(onNext).toHaveBeenCalledOnce();
    expect(container.querySelector('.selection-enabled')).toBeNull();
  });
});
