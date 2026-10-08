import './streamIteration';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// GitHub Pages and iOS do not provide cross-origin isolation; use a single WASM thread.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.allowLocalModels = false;

let model: Promise<KokoroTTS> | null = null;
let queue = Promise.resolve();
let backend: 'wasm' | 'webgpu' = 'wasm';

async function loadModel(id: number, cpuOnly = false): Promise<KokoroTTS> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const adapter = !cpuOnly && gpu ? await gpu.requestAdapter().catch(() => null) : null;
  backend = adapter ? 'webgpu' : 'wasm';
  self.postMessage({ id, type: 'progress', message: 'Preparing AI voice…' });
  try {
    return await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      // Kokoro recommends fp32 for GPU inference; retain the small q8 CPU fallback.
      dtype: backend === 'webgpu' ? 'fp32' : 'q8', device: backend,
      progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
        if (!progress.file?.endsWith('.onnx')) return;
        if (progress.status === 'initiate') self.postMessage({ id, type: 'progress', message: 'Downloading AI voice…' });
        if (progress.status === 'progress') self.postMessage({ id, type: 'progress',
          message: `Downloading AI voice… ${Math.round(progress.progress ?? 0)}%` });
      }
    });
  } catch (error) {
    if (backend === 'webgpu') return loadModel(id, true);
    model = null;
    throw error;
  }
}

async function generate(tts: KokoroTTS, text: string, voice: 'af_heart' | 'bf_emma', speed: number) {
  // Kokoro truncates beyond its context window. Keep every word in long sentences.
  const parts = text.match(/.{1,300}(?:\s|$)|\S+/gs) ?? [text];
  const recordings: Float32Array[] = [];
  for (const part of parts) recordings.push((await tts.generate(part, { voice, speed })).audio);
  const samples = new Float32Array(recordings.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const recording of recordings) { samples.set(recording, offset); offset += recording.length; }
  return samples;
}

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; voice: 'af_heart' | 'bf_emma'; speed: number; cpuOnly?: boolean }>) => {
  // Serialize inference while playback consumes the rolling sentence buffer.
  queue = queue.then(async () => {
    const { id, text, voice, speed } = data;
    try {
      if (!model) model = loadModel(id, data.cpuOnly);
      const tts = await model;
      let samples: Float32Array;
      try {
        samples = await generate(tts, text, voice, speed);
      } catch (error) {
        if (backend !== 'webgpu') throw error;
        // A GPU may be available but fail on this model/device. Retry safely on CPU.
        await tts.model.dispose().catch(() => {});
        model = loadModel(id, true);
        samples = await generate(await model, text, voice, speed);
      }
      self.postMessage({ id, type: 'audio', samples, sampleRate: 24000 },
        { transfer: [samples.buffer] });
    } catch {
      self.postMessage({ id: data.id, type: 'error',
        message: 'AI voice could not generate speech. Check your connection, then try again or choose Built-in.' });
    }
  });
};

// Some dependency initialization happens outside the request's try/catch.
self.addEventListener('unhandledrejection', () => self.postMessage({ id: 0, type: 'error',
  message: 'AI voice could not initialize. Try again or choose Built-in.' }));
