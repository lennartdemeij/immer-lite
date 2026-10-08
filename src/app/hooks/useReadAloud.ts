import { useEffect, useMemo, useRef, useState } from 'react';
import type { CanonicalBook } from '../../types/book';
import type { ReaderPortion } from '../../types/reader';
import { estimateWordDurations, getSpeechChunks, type SpeechChunk, type SpokenWord } from '../../lib/reader/speechContent';
import { KokoroSpeech } from '../../lib/reader/kokoroSpeech';

interface ReadAloudOptions {
  book: CanonicalBook;
  portion: ReaderPortion | null;
  nextPortion?: ReaderPortion | null;
  rate: number;
  engine?: 'built-in' | 'ai';
  canGoNext: boolean;
  paginationPending: boolean;
  onNext: () => void;
}

export function useReadAloud(options: ReadAloudOptions) {
  const builtInSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const engine = options.engine ?? 'built-in';
  const aiLanguageSupported = !options.book.metadata.language || /^en(?:[-_]|$)/i.test(options.book.metadata.language);
  const supported = engine === 'ai'
    ? typeof window !== 'undefined' && 'Worker' in window && 'AudioContext' in window && aiLanguageSupported
    : builtInSupported;
  const chunks = useMemo(() => getSpeechChunks(options.book, options.portion), [options.book, options.portion]);
  const nextChunks = useMemo(() => engine === 'ai' ? getSpeechChunks(options.book, options.nextPortion ?? null) : [],
    [options.book, options.nextPortion, engine]);
  const key = JSON.stringify(chunks);
  const latest = useRef({ ...options, chunks, nextChunks, key });
  latest.current = { ...options, chunks, nextChunks, key };
  const [isPlaying, setIsPlaying] = useState(false);
  const [spokenWord, setSpokenWord] = useState<SpokenWord | null>(null);
  const spokenChunk = useMemo(() => spokenWord && chunks.find((chunk) => chunk.words.some((word) =>
    word.blockId === spokenWord.blockId && word.startOffset === spokenWord.startOffset)), [chunks, spokenWord]);
  const spokenSentence = useMemo<SpokenWord | null>(() => {
    if (!spokenChunk) return null;
    const first = spokenChunk.words[0];
    const startOffset = first.startOffset - first.charStart;
    return { blockId: first.blockId, startOffset, endOffset: startOffset + spokenChunk.text.length };
  }, [spokenChunk]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const aiSpeech = useRef<KokoroSpeech | null>(null);
  const wordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playback = useRef({
    active: false, generation: 0, chunk: 0, word: 0,
    waiting: null as 'layout' | 'page' | null,
    chunks: chunks as SpeechChunk[], key, fingerprint: options.book.fingerprint, portionId: options.portion?.id,
    rate: options.rate, engine, cursor: null as SpokenWord | null,
    utterance: null as SpeechSynthesisUtterance | null,
    timingScale: 1,
    voiceFallback: 0
  });

  function clearWordTimer() {
    if (wordTimer.current !== null) clearTimeout(wordTimer.current);
    wordTimer.current = null;
  }

  function cancelUtterance() {
    clearWordTimer();
    playback.current.generation += 1;
    playback.current.utterance = null;
    aiSpeech.current?.cancel();
    setStatus(null);
    if (builtInSupported) window.speechSynthesis.cancel();
  }

  function finish() {
    clearWordTimer();
    const state = playback.current;
    state.active = false;
    state.waiting = null;
    state.cursor = null;
    setIsPlaying(false);
    setSpokenWord(null);
    setStatus(null);
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

  async function speakAI(chunk: SpeechChunk) {
    const state = playback.current;
    const generation = ++state.generation;
    const current = () => state.active && generation === state.generation;
    const firstWord = state.word;
    const voice = 'am_echo';
    const speed = Math.min(2, Math.max(0.5, state.rate));
    try {
      if (!aiSpeech.current) aiSpeech.current = new KokoroSpeech((message) => {
        if (playback.current.active && playback.current.engine === 'ai') setStatus(message);
      });
      const speech = aiSpeech.current;
      setStatus('Preparing AI voice…');
      await speech.unlock();
      if (!current()) return;
      // Reuse the same recording after a pause; don't infer a new sentence suffix.
      const recording = speech.generate(chunk.text, voice, speed);
      // Queue ahead immediately, including across portions, instead of waiting for playback.
      const ahead = [...state.chunks.slice(state.chunk + 1), ...latest.current.nextChunks].slice(0, 3);
      ahead.forEach((next) => { void speech.generate(next.text, voice, speed).catch(() => {}); });
      const audio = await recording;
      if (!current()) return;
      const allWeights = estimateWordDurations(chunk, 0, 1);
      const offset = allWeights.slice(0, firstWord).reduce((sum, weight) => sum + weight, 0)
        / allWeights.reduce((sum, weight) => sum + weight, 0) * audio.samples.length / audio.sampleRate;
      const highlight = (index: number) => {
        state.word = index;
        state.cursor = chunk.words[index];
        setSpokenWord(state.cursor);
      };
      const clock = speech.play(audio, 1, () => {
        if (!current()) return;
        clearWordTimer();
        state.chunk += 1;
        state.word = 0;
        speak();
      }, offset);
      setStatus(null);
      highlight(firstWord);
      // Fit the word-length estimates to this sentence's actual audio duration.
      const weights = estimateWordDurations(chunk, firstWord, 1);
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let elapsed = 0;
      const schedule = (index: number) => {
        if (index + 1 >= weights.length) return;
        elapsed += weights[index] / totalWeight * clock.duration;
        wordTimer.current = setTimeout(() => {
          wordTimer.current = null;
          if (!current()) return;
          highlight(firstWord + index + 1);
          schedule(index + 1);
        }, Math.max(0, (elapsed - clock.elapsed()) * 1000));
      };
      schedule(0);
    } catch (cause) {
      if (!current()) return;
      aiSpeech.current?.dispose();
      aiSpeech.current = null;
      finish();
      setError(cause instanceof Error ? cause.message : 'AI voice could not start. Try again or choose Built-in.');
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
    if (state.engine === 'ai') { void speakAI(chunk); return; }
    const word = chunk.words[state.word];
    const language = latest.current.book.metadata.language?.replaceAll('_', '-') || 'en';
    const languagePrefix = language.split('-')[0].toLowerCase();
    const voiceLanguage = (voice: SpeechSynthesisVoice) => voice.lang.replaceAll('_', '-');
    const voices = window.speechSynthesis.getVoices().filter((voice) => voiceLanguage(voice).toLowerCase().split('-')[0] === languagePrefix);
    const voice = state.voiceFallback === 0
      ? voices.find((candidate) => candidate.localService && voiceLanguage(candidate).toLowerCase() === language.toLowerCase())
        ?? voices.find((candidate) => candidate.localService && candidate.default)
        ?? voices.find((candidate) => candidate.localService) ?? voices[0]
      : undefined;
    // Android supplies no word events. Estimate within sentences and
    // resynchronize at each actual start/end; use real boundaries when available.
    const firstWord = state.word;
    const from = state.word === 0 ? 0 : word.charStart;
    const utterance = new SpeechSynthesisUtterance(chunk.text.slice(from));
    // Android advertises locales such as en_US. Use the actual installed
    // locale first, then let the browser choose if that voice cannot start.
    if (state.voiceFallback < 2) utterance.lang = voice ? voiceLanguage(voice) : language;
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
    utterance.onerror = (event) => {
      if (!current()) return;
      const code = event?.error || 'unknown';
      if (startedAt === null && state.voiceFallback < 2 &&
        ['voice-unavailable', 'language-unavailable', 'language-not-supported', 'synthesis-failed', 'synthesis-unavailable', 'network'].includes(code)) {
        cancelUtterance();
        state.voiceFallback += 1;
        speak();
        return;
      }
      finish();
      if (code === 'synthesis-failed' && /Android/i.test(navigator.userAgent)) {
        setError('Speech could not start (synthesis-failed). Fully close and reopen your browser, then try Play again.');
      } else {
        setError(code === 'not-allowed'
          ? 'Reading was blocked by the browser. Tap Play to try again (not-allowed).'
          : `Unable to read aloud (${code}). Try Play again; if it still fails, check your device’s text-to-speech engine.`);
      }
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
    if (error) state.voiceFallback = 0;
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
    const engineChanged = state.engine !== engine;
    if (bookChanged || contentChanged || pageAdvanced || rateChanged || engineChanged) {
      const cursor = bookChanged ? null : state.cursor;
      cancelUtterance();
      state.fingerprint = options.book.fingerprint;
      if (bookChanged) {
        state.timingScale = 1;
        state.voiceFallback = 0;
      }
      state.key = key;
      state.portionId = options.portion?.id;
      state.rate = options.rate;
      state.engine = engine;
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
      } else if (state.active && supported) {
        speak();
      } else if (!supported) {
        finish();
      }
      if (engineChanged) setError(null);
    } else if (state.active && state.waiting === 'layout') {
      if (options.canGoNext) {
        state.waiting = 'page';
        options.onNext();
      } else if (!options.paginationPending) {
        finish();
      }
    }
  }, [key, options.portion?.id, options.book.fingerprint, options.rate, engine, supported, options.canGoNext, options.paginationPending]);

  useEffect(() => () => {
    playback.current.active = false;
    cancelUtterance();
    aiSpeech.current?.dispose();
    aiSpeech.current = null;
  }, []);

  return { supported, isPlaying, spokenWord, spokenSentence, error, status, aiLanguageSupported, toggle };
}
