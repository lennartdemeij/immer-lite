import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBook } from '../../types/book';
import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import { ReaderScreen } from './ReaderScreen';

vi.mock('../hooks/useReadAloud', () => ({
  useReadAloud: () => ({ isPlaying: false, supported: false, status: 'idle', toggle: vi.fn() })
}));

const book: CanonicalBook = {
  id: 'book', fingerprint: 'book', metadata: { title: 'Test book' },
  sections: [{ id: 'chapter', index: 0, label: 'Chapter', href: 'chapter.xhtml', matter: 'body',
    anchorIds: [], localLinks: [], blocks: [{ id: 'paragraph', order: 0, kind: 'paragraph',
      sectionId: 'chapter', text: 'First word.', inlineContent: [],
      sentences: [{ id: 'sentence', index: 0, text: 'First word.', inlineIds: [], startOffset: 0, endOffset: 11 }]
    }] }], toc: [], resources: {},
  totalBlocks: 1, totalSentences: 1, parseStats: { confidence: 1, diagnostics: [], parsedAt: '', durationMs: 0 }
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
let onSaveAnnotation: ReturnType<typeof vi.fn>;
const captureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture');
const setCaptureDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture');
const rangeRectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

function pointer(target: Element, type: string, pointerType = 'mouse') {
  target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 200 }),
    { pointerId: 1, pointerType }));
}

function renderReader(annotations: TextAnnotation[] = []) {
  const next = { ...portion, id: 'next', index: 1 };
  act(() => root.render(createElement(ReaderScreen, {
    book, portion, previousPortion: null, nextPortion: next, portions: [portion, next], portionCount: 2,
    portionIndex: 0, viewport: null, paginationPending: false, settings, requestedSettings: settings,
    annotations, containerRef: null, onNext, onPrevious: vi.fn(), onJumpToPortion: vi.fn(),
    onSettingsChange: vi.fn(), onFileSelected: vi.fn(), onSaveAnnotation, onDeleteAnnotation: vi.fn()
  })));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  window.getSelection()?.removeAllRanges();
  onNext = vi.fn();
  onSaveAnnotation = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  renderReader();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (captureDescriptor) Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', captureDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
  if (setCaptureDescriptor) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', setCaptureDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  if (rangeRectsDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', rangeRectsDescriptor);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reader navigation', () => {
  it.each(['mouse', 'touch'])('keeps the navigator open after tapping its rail (%s)', pointerType => {
    const rail = container.querySelector('.navigator-rail-hitarea')!;
    act(() => pointer(rail, 'pointerdown', pointerType));
    act(() => pointer(rail, 'pointerup', pointerType));
    expect(container.querySelector('.book-navigator.expanded')).not.toBeNull();
    expect(container.querySelector('[aria-label="Reading tools"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(onNext).not.toHaveBeenCalled();
  });

  it('keeps the navigator open while viewing and switching notes', () => {
    renderReader([0, 1].map(index => ({ id: `note-${index}`, fingerprint: 'book', blockId: 'paragraph',
      blockOrder: 0, sentenceIndex: 0, startOffset: index, endOffset: index + 5,
      selectedText: 'First', note: `Note ${index}`, createdAt: '', updatedAt: '' })));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reading tools"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Notes view"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open note: Note 0"]')!.click());
    const viewer = container.querySelector('.annotation-sheet-viewer')!;
    act(() => pointer(viewer.querySelector('button')!, 'pointerdown'));
    expect(container.querySelector('[aria-label="Reading tools"]')?.getAttribute('aria-expanded')).toBe('true');
    const nextNote = container.querySelector<HTMLButtonElement>('[aria-label="Open note: Note 1"]')!;
    act(() => { pointer(nextNote, 'pointerdown'); nextNote.click(); });
    expect(container.querySelector('.annotation-note-copy')?.textContent).toBe('Note 1');
    expect(container.querySelector('[aria-label="Notes view"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the menu and navigator open after tapping a chapter label', () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reading tools"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Chapters view"]')!.click());
    const label = container.querySelector<HTMLButtonElement>('.navigator-chapter-label.visible')!;
    act(() => { pointer(label, 'pointerdown'); label.click(); });
    expect(container.querySelector('[aria-label="Reading tools"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[aria-label="Chapters view"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it.each(['mouse', 'touch'])('does not turn the page when a save gesture falls through to the reader (%s)', (pointerType) => {
    const word = container.querySelector('.portion-pane-current .reader-word')!;
    act(() => pointer(word, 'pointerdown'));
    act(() => vi.advanceTimersByTime(350));
    const range = document.createRange();
    range.selectNodeContents(word);
    window.getSelection()!.addRange(range);
    act(() => pointer(word, 'pointerup'));
    act(() => vi.advanceTimersByTime(300));
    const editor = container.querySelector('textarea')!;
    expect(editor).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, 'My note');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const save = container.querySelector('.annotation-save-button')!;
    act(() => { pointer(save, 'pointerdown', pointerType); pointer(save, 'pointerup', pointerType); });
    act(() => (save as HTMLButtonElement).click());
    expect(onSaveAnnotation).toHaveBeenCalledOnce();
    expect(container.querySelector('textarea')).toBeNull();
    const stage = container.querySelector('main')!;
    // A delayed/retargeted gesture arrives after the save button disappears.
    act(() => { pointer(stage, 'pointerdown', pointerType); pointer(stage, 'pointerup', pointerType); });
    act(() => vi.advanceTimersByTime(1500));
    expect(onNext).not.toHaveBeenCalled();
    // The guard expires; a new deliberate tap can still turn the page.
    act(() => { pointer(stage, 'pointerdown'); pointer(stage, 'pointerup'); });
    expect(onNext).toHaveBeenCalledOnce();
  });

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
