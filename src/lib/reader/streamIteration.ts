// Phonemizer iterates its decompressed dictionary stream during import.
// Safari lacks this iterator, leaving its initialization promise unresolved.
export function installStreamIterator(prototype: object = ReadableStream.prototype) {
  if (typeof Reflect.get(prototype, Symbol.asyncIterator) === 'function') return;
  Object.defineProperty(prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream, options?: { preventCancel?: boolean }) {
      const reader = this.getReader();
      let finished = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { finished = true; return; }
          yield value;
        }
      } finally {
        try { if (!finished && !options?.preventCancel) await reader.cancel(); }
        finally { reader.releaseLock(); }
      }
    }
  });
}

installStreamIterator();
