import { describe, expect, it } from 'vitest';
import type { TextAnnotation } from '../../types/reader';
import { layoutNavigator, navigatorIndexAt, navigatorPosition, type NavigatorChapter } from './navigatorLayout';

const chapters: NavigatorChapter[] = [
  { id: 'a', label: 'One', start: 0, end: 899 },
  { id: 'b', label: 'Two', start: 900, end: 909 },
  { id: 'c', label: 'Three', start: 910, end: 999 }
];
const note = (id: string, index: number, startOffset = 0) => ({ index, annotation: { id, startOffset } as TextAnnotation });

describe('navigator zoom layouts', () => {
  it('fits the complete book and cover without dropping portions or chapter boundaries', () => {
    const layout = layoutNavigator(chapters, [], 'book', 600, true);
    expect(layout.height).toBeCloseTo(600);
    expect(layout.groups[1].top).toBeGreaterThan(layout.groups[0].top + layout.groups[0].height);
    for (const index of [0, 450, 899, 900, 909, 910, 999]) {
      const y = navigatorPosition(layout.groups, index, 'book');
      expect(y).toBeGreaterThanOrEqual(56);
      expect(y).toBeLessThan(600);
      expect(navigatorIndexAt(layout.groups, y, 'book')).toBe(index);
    }
  });

  it('gives every chapter a readable label row regardless of its length', () => {
    const layout = layoutNavigator(chapters, [], 'chapters', 100, false);
    expect(layout.groups.map(group => group.height)).toEqual([44, 44, 44]);
    expect(layout.height).toBeGreaterThan(100);
  });

  it('sizes note chapters by their labels and keeps same-portion notes separate', () => {
    const layout = layoutNavigator(chapters, [note('later', 920), note('two', 3, 20), note('one', 3)], 'notes', 600, true);
    expect(layout.coverHeight).toBe(0);
    expect(layout.groups.map(group => group.height)).toEqual([80, 0, 40]);
    expect(layout.height).toBe(132);
    const notes = layout.groups.flatMap(group => group.notes);
    expect(notes.map(note => note.annotation.id)).toEqual(['one', 'two', 'later']);
    expect(notes[1].y - notes[0].y).toBe(40);
    expect(navigatorIndexAt(layout.groups, notes[2].y, 'notes')).toBe(920);
  });

  it('handles books without notes and empty loading layouts', () => {
    const notes = layoutNavigator(chapters, [], 'notes', 600, true);
    expect(notes.height).toBe(0);
    expect(navigatorIndexAt(notes.groups, 10, 'notes')).toBeNull();
    expect(navigatorPosition(notes.groups, 0, 'notes')).toBe(0);
    expect(navigatorIndexAt([], 10, 'book')).toBeNull();
  });
});
