import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KokoroSpeech } from './kokoroSpeech';

let worker: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void };
let speech: KokoroSpeech;

beforeEach(() => {
  worker = { postMessage: vi.fn(), terminate: vi.fn() };
  vi.stubGlobal('Worker', vi.fn(function () { return worker; }));
  vi.stubGlobal('AudioContext', vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; }));
  speech = new KokoroSpeech(() => {});
});
afterEach(() => { speech.dispose(); vi.unstubAllGlobals(); });

function complete(id: number) {
  worker.onmessage?.({ data: { id, type: 'audio', samples: new Float32Array(1), sampleRate: 24000 } } as MessageEvent);
}

it('shares pending and completed recordings instead of generating them again on resume', async () => {
  const first = speech.generate('Hello world.', 'am_echo', 1);
  expect(speech.generate('Hello world.', 'am_echo', 1)).toBe(first);
  complete(1);
  await first;
  expect(speech.generate('Hello world.', 'am_echo', 1)).toBe(first);
  expect(worker.postMessage).toHaveBeenCalledOnce();
});

it('bounds the rolling audio cache to four sentences', async () => {
  for (let id = 1; id <= 5; id++) {
    const recording = speech.generate(`Sentence ${id}.`, 'am_echo', 1);
    complete(id);
    await recording;
  }
  const oldest = speech.generate('Sentence 1.', 'am_echo', 1);
  expect(worker.postMessage).toHaveBeenCalledTimes(6);
  complete(6);
  await oldest;
});

it('does not reuse a recording generated at another speed', async () => {
  const first = speech.generate('Hello world.', 'am_echo', 1);
  complete(1);
  await first;
  const faster = speech.generate('Hello world.', 'am_echo', 2);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  complete(2);
  await faster;
});

it('allows retrying a failed sentence', async () => {
  const first = speech.generate('Hello world.', 'am_echo', 1);
  const rejected = expect(first).rejects.toThrow('Failed');
  worker.onmessage?.({ data: { id: 1, type: 'error', message: 'Failed' } } as MessageEvent);
  await rejected;
  const retry = speech.generate('Hello world.', 'am_echo', 1);
  complete(2);
  await retry;
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
