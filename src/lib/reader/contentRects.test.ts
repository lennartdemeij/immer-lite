import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureRangeRectSnapshots } from './contentRects';

const originalRangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalRangeRects) {
    Object.defineProperty(Range.prototype, 'getClientRects', originalRangeRects);
  } else {
    Reflect.deleteProperty(Range.prototype, 'getClientRects');
  }
  document.body.replaceChildren();
});

describe('captureRangeRectSnapshots', () => {
  it('draws each selected line once even when the range includes nested element boxes', () => {
    const scope = document.createElement('div');
    scope.innerHTML = '<div><span>first </span><span><em>line</em></span></div><div><span>second line</span></div>';
    document.body.append(scope);
    vi.spyOn(scope, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100));
    const nodes: Node[] = [scope.querySelector('span')!.firstChild!, scope.querySelector('em')!.firstChild!, scope.lastElementChild!.firstChild!.firstChild!];
    const boxes = [new DOMRect(10, 10, 30, 20), new DOMRect(40, 10, 20, 20), new DOMRect(10, 40, 70, 20)];
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(function (this: Range) {
      const index = nodes.indexOf(this.startContainer);
      return (this.startContainer === this.endContainer && index >= 0
        ? [boxes[index]]
        : [new DOMRect(10, 10, 50, 20), ...boxes]) as unknown as DOMRectList;
    });
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    range.setEnd(nodes[2], 11);
    expect(captureRangeRectSnapshots(range, scope)).toEqual([
      { x: 5, y: 10, width: 25, height: 20 },
      { x: 5, y: 40, width: 35, height: 20 }
    ]);
  });
});
