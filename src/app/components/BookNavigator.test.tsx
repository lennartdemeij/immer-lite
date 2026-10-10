import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import { BookNavigator } from './BookNavigator';

const anchor = { blockId: 'paragraph', blockOrder: 0, sentenceIndex: 0, lineOffset: 0 };
const portions = [{ id: 'portion', index: 0, sectionId: 'chapter', sectionLabel: 'Chapter One', start: anchor, end: anchor,
  blocks: [{ type: 'text', key: 'paragraph', blockId: 'paragraph', blockOrder: 0, kind: 'paragraph', startSentence: 0, endSentence: 0,
    continuationStart: false, continuationEnd: false, lines: [{ key: 'line', fragments: [{ key: 'text', text: 'First word.', font: '20px serif', marks: [], blockStart: 0, blockEnd: 11 }] }] }]
}] as ReaderPortion[];
const annotations = [0, 1].map(i => ({ id: `note-${i}`, blockId: 'paragraph', startOffset: i, note: `Note ${i}` })) as TextAnnotation[];
afterEach(() => vi.unstubAllGlobals());

describe('book navigator controls', () => {
  it('switches modes without navigating, exposes every note and opens its own portion', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onJump = vi.fn();
    const onNote = vi.fn();
    act(() => root.render(createElement(BookNavigator, { portions, annotations, focusedIndex: 0, expanded: true,
      side: 'left', disabled: false, navigatorRef: createRef<HTMLElement>(), onJump, onNote, onOpen: vi.fn(), onDragging: vi.fn(), onTilt: vi.fn() })));
    const notes = container.querySelector<HTMLButtonElement>('[aria-label="Notes view"]')!;
    act(() => notes.click());
    expect(onJump).not.toHaveBeenCalled();
    expect(notes.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.book-navigator.side-left.mode-notes')).not.toBeNull();
    expect(container.querySelectorAll('.navigator-note-label.visible')).toHaveLength(2);
    expect(container.querySelectorAll('.navigator-note-avatar')).toHaveLength(2);
    expect(container.querySelector('.navigator-chapter-label.visible')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Open note: Note 1"]')!.click());
    expect(onJump).toHaveBeenCalledWith(0);
    expect(onNote).toHaveBeenCalledWith(annotations[1]);
    expect(notes.getAttribute('aria-pressed')).toBe('true');
    act(() => root.unmount());
    container.remove();
  });
});
