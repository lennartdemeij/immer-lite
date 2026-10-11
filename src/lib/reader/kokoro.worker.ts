import './streamIteration';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// GitHub Pages and iOS do not provide cross-origin isolation; use a single WASM thread.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.allowLocalModels = false;

let model: Promise<KokoroTTS> | null = null;
let queue = Promise.resolve();

async function loadModel(id: number): Promise<KokoroTTS> {
  self.postMessage({ id, type: 'progress', message: 'Preparing AI voice…' });
  try {
    return await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8', device: 'wasm',
      progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
        if (!progress.file?.endsWith('.onnx')) return;
        if (progress.status === 'initiate') self.postMessage({ id, type: 'progress', message: 'Downloading AI voice…' });
        if (progress.status === 'progress') self.postMessage({ id, type: 'progress',
          message: `Downloading AI voice… ${Math.round(progress.progress ?? 0)}%` });
      }
    });
  } catch (error) {
    model = null;
    throw error;
  }
}

async function generate(tts: KokoroTTS, id: number, text: string, voice: 'am_echo', speed: number) {
  // Deliver bounded pieces immediately, rather than waiting for a whole long sentence.
  // Preserve exact text offsets so highlighting still follows the original sentence.
  const parts = text.match(/.{60,160}?[,;:—]\s+|.{1,160}(?:\s|$)|\S+/gs) ?? [text];
  let charStart = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const samples = new Float32Array((await tts.generate(part, { voice, speed })).audio);
    const charEnd = charStart + part.length;
    self.postMessage({ id, type: 'audio', samples, sampleRate: 24000,
      charStart, charEnd, final: index === parts.length - 1 }, { transfer: [samples.buffer] });
    charStart = charEnd;
  }
}

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; voice: 'am_echo'; speed: number }>) => {
  // Serialize inference while playback consumes the rolling sentence buffer.
  queue = queue.then(async () => {
    const { id, text, voice, speed } = data;
    try {
      if (!model) model = loadModel(id);
      const tts = await model;
      await generate(tts, id, text, voice, speed);
    } catch {
      self.postMessage({ id: data.id, type: 'error',
        message: 'AI voice could not generate speech. Check your connection, then try again or choose Built-in.' });
    }
  });
};

// Some dependency initialization happens outside the request's try/catch.
self.addEventListener('unhandledrejection', () => self.postMessage({ id: 0, type: 'error',
  message: 'AI voice could not initialize. Try again or choose Built-in.' }));
