import type { ReaderPortion, TextAnnotation } from '../../types/reader';
import type { BookSection } from '../../types/book';

export type NavigatorMode = 'portions' | 'book' | 'chapters' | 'notes';
export interface NavigatorChapter {
  id: string;
  label: string;
  start: number;
  end: number;
  isPart?: boolean;
}
export interface NavigatorNote { annotation: TextAnnotation; index: number }
export interface NavigatorGroup extends NavigatorChapter {
  top: number;
  height: number;
  notes: Array<NavigatorNote & { y: number }>;
}

export function getNavigatorChapters(portions: ReaderPortion[], sections: BookSection[] = []): NavigatorChapter[] {
  const chapters: NavigatorChapter[] = [];
  const sectionKinds = new Map(sections.map(section => [section.id, section.navigationKind]));
  portions.forEach((portion, index) => {
    const previous = chapters.at(-1);
    if (previous?.id === portion.sectionId) previous.end = index;
    else {
      const kind = sectionKinds.get(portion.sectionId);
      chapters.push({ id: portion.sectionId, label: portion.sectionLabel, start: index, end: index,
        isPart: kind ? kind === 'part' : /^(?:part|book|deel|boek|teil|livre|parte)\b/i.test(portion.sectionLabel) });
    }
  });
  return chapters;
}

export function layoutNavigator(
  chapters: NavigatorChapter[], notes: NavigatorNote[], mode: NavigatorMode,
  viewportHeight: number, hasCover: boolean, labelHeights: ReadonlyMap<string, number> = new Map()
) {
  const coverHeight = hasCover && mode !== 'notes' ? 56 : 0;
  const sortedNotes = [...notes].sort((a, b) => a.index - b.index || a.annotation.startOffset - b.annotation.startOffset);
  const count = chapters.at(-1)?.end != null ? chapters.at(-1)!.end + 1 : 0;
  const space = Math.max(1, viewportHeight * (mode === 'book' ? 0.9 : 1) - coverHeight);
  const gap = mode === 'book' ? Math.min(3, space / Math.max(1, chapters.length * 4)) : mode === 'notes' ? 12 : 3;
  const bookHeight = Math.max(0, space - gap * Math.max(0, chapters.length - 1));
  const minimumHeight = (chapter: NavigatorChapter) => Math.max(44, labelHeights.get(chapter.id) ?? 0);
  let top = coverHeight;
  let visibleGroups = 0;
  const groups: NavigatorGroup[] = chapters.map((chapter) => {
    const chapterNotes = sortedNotes.filter(note => note.index >= chapter.start && note.index <= chapter.end);
    const visible = mode !== 'notes' || chapterNotes.length > 0;
    if (visible && visibleGroups++ > 0) top += gap;
    const portionCount = chapter.end - chapter.start + 1;
    const height = mode === 'book' ? bookHeight * portionCount / Math.max(1, count)
      : mode === 'chapters' ? minimumHeight(chapter) : mode === 'notes' ? chapterNotes.length * 40 : Math.max(minimumHeight(chapter), portionCount * 4);
    const group = { ...chapter, top, height, notes: chapterNotes.map((note, i) => ({ ...note,
      y: top + (mode === 'notes' ? i * 40 + 20 : (note.index - chapter.start + 0.5) / portionCount * height)
    })) };
    if (visible) top += height;
    return group;
  });
  return { groups, height: top, coverHeight };
}

export function navigatorPosition(groups: NavigatorGroup[], index: number, mode: NavigatorMode): number {
  if (mode === 'notes') {
    const notes = groups.flatMap(group => group.notes);
    return notes.reduce<(typeof notes)[number] | undefined>((closest, note) =>
      !closest || Math.abs(note.index - index) < Math.abs(closest.index - index) ? note : closest, undefined)?.y ?? 0;
  }
  const group = groups.find(group => index >= group.start && index <= group.end);
  return group ? group.top + (index - group.start + 0.5) / (group.end - group.start + 1) * group.height : 0;
}

export function navigatorIndexAt(groups: NavigatorGroup[], y: number, mode: NavigatorMode): number | null {
  if (mode === 'notes') {
    const notes = groups.flatMap(group => group.notes);
    return notes.reduce<(typeof notes)[number] | undefined>((closest, note) =>
      !closest || Math.abs(note.y - y) < Math.abs(closest.y - y) ? note : closest, undefined)?.index ?? null;
  }
  const visible = groups.filter(group => group.height > 0);
  const group = visible.find(group => y <= group.top + group.height) ?? visible.at(-1);
  if (!group) return null;
  const fraction = Math.min(0.999999, Math.max(0, (y - group.top) / group.height));
  return group.start + Math.floor(fraction * (group.end - group.start + 1));
}
