import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ load: vi.fn(), generate: vi.fn(), dispose: vi.fn() }));
vi.mock('kokoro-js', () => ({ KokoroTTS: { from_pretrained: runtime.load } }));
vi.mock('@huggingface/transformers', () => ({ env: { backends: { onnx: { wasm: {} } } } }));
let messages: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  runtime.generate.mockResolvedValue({ audio: new Float32Array(24000) });
  runtime.dispose.mockResolvedValue(undefined);
  runtime.load.mockResolvedValue({ generate: runtime.generate, model: { dispose: runtime.dispose } });
  messages = vi.fn();
  vi.stubGlobal('postMessage', messages);
  vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue({}) } });
  await import('./kokoro.worker');
});
afterEach(() => vi.unstubAllGlobals());

async function generate() {
  self.onmessage?.call(self, { data: { id: 1, text: 'Hello world.', voice: 'af_heart', speed: 1 } } as MessageEvent);
  await vi.waitFor(() => expect(messages).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1, type: 'audio' }), expect.anything()
  ));
}

it('uses GPU inference when an adapter is available', async () => {
  await generate();
  expect(runtime.load).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ device: 'webgpu', dtype: 'fp32' }));
});

it('uses the small CPU model when WebGPU is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  await generate();
  expect(runtime.load).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ device: 'wasm', dtype: 'q8' }));
});

it('falls back to CPU if the GPU model cannot initialize', async () => {
  runtime.load.mockRejectedValueOnce(new Error('Unsupported GPU'));
  await generate();
  expect(runtime.load).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ device: 'wasm', dtype: 'q8' }));
});

it('falls back to CPU if GPU inference fails', async () => {
  runtime.generate.mockRejectedValueOnce(new Error('GPU lost'));
  await generate();
  expect(runtime.load).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ device: 'wasm', dtype: 'q8' }));
  expect(runtime.dispose).toHaveBeenCalledOnce();
});
