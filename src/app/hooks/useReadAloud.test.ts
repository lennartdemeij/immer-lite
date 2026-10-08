import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalBook, TextBlock } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';
import { estimateWordDurations, getSpeechChunks } from '../../lib/reader/speechContent';
import { useReadAloud } from './useReadAloud';

const ai = vi.hoisted(() => ({
  unlock: vi.fn(), generate: vi.fn(), play: vi.fn(), cancel: vi.fn(), dispose: vi.fn()
}));
vi.mock('../../lib/reader/kokoroSpeech', () => ({
  KokoroSpeech: vi.fn(function () { return ai; })
}));

const text = 'Hello wonderful world. Next sentence.';
const block: TextBlock = {
  id: 'paragraph', sectionId: 'chapter', order: 0, kind: 'paragraph', text,
  inlineContent: [{ id: 'inline', text, marks: [] }],
  sentences: [
    { id: 's1', index: 0, text: text.slice(0, 22), inlineIds: ['inline'], startOffset: 0, endOffset: 22 },
    { id: 's2', index: 1, text: text.slice(23), inlineIds: ['inline'], startOffset: 23, endOffset: text.length }
  ]
};
const book: CanonicalBook = {
  id: 'book', fingerprint: 'book', metadata: { title: 'Test', language: 'en-US' },
  sections: [{ id: 'chapter', index: 0, label: 'Chapter', href: '', blocks: [block], matter: 'body', anchorIds: [], localLinks: [] }],
  toc: [], resources: {}, totalBlocks: 1, totalSentences: 2,
  parseStats: { confidence: 1, diagnostics: [], parsedAt: '', durationMs: 0 }
};
function page(start: number, end: number): ReaderPortion {
  const anchor = { blockId: block.id, blockOrder: 0, sentenceIndex: 0, lineOffset: 0 };
  return {
    id: `${start}-${end}`, index: start, sectionId: 'chapter', sectionLabel: 'Chapter', start: anchor, end: anchor,
    blocks: [{
      type: 'text', key: 'slice', blockId: block.id, blockOrder: 0, kind: 'paragraph', startSentence: 0, endSentence: 1,
      continuationStart: start > 0, continuationEnd: end < text.length,
      lines: [{ key: 'line', fragments: [{ key: 'f', text: text.slice(start, end), font: '', marks: [], blockStart: start, blockEnd: end }] }]
    }]
  };
}
class FakeUtterance {
  lang = '';
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
  onerror: ((event?: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

let root: Root;
let container: HTMLDivElement;
let spoken: FakeUtterance[];
let result: ReturnType<typeof useReadAloud>;
let options: Parameters<typeof useReadAloud>[0];
let cancel: ReturnType<typeof vi.fn>;
function Probe() { result = useReadAloud(options); return null; }
function render(changes: Partial<typeof options> = {}) {
  options = { ...options, ...changes };
  act(() => root.render(createElement(Probe)));
}
const current = () => spoken.at(-1)!;
const start = () => act(() => current().onstart?.());
const end = () => act(() => current().onend?.());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  spoken = [];
  vi.clearAllMocks();
  ai.unlock.mockResolvedValue(undefined);
  ai.generate.mockResolvedValue({ samples: new Float32Array(24000), sampleRate: 24000 });
  ai.play.mockImplementation(() => {
    const startedAt = performance.now();
    return { duration: 3, elapsed: () => (performance.now() - startedAt) / 1000 };
  });
  vi.stubGlobal('Worker', function () {});
  vi.stubGlobal('AudioContext', function () {});
  cancel = vi.fn(() => current()?.onerror?.());
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', { speak: (utterance: FakeUtterance) => spoken.push(utterance), cancel, getVoices: () => [] });
  options = { book, portion: page(0, 22), rate: 1, canGoNext: false, paginationPending: false, onNext: vi.fn() };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('read aloud', () => {
  it('starts the current sentence immediately while a slow next sentence is prepared in the background', async () => {
    let resolveNext!: (value: object) => void;
    const nextAudio = new Promise((resolve) => { resolveNext = resolve; });
    ai.generate.mockImplementation((sentence: string) => sentence === 'Next sentence.'
      ? nextAudio : Promise.resolve({ samples: new Float32Array(24000), sampleRate: 24000 }));
    render({ engine: 'ai', portion: page(0, text.length) });
    await act(async () => result.toggle());
    expect(ai.generate).toHaveBeenCalledWith('Next sentence.', expect.any(String), 1);
    expect(ai.play).toHaveBeenCalledOnce();
    expect(result.status).toBeNull();
    await act(async () => resolveNext({ samples: new Float32Array(240000), sampleRate: 24000 }));
    expect(ai.play).toHaveBeenCalledOnce();
    await act(async () => ai.play.mock.calls[0][2]());
    expect(ai.play).toHaveBeenCalledTimes(2);
    expect(result.status).toBeNull();
  });

  it('prepares sentences across the next page boundary while this page is playing', async () => {
    render({ engine: 'ai', canGoNext: true, nextPortion: page(23, text.length) });
    await act(async () => result.toggle());
    expect(ai.generate).toHaveBeenCalledWith('Next sentence.', 'am_echo', 1);
    expect(options.onNext).not.toHaveBeenCalled();
  });

  it('does not resume playback when background preparation completes after pausing', async () => {
    let resolveNext!: (value: object) => void;
    ai.generate.mockImplementation((sentence: string) => sentence === 'Next sentence.'
      ? new Promise((resolve) => { resolveNext = resolve; })
      : Promise.resolve({ samples: new Float32Array(24000), sampleRate: 24000 }));
    render({ engine: 'ai', portion: page(0, text.length) });
    await act(async () => result.toggle());
    expect(ai.play).toHaveBeenCalledOnce();
    expect(result.status).toBeNull();
    act(() => result.toggle());
    await act(async () => resolveNext({ samples: new Float32Array(24000), sampleRate: 24000 }));
    expect(ai.play).toHaveBeenCalledOnce();
    expect(result.isPlaying).toBe(false);
  });

  it('uses Echo for British English books too', async () => {
    render({ engine: 'ai', book: { ...book, metadata: { ...book.metadata, language: 'en-GB' } } });
    await act(async () => result.toggle());
    expect(ai.generate).toHaveBeenCalledWith('Hello wonderful world.', 'am_echo', 1);
  });

  it('reuses full sentence audio when resuming at a later word', async () => {
    render({ engine: 'ai' });
    await act(async () => result.toggle());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.toggle());
    await act(async () => result.toggle());
    expect(ai.generate).toHaveBeenLastCalledWith('Hello wonderful world.', 'am_echo', 1);
    expect(ai.play.mock.calls.at(-1)?.[3]).toBeGreaterThan(0);
  });

  it('fits AI word highlights to the real sentence audio and prepares the next sentence', async () => {
    render({ engine: 'ai', portion: page(0, text.length) });
    await act(async () => result.toggle());
    expect(spoken).toHaveLength(0);
    expect(ai.generate).toHaveBeenCalledWith('Hello wonderful world.', 'am_echo', 1);
    expect(ai.generate).toHaveBeenCalledWith('Next sentence.', 'am_echo', 1);
    expect(result.spokenSentence).toEqual({ blockId: block.id, startOffset: 0, endOffset: 22 });
    const weights = estimateWordDurations(getSpeechChunks(book, page(0, 22))[0], 0, 1);
    const firstDuration = 3000 * weights[0] / weights.reduce((sum, weight) => sum + weight, 0);
    act(() => vi.advanceTimersByTime(firstDuration - 1));
    expect(result.spokenWord?.startOffset).toBe(0);
    act(() => vi.advanceTimersByTime(2));
    expect(result.spokenWord?.startOffset).toBe(6);
    await act(async () => ai.play.mock.calls[0][2]());
    expect(result.spokenWord?.startOffset).toBe(23);
    await act(async () => ai.play.mock.calls[1][2]());
    expect(result.isPlaying).toBe(false);
  });

  it('does not start delayed AI audio after pausing during loading', async () => {
    let resolve!: (value: object) => void;
    ai.generate.mockReturnValue(new Promise((done) => { resolve = done; }));
    render({ engine: 'ai' });
    await act(async () => result.toggle());
    expect(result.status).toContain('Preparing');
    act(() => result.toggle());
    await act(async () => resolve({ samples: new Float32Array(24000), sampleRate: 24000 }));
    expect(ai.play).not.toHaveBeenCalled();
    expect(result.isPlaying).toBe(false);
    expect(result.status).toBeNull();
  });

  it('continues AI reading on the next page and ignores canceled audio callbacks', async () => {
    render({ engine: 'ai', canGoNext: true });
    await act(async () => result.toggle());
    await act(async () => ai.play.mock.calls[0][2]());
    expect(options.onNext).toHaveBeenCalledOnce();
    await act(async () => render({ portion: page(23, text.length), canGoNext: false }));
    expect(ai.generate).toHaveBeenLastCalledWith('Next sentence.', 'am_echo', 1);
    act(() => result.toggle());
    await act(async () => ai.play.mock.calls[1][2]());
    expect(options.onNext).toHaveBeenCalledOnce();
    expect(result.isPlaying).toBe(false);
  });

  it('can switch from AI to the device voice at its current word', async () => {
    render({ engine: 'ai' });
    await act(async () => result.toggle());
    act(() => vi.advanceTimersByTime(1000));
    render({ engine: 'built-in' });
    expect(ai.cancel).toHaveBeenCalled();
    expect(current().text).toBe('wonderful world.');
    await act(async () => ai.play.mock.calls[0][2]());
    expect(spoken).toHaveLength(1);
    expect(result.isPlaying).toBe(true);
  });

  it('generates AI speech at the selected speed without altering playback pitch', async () => {
    render({ engine: 'ai', rate: 2 });
    await act(async () => result.toggle());
    expect(ai.generate).toHaveBeenCalledWith('Hello wonderful world.', 'am_echo', 2);
    expect(ai.play.mock.calls[0][1]).toBe(1);
  });

  it('keeps built-in available for languages Kokoro does not support', () => {
    render({ engine: 'ai', book: { ...book, metadata: { ...book.metadata, language: 'nl' } } });
    expect(result.supported).toBe(false);
    expect(result.aiLanguageSupported).toBe(false);
    act(() => result.toggle());
    expect(ai.generate).not.toHaveBeenCalled();
    render({ engine: 'built-in' });
    expect(result.supported).toBe(true);
  });

  it('stops on an AI initialization error and permits another Play attempt', async () => {
    ai.generate.mockRejectedValueOnce(new Error('AI voice could not initialize.'));
    render({ engine: 'ai' });
    await act(async () => result.toggle());
    expect(result.isPlaying).toBe(false);
    expect(result.error).toContain('could not initialize');
    expect(ai.dispose).toHaveBeenCalledOnce();
    await act(async () => result.toggle());
    expect(result.error).toBeNull();
    expect(ai.play).toHaveBeenCalledOnce();
  });

  it('falls back when Android refuses an advertised voice before speech starts', () => {
    const voice = { name: 'English US', voiceURI: 'english-us', lang: 'en_US', localService: true, default: true };
    vi.stubGlobal('speechSynthesis', { getVoices: () => [voice], cancel, speak: (utterance: FakeUtterance) => spoken.push(utterance) });
    act(() => result.toggle());
    expect(current().voice).toBe(voice);
    expect(current().lang).toBe('en-US');
    act(() => current().onerror?.({ error: 'synthesis-failed' }));
    expect(result.error).toBeNull();
    expect(result.isPlaying).toBe(true);
    expect(spoken).toHaveLength(2);
    expect(current().voice).toBeNull();
    expect(current().text).toBe('Hello wonderful world.');
    start(); end();
    expect(result.isPlaying).toBe(false);
  });

  it('prefers the installed locale and uses a successful fallback for subsequent sentences', () => {
    const australia = { name: 'English Australia', lang: 'en-AU', localService: true, default: true };
    const usa = { name: 'English US', lang: 'en_US', localService: true, default: false };
    vi.stubGlobal('speechSynthesis', { getVoices: () => [australia, usa], cancel, speak: (utterance: FakeUtterance) => spoken.push(utterance) });
    render({ portion: page(0, text.length) });
    act(() => result.toggle());
    expect(current().voice).toBe(usa);
    act(() => current().onerror?.({ error: 'voice-unavailable' }));
    expect(current().voice).toBeNull();
    start(); end();
    expect(current().voice).toBeNull();
    expect(current().text).toBe('Next sentence.');
  });

  it('tries the device default if the requested language cannot start, with bounded retries', () => {
    act(() => result.toggle());
    act(() => current().onerror?.({ error: 'synthesis-failed' }));
    act(() => current().onerror?.({ error: 'synthesis-failed' }));
    expect(current().lang).toBe('');
    act(() => current().onerror?.({ error: 'synthesis-failed' }));
    expect(spoken).toHaveLength(3);
    expect(result.error).toContain('synthesis-failed');
    expect(result.isPlaying).toBe(false);
    act(() => result.toggle());
    expect(current().lang).toBe('en-US');
  });

  it('does not repeat already spoken text when the engine fails mid-sentence', () => {
    act(() => result.toggle());
    start();
    act(() => current().onerror?.({ error: 'synthesis-failed' }));
    expect(spoken).toHaveLength(1);
    expect(result.error).toContain('synthesis-failed');
  });

  it('exposes the actual browser error when no voice can start', () => {
    act(() => result.toggle());
    act(() => current().onerror?.({ error: 'not-allowed' }));
    expect(result.error).toContain('not-allowed');
    expect(spoken).toHaveLength(1);
    expect(result.isPlaying).toBe(false);
  });

  it('speaks complete sentences and estimates words by their length, then resynchronizes', () => {
    render({ portion: page(0, text.length) });
    act(() => result.toggle());
    expect(current().text).toBe('Hello wonderful world.');
    start();
    expect(result.spokenWord?.startOffset).toBe(0);
    expect(result.spokenSentence).toEqual({ blockId: block.id, startOffset: 0, endOffset: 22 });
    const firstSentence = result.spokenSentence;
    act(() => vi.advanceTimersByTime(325));
    expect(result.spokenWord?.startOffset).toBe(6);
    expect(result.spokenSentence).toBe(firstSentence);
    act(() => vi.advanceTimersByTime(424));
    expect(result.spokenWord?.startOffset).toBe(6);
    act(() => vi.advanceTimersByTime(1));
    expect(result.spokenWord?.startOffset).toBe(16);
    end();
    expect(current().text).toBe('Next sentence.');
    start();
    expect(result.spokenWord?.startOffset).toBe(23);
    expect(result.spokenSentence).toEqual({ blockId: block.id, startOffset: 23, endOffset: text.length });
    end();
    expect(result.isPlaying).toBe(false);
    expect(result.spokenWord).toBeNull();
    expect(result.spokenSentence).toBeNull();
  });

  it('uses real word boundaries instead of estimated timing when the engine provides them', () => {
    act(() => result.toggle());
    start();
    act(() => current().onboundary?.({ name: 'word', charIndex: 6 }));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.spokenWord?.startOffset).toBe(6);
    act(() => current().onboundary?.({ name: 'word', charIndex: 16 }));
    expect(result.spokenWord?.startOffset).toBe(16);
  });

  it('pauses and resumes at the current word, ignoring callbacks from canceled speech', () => {
    act(() => result.toggle());
    start();
    const old = current();
    act(() => vi.advanceTimersByTime(325));
    act(() => result.toggle());
    expect(result.isPlaying).toBe(false);
    act(() => { vi.advanceTimersByTime(3000); old.onend?.(); old.onstart?.(); });
    expect(spoken).toHaveLength(1);
    expect(result.error).toBeNull();
    act(() => result.toggle());
    expect(current().text).toBe('wonderful world.');
    expect(result.isPlaying).toBe(true);
  });

  it('changes speed without losing its word or replaying the sentence', () => {
    act(() => result.toggle());
    start();
    act(() => vi.advanceTimersByTime(325));
    render({ rate: 2 });
    expect(current().rate).toBe(2);
    expect(current().text).toBe('wonderful world.');
    start();
    act(() => vi.advanceTimersByTime(212.5));
    expect(result.spokenWord?.startOffset).toBe(16);
  });

  it('turns the page and continues automatically, including pages with only images', () => {
    render({ canGoNext: true });
    act(() => result.toggle());
    start(); end();
    expect(options.onNext).toHaveBeenCalledTimes(1);
    const empty = { ...page(23, text.length), id: 'image-1', blocks: [] };
    render({ portion: empty });
    expect(options.onNext).toHaveBeenCalledTimes(2);
    render({ portion: { ...empty, id: 'image-2' } });
    expect(options.onNext).toHaveBeenCalledTimes(3);
    render({ portion: page(23, text.length), canGoNext: false });
    expect(current().text).toBe('Next sentence.');
    start(); end();
    expect(result.isPlaying).toBe(false);
  });

  it('waits for unfinished pagination and does not restart after an equivalent reflow', () => {
    render({ paginationPending: true });
    act(() => result.toggle());
    start();
    render({ portion: { ...page(0, 22), id: 'reflow' } });
    expect(spoken).toHaveLength(1);
    end();
    expect(result.isPlaying).toBe(true);
    render({ canGoNext: true, paginationPending: false });
    expect(options.onNext).toHaveBeenCalledTimes(1);
    render({ portion: page(23, text.length), canGoNext: false });
    expect(current().text).toBe('Next sentence.');
  });

  it('stops on a new book and reports genuine engine errors', () => {
    act(() => result.toggle());
    start();
    render({ book: { ...book, fingerprint: 'other-book' } });
    expect(result.isPlaying).toBe(false);
    expect(result.error).toBeNull();
    act(() => result.toggle());
    act(() => current().onerror?.());
    expect(result.isPlaying).toBe(false);
    expect(result.error).toContain('Unable');
  });
});

describe('speech content', () => {
  it('clips to visible canonical offsets across styled fragments and keeps one utterance per sentence', () => {
    const portion = page(6, text.length);
    const slice = portion.blocks[0];
    if (slice.type !== 'text') throw new Error('Expected text slice');
    const fragment = slice.lines[0].fragments[0];
    slice.lines[0].fragments = [
      { ...fragment, text: 'wonderful', blockStart: 6, blockEnd: 15, marks: ['italic'] },
      { ...fragment, key: 'f2', text: text.slice(15), blockStart: 15 }
    ];
    const chunks = getSpeechChunks(book, portion);
    expect(chunks.map((chunk) => chunk.text)).toEqual(['wonderful world.', 'Next sentence.']);
    expect(chunks[0].words[0]).toMatchObject({ startOffset: 6, endOffset: 15, charStart: 0, charEnd: 9 });
    expect(chunks[1].words[0]).toMatchObject({ startOffset: 23, endOffset: 27 });
  });

  it('accounts for word length, punctuation and reading speed', () => {
    const chunk = getSpeechChunks(book, page(0, 22))[0];
    expect(estimateWordDurations(chunk, 0, 1)).toEqual([325, 425, 575]);
    expect(estimateWordDurations(chunk, 1, 2)).toEqual([212.5, 287.5]);
  });
});
