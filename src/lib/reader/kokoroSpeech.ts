export interface SpeechAudio {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

type WorkerReply = { id: number } & (
  | { type: 'audio'; samples: Float32Array<ArrayBuffer>; sampleRate: number }
  | { type: 'progress'; message: string }
  | { type: 'error'; message: string }
);

// Created only after an explicit Play with AI voice selected.
export class KokoroSpeech {
  private worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
  private context = new AudioContext();
  private source: AudioBufferSourceNode | null = null;
  private requestId = 0;
  private failure: Error | null = null;
  private pending = new Map<number, {
    resolve: (audio: SpeechAudio) => void;
    reject: (error: Error) => void;
  }>();
  private cache = new Map<string, Promise<SpeechAudio>>();

  constructor(private onProgress: (message: string) => void) {
    this.worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === 'progress') { this.onProgress(data.message); return; }
      if (data.type === 'error' && data.id === 0) { this.fail(new Error(data.message)); return; }
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.type === 'audio') request?.resolve({ samples: data.samples, sampleRate: data.sampleRate });
      else request?.reject(new Error(data.message));
    };
    this.worker.onerror = () => {
      this.fail(new Error('AI voice could not load. Try again or choose Built-in.'));
    };
  }

  private fail(error: Error) {
    this.failure = error;
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
    this.cache.clear();
  }

  async unlock() {
    // Resume synchronously from the Play gesture, before downloading or generating audio (Safari).
    await this.context.resume();
    const silence = this.context.createBufferSource();
    silence.buffer = this.context.createBuffer(1, 1, this.context.sampleRate);
    silence.connect(this.context.destination);
    silence.start();
  }

  generate(text: string, voice: string, speed: number): Promise<SpeechAudio> {
    if (this.failure) return Promise.reject(this.failure);
    const key = `${voice}:${speed}:${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const id = ++this.requestId;
    const result = new Promise<SpeechAudio>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, text, voice, speed });
    }).catch((error) => { this.cache.delete(key); throw error; });
    this.cache.set(key, result);
    // Keep only a few sentences, never the entire book's audio.
    if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  play(audio: SpeechAudio, rate: number, onEnd: () => void, offset = 0) {
    this.cancel();
    const buffer = this.context.createBuffer(1, audio.samples.length, audio.sampleRate);
    buffer.copyToChannel(audio.samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.context.destination);
    source.onended = () => { if (this.source === source) this.source = null; source.disconnect(); onEnd(); };
    this.source = source;
    source.start(0, offset);
    const startedAt = this.context.currentTime;
    return { duration: (buffer.duration - offset) / rate, elapsed: () => this.context.currentTime - startedAt };
  }

  cancel() {
    if (!this.source) return;
    this.source.onended = null;
    this.source.stop();
    this.source.disconnect();
    this.source = null;
  }

  dispose() {
    this.cancel();
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(new Error('AI reading stopped.')));
    this.pending.clear();
    this.cache.clear();
    void this.context.close();
  }
}
