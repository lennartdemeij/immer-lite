import { describe, expect, it, vi } from 'vitest';
import { ReadableStream } from 'node:stream/web';
import { installStreamIterator } from './streamIteration';

function safariStream() {
  class SafariStream extends ReadableStream<unknown> {}
  Object.defineProperty(SafariStream.prototype, Symbol.asyncIterator, { value: undefined, configurable: true });
  installStreamIterator(SafariStream.prototype);
  return SafariStream;
}

describe('Safari stream iteration used by Phonemizer', () => {
  it('reads the complete decompressed dictionary and releases its lock', async () => {
    const Stream = safariStream();
    const stream = new Stream({ start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3]));
      controller.close();
    } });
    const bytes: number[] = [];
    for await (const part of stream) bytes.push(...part as Uint8Array);
    expect(bytes).toEqual([1, 2, 3]);
    expect(stream.locked).toBe(false);
  });

  it('cancels and releases an unfinished stream when iteration stops', async () => {
    const Stream = safariStream();
    const cancel = vi.fn();
    const stream = new Stream({ start(controller) { controller.enqueue('chunk'); }, cancel });
    for await (const _ of stream) break;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('preserves native browser implementations', () => {
    const iterator = vi.fn();
    const prototype = { [Symbol.asyncIterator]: iterator };
    installStreamIterator(prototype);
    expect(prototype[Symbol.asyncIterator]).toBe(iterator);
  });
});
