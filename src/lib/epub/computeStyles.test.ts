import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('finishes EPUB style loading when the hidden frame receives no animation frames', async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
    const result = append(node);
    if (node instanceof HTMLIFrameElement && node.contentWindow) {
      node.contentWindow.requestAnimationFrame = vi.fn();
    }
    return result;
  });
  const { annotateDocumentWithComputedStyles, readComputedStyleSnapshot } = await import('./computeStyles');
  const doc = new DOMParser().parseFromString('<html><body><p>A sentence.</p></body></html>', 'text/html');
  const loaded = vi.fn();
  const pending = annotateDocumentWithComputedStyles(doc, []).then(loaded);
  await vi.advanceTimersByTimeAsync(1000);
  expect(loaded).toHaveBeenCalledWith(true);
  await pending;
  expect(readComputedStyleSnapshot(doc.querySelector('p')!)).toBeDefined();
});
