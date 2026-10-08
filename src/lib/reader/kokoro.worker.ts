import './streamIteration';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// GitHub Pages and iOS do not provide cross-origin isolation; use a single WASM thread.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.allowLocalModels = false;

let model: Promise<KokoroTTS> | null = null;
let queue = Promise.resolve();

self.onmessage = ({ data }: MessageEvent<{ id: number; text: string; voice: 'af_heart' | 'bf_emma'; speed: number }>) => {
  // Serialize inference, including one sentence prepared ahead of playback.
  queue = queue.then(async () => {
    const { id, text, voice, speed } = data;
    try {
      const loading = !model;
      if (!model) {
        model = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
          dtype: 'q8', device: 'wasm',
          progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
            if (progress.status === 'initiate' && progress.file?.endsWith('.onnx')) {
              self.postMessage({ id, type: 'progress', message: 'Downloading AI voice…' });
            }
            if (progress.status === 'progress' && progress.file?.endsWith('.onnx')) self.postMessage({ id, type: 'progress',
              message: `Downloading AI voice… ${Math.round(progress.progress ?? 0)}%` });
          }
        }).catch((error) => { model = null; throw error; });
      }
      const tts = await model;
      if (loading) self.postMessage({ id, type: 'progress', message: 'Preparing AI voice…' });
      // Kokoro truncates beyond its context window. Split exceptionally long
      // sentences at word boundaries so all text is spoken, then join their audio.
      const parts = text.match(/.{1,300}(?:\s|$)|\S+/gs) ?? [text];
      const recordings: Float32Array[] = [];
      for (const part of parts) {
        const audio = await tts.generate(part, { voice, speed });
        recordings.push(audio.audio);
      }
      const samples = new Float32Array(recordings.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const recording of recordings) { samples.set(recording, offset); offset += recording.length; }
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
