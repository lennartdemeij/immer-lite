import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ load: vi.fn(), generate: vi.fn() }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: runtime.load } }));
vi.mock('@huggingface/transformers', () => ({ env: { backends: { onnx: { wasm: {} } } } }));
let messages: ReturnType<typeof vi.fn>;
let requestAdapter: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.generate.mockResolvedValue({ audio: new Float32Array(24000) });
  runtime.load.mockResolvedValue({ generate: runtime.generate });
  messages = vi.fn();
  vi.stubGlobal('postMessage', messages);
  requestAdapter = vi.fn().mockResolvedValue({});
  vi.stubGlobal('navigator', { gpu: { requestAdapter } });
  await import('./kokoro.worker');
});
afterEach(() => vi.unstubAllGlobals());

async function generate(id = 1, text = 'Hello world.', type = 'audio') {
  self.onmessage?.call(self, { data: { id, text, voice: 'am_echo', speed: 1 } } as MessageEvent);
  await vi.waitFor(() => expect(messages.mock.calls.some(([reply]) => reply.id === id && reply.type === type && reply.final !== false)).toBe(true));
}

it('always uses the compact model, even when WebGPU is available, with Echo', async () => {
  await generate();
  expect(requestAdapter).not.toHaveBeenCalled();
  expect(runtime.load).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ device: 'wasm', dtype: 'q8' }));
  expect(runtime.generate).toHaveBeenCalledWith('Hello world.', { voice: 'am_echo', speed: 1 });
});

it('reuses the loaded model for subsequent sentences', async () => {
  await generate();
  await generate(2, 'Next sentence.');
  expect(runtime.load).toHaveBeenCalledOnce();
  expect(runtime.generate).toHaveBeenCalledTimes(2);
});

it('delivers the beginning of a long sentence while its remaining audio is still generating', async () => {
  let finish!: (audio: { audio: Float32Array }) => void;
  const remaining = new Promise<{ audio: Float32Array }>(resolve => { finish = resolve; });
  runtime.generate.mockResolvedValueOnce({ audio: new Float32Array(24000) }).mockReturnValue(remaining);
  self.onmessage?.call(self, { data: { id: 1, text: 'A long sentence with many words '.repeat(20), voice: 'am_echo', speed: 1 } } as MessageEvent);
  try {
    await vi.waitFor(() => expect(messages.mock.calls.some(([reply]) => reply.type === 'audio')).toBe(true), { timeout: 100 });
  } finally {
    finish({ audio: new Float32Array(24000) });
    await vi.waitFor(() => expect(messages.mock.calls.some(([reply]) => reply.type === 'audio' && reply.final !== false)).toBe(true));
  }
});

it('retries model initialization after a failed download', async () => {
  runtime.load.mockRejectedValueOnce(new Error('Network error'));
  await generate(1, 'Hello world.', 'error');
  await generate(2);
  expect(runtime.load).toHaveBeenCalledTimes(2);
});

it('a failed sentence does not block subsequent generation', async () => {
  runtime.generate.mockRejectedValueOnce(new Error('Inference failed'));
  await generate(1, 'Hello world.', 'error');
  await generate(2);
  expect(runtime.load).toHaveBeenCalledOnce();
});

it('preserves all text and audio when a sentence exceeds the model context', async () => {
  const text = 'A long sentence with many words '.repeat(30);
  await generate(1, text);
  expect(runtime.generate.mock.calls.map(([part]) => part).join('')).toBe(text);
  const replies = messages.mock.calls.filter(([reply]) => reply.type === 'audio').map(([reply]) => reply);
  expect(replies.reduce((sum, reply) => sum + reply.samples.length, 0)).toBe(runtime.generate.mock.calls.length * 24000);
  expect(replies[0].charStart).toBe(0);
  expect(replies.at(-1).charEnd).toBe(text.length);
  expect(replies.slice(1).every((reply, index) => reply.charStart === replies[index].charEnd)).toBe(true);
});
