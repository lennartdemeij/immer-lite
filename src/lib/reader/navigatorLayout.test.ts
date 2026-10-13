import { describe, expect, it } from 'vitest';
import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import type { BookSection } from '../../types/book';
import { getNavigatorChapters, layoutNavigator, navigatorIndexAt, navigatorPosition, type NavigatorChapter } from './navigatorLayout';

const chapters: NavigatorChapter[] = [
  { id: 'a', label: 'One', start: 0, end: 899 },
  { id: 'b', label: 'Two', start: 900, end: 909 },
  { id: 'c', label: 'Three', start: 910, end: 999 }
];
const note = (id: string, index: number, startOffset = 0) => ({ index, annotation: { id, startOffset } as TextAnnotation });

describe('navigator zoom layouts', () => {
  it('fits the complete book and cover without dropping portions or chapter boundaries', () => {
    const layout = layoutNavigator(chapters, [], 'book', 600, true);
    expect(layout.height).toBeLessThanOrEqual(540);
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

  it('reserves the measured label height for short parts and chapters in portions and chapters modes', () => {
    const groups = [
      { id: 'part', label: 'Part One', start: 0, end: 0 },
      { id: 'chapter', label: 'Chapter One', start: 1, end: 20 }
    ];
    for (const mode of ['portions', 'chapters'] as const) {
      const layout = layoutNavigator(groups, [], mode, 100, false, new Map([['part', 60], ['chapter', 52]]));
      expect(layout.groups[0].height).toBeGreaterThanOrEqual(60);
      expect(layout.groups[1].height).toBeGreaterThanOrEqual(52);
      expect(layout.groups[1].top).toBeGreaterThanOrEqual(layout.groups[0].height);
      for (const index of [0, 1, 10, 20]) {
        expect(navigatorIndexAt(layout.groups, navigatorPosition(layout.groups, index, mode), mode)).toBe(index);
      }
    }
  });

  it('keeps the complete book overview within its viewport even with oversized labels', () => {
    const layout = layoutNavigator(chapters, [], 'book', 100, false, new Map(chapters.map(chapter => [chapter.id, 120])));
    expect(layout.height).toBeLessThanOrEqual(90);
    expect(layout.groups[1].height).toBeLessThan(44);
    expect(layout.groups[0].height / layout.groups[1].height).toBeCloseTo(90);
  });

  it('recognizes parts from source metadata even when their title does not name the part', () => {
    const portions = [
      { sectionId: 'part', sectionLabel: 'The Coming of the Martians' },
      { sectionId: 'chapter', sectionLabel: 'Book of Stories' }
    ] as ReaderPortion[];
    const sections = [
      { id: 'part', navigationKind: 'part' }, { id: 'chapter', navigationKind: 'chapter' }
    ] as BookSection[];
    expect(getNavigatorChapters(portions, sections).map(chapter => chapter.isPart)).toEqual([true, false]);
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
