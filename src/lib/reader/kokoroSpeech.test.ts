import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KokoroSpeech } from './kokoroSpeech';

let worker: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; onmessage?: (event: MessageEvent) => void };
let speech: KokoroSpeech;

beforeEach(() => {
  worker = { postMessage: vi.fn(), terminate: vi.fn() };
  vi.stubGlobal('Worker', vi.fn(function () { return worker; }));
  vi.stubGlobal('AudioContext', vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; }));
});
afterEach(() => { speech?.dispose(); vi.unstubAllGlobals(); });

it.each([
  ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)', 'iPhone', 5, true],
  ['iPhone Chrome', 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) CriOS/130', 'iPhone', 5, true],
  ['iPad desktop mode', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605.1', 'MacIntel', 5, true],
  ['Mac laptop', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/130', 'MacIntel', 0, false]
])('selects the safe model policy for %s', async (_name, userAgent, platform, maxTouchPoints, cpuOnly) => {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
  speech = new KokoroSpeech(() => {});
  const audio = speech.generate('Hello world.', 'af_heart', 1);
  worker.onmessage?.({ data: { id: 1, type: 'audio', samples: new Float32Array(1), sampleRate: 24000 } } as MessageEvent);
  await audio;
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ cpuOnly }));
});
