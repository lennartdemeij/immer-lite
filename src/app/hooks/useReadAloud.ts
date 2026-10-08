import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanonicalBook } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';
import { estimateWordDurations, getSpeechChunks, type SpeechChunk, type SpokenWord } from '../../lib/reader/speechContent';

interface ReadAloudOptions {
  book: CanonicalBook;
  portion: ReaderPortion | null;
  rate: number;
  canGoNext: boolean;
  paginationPending: boolean;
  onNext: () => void;
}

export function useReadAloud(options: ReadAloudOptions) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const chunks = useMemo(() => getSpeechChunks(options.book, options.portion), [options.book, options.portion]);
  const key = JSON.stringify(chunks);
  const latest = useRef({ ...options, chunks, key });
  latest.current = { ...options, chunks, key };
  const [isPlaying, setIsPlaying] = useState(false);
  const [spokenWord, setSpokenWord] = useState<SpokenWord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playback = useRef({
    active: false, generation: 0, chunk: 0, word: 0,
    waiting: null as 'layout' | 'page' | null,
    chunks: chunks as SpeechChunk[], key, fingerprint: options.book.fingerprint, portionId: options.portion?.id,
    rate: options.rate, cursor: null as SpokenWord | null,
    utterance: null as SpeechSynthesisUtterance | null,
    timingScale: 1
  });

  function clearWordTimer() {
    if (wordTimer.current !== null) clearTimeout(wordTimer.current);
    wordTimer.current = null;
  }

  function cancelUtterance() {
    clearWordTimer();
    playback.current.generation += 1;
    playback.current.utterance = null;
    if (supported) window.speechSynthesis.cancel();
  }

  function finish() {
    clearWordTimer();
    const state = playback.current;
    state.active = false;
    state.waiting = null;
    state.cursor = null;
    setIsPlaying(false);
    setSpokenWord(null);
  }

  function finishPage() {
    const state = playback.current;
    state.cursor = null;
    setSpokenWord(null);
    if (latest.current.canGoNext) {
      state.waiting = 'page';
      latest.current.onNext();
    } else if (latest.current.paginationPending) {
      state.waiting = 'layout';
    } else {
      finish();
    }
  }

  function speak() {
    const state = playback.current;
    if (!supported || !state.active) return;
    const chunk = state.chunks[state.chunk];
    if (!chunk) {
      finishPage();
      return;
    }
    state.waiting = null;
    const word = chunk.words[state.word];
    const language = latest.current.book.metadata.language?.replaceAll('_', '-') || 'en';
    const languagePrefix = language.split('-')[0].toLowerCase();
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().split('-')[0] === languagePrefix);
    const voice = voices.find((candidate) => candidate.localService && candidate.default)
      ?? voices.find((candidate) => candidate.localService) ?? voices[0];
    // Android supplies no word events. Estimate within sentences and
    // resynchronize at each actual start/end; use real boundaries when available.
    const firstWord = state.word;
    const from = state.word === 0 ? 0 : word.charStart;
    const utterance = new SpeechSynthesisUtterance(chunk.text.slice(from));
    utterance.lang = language;
    utterance.rate = Math.min(2, Math.max(0.5, state.rate));
    if (voice) utterance.voice = voice;
    const generation = ++state.generation;
    const current = () => state.active && generation === state.generation;
    const durations = estimateWordDurations(chunk, firstWord, state.rate);
    let startedAt: number | null = null;
    let receivedBoundary = false;
    const highlight = (index: number) => {
      state.word = index;
      state.cursor = chunk.words[index];
      setSpokenWord(chunk.words[index]);
    };
    utterance.onstart = () => {
      if (!current()) return;
      startedAt = performance.now();
      highlight(firstWord);
      let elapsed = 0;
      const schedule = (index: number) => {
        if (index + 1 >= durations.length) return;
        elapsed += durations[index] * state.timingScale;
        wordTimer.current = setTimeout(() => {
          wordTimer.current = null;
          if (!current() || receivedBoundary) return;
          highlight(firstWord + index + 1);
          schedule(index + 1);
        }, Math.max(0, startedAt! + elapsed - performance.now()));
      };
      schedule(0);
    };
    utterance.onboundary = (event) => {
      if (!current() || (event.name && event.name !== 'word')) return;
      const charIndex = from + event.charIndex;
      const index = chunk.words.findIndex((candidate) => candidate.charEnd > charIndex);
      if (index >= 0) {
        receivedBoundary = true;
        clearWordTimer();
        highlight(index);
      }
    };
    utterance.onend = () => {
      if (!current()) return;
      clearWordTimer();
      if (!receivedBoundary && startedAt !== null) {
        const measuredScale = (performance.now() - startedAt) / durations.reduce((sum, duration) => sum + duration, 0);
        state.timingScale = state.timingScale * 0.7 + Math.min(2, Math.max(0.5, measuredScale)) * 0.3;
      }
      state.chunk += 1;
      state.word = 0;
      speak();
    };
    utterance.onerror = () => {
      if (!current()) return;
      finish();
      setError('Unable to read aloud. Check your device’s speech settings and try again.');
    };
    state.utterance = utterance;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
      setError('Unable to start reading aloud. Please try again.');
    }
  }

  function toggle() {
    const state = playback.current;
    if (state.active) {
      state.active = false;
      cancelUtterance();
      setIsPlaying(false);
      return;
    }
    if (!supported) return;
    state.active = true;
    setError(null);
    setIsPlaying(true);
    if (state.waiting === 'page') return;
    if (state.chunk >= state.chunks.length) {
      state.chunk = 0;
      state.word = 0;
    }
    speak();
  }

  useEffect(() => {
    const state = playback.current;
    const bookChanged = state.fingerprint !== options.book.fingerprint;
    const contentChanged = state.key !== key;
    const pageAdvanced = state.waiting === 'page' && state.portionId !== options.portion?.id;
    const rateChanged = state.rate !== options.rate;
    if (bookChanged || contentChanged || pageAdvanced || rateChanged) {
      const cursor = bookChanged ? null : state.cursor;
      cancelUtterance();
      state.fingerprint = options.book.fingerprint;
      if (bookChanged) state.timingScale = 1;
      state.key = key;
      state.portionId = options.portion?.id;
      state.rate = options.rate;
      state.chunks = chunks;
      state.waiting = null;
      state.chunk = 0;
      state.word = 0;
      if (cursor) {
        const chunkIndex = chunks.findIndex((chunk) => chunk.words.some((word) =>
          word.blockId === cursor.blockId && word.startOffset === cursor.startOffset));
        if (chunkIndex >= 0) {
          state.chunk = chunkIndex;
          state.word = chunks[chunkIndex].words.findIndex((word) => word.startOffset === cursor.startOffset);
        }
      }
      state.cursor = chunks[state.chunk]?.words[state.word] ?? null;
      setSpokenWord(state.active ? state.cursor : null);
      if (bookChanged) {
        finish();
        setError(null);
      } else if (state.active) {
        speak();
      }
    } else if (state.active && state.waiting === 'layout') {
      if (options.canGoNext) {
        state.waiting = 'page';
        options.onNext();
      } else if (!options.paginationPending) {
        finish();
      }
    }
  }, [key, options.portion?.id, options.book.fingerprint, options.rate, options.canGoNext, options.paginationPending]);

  useEffect(() => () => {
    playback.current.active = false;
    cancelUtterance();
  }, []);

  return { supported, isPlaying, spokenWord, error, toggle };
}
