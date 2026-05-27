import type { ReaderAnchor, ReaderSettings, TextAnnotation } from '../../types/reader';
import {
  deleteAnnotationFromIndexedDb,
  migrateLegacyLocalStorageToIndexedDb,
  readAnnotationsFromIndexedDb,
  readLatestPublicationFromIndexedDb,
  readPositionsFromIndexedDb,
  readSettingsFromIndexedDb,
  replaceAnnotationsInIndexedDb,
  savePublicationToIndexedDb,
  writeAnnotationToIndexedDb,
  writePositionToIndexedDb,
  writeSettingsToIndexedDb
} from './indexedDb';

const SETTINGS_KEY = 'pretext-reader:settings';
const POSITION_KEY = 'pretext-reader:positions';
const ANNOTATIONS_KEY = 'pretext-reader:annotations';

export interface StoredBookPosition {
  fingerprint: string;
  title: string;
  anchor: ReaderAnchor;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 21,
  lineHeight: 1.72,
  horizontalPadding: 28,
  theme: 'light'
};

export function loadSettings(): ReaderSettings {
  const raw = window.localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(raw)
    } as ReaderSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ReaderSettings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  void writeSettingsToIndexedDb(settings);
}

export function loadStoredPosition(fingerprint: string): StoredBookPosition | null {
  const raw = window.localStorage.getItem(POSITION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const positions = JSON.parse(raw) as StoredBookPosition[];
    return positions.find((entry) => entry.fingerprint === fingerprint) ?? null;
  } catch {
    return null;
  }
}

export function saveStoredPosition(entry: StoredBookPosition): void {
  const raw = window.localStorage.getItem(POSITION_KEY);
  const positions = raw ? ((JSON.parse(raw) as StoredBookPosition[]) ?? []) : [];
  const next = [entry, ...positions.filter((item) => item.fingerprint !== entry.fingerprint)].slice(0, 12);
  window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  void writePositionToIndexedDb(entry);
}

function loadAllAnnotations(): TextAnnotation[] {
  const raw = window.localStorage.getItem(ANNOTATIONS_KEY);
  if (!raw) {
    return [];
  }

  try {
    return (JSON.parse(raw) as TextAnnotation[]) ?? [];
  } catch {
    return [];
  }
}

function saveAllAnnotations(annotations: TextAnnotation[]): void {
  window.localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
}

function sortBookAnnotations(annotations: TextAnnotation[]): TextAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.blockOrder !== right.blockOrder) {
      return left.blockOrder - right.blockOrder;
    }

    if (left.startOffset !== right.startOffset) {
      return left.startOffset - right.startOffset;
    }

    return left.endOffset - right.endOffset;
  });
}

export function loadAnnotations(fingerprint: string): TextAnnotation[] {
  return sortBookAnnotations(
    loadAllAnnotations().filter((annotation) => annotation.fingerprint === fingerprint)
  );
}

export function saveAnnotation(annotation: TextAnnotation): TextAnnotation[] {
  const annotations = loadAllAnnotations();
  const next = [
    ...annotations.filter((entry) => entry.id !== annotation.id),
    annotation
  ];
  saveAllAnnotations(next);
  void writeAnnotationToIndexedDb(annotation);
  return loadAnnotations(annotation.fingerprint);
}

export function deleteAnnotation(annotationId: string, fingerprint: string): TextAnnotation[] {
  const annotations = loadAllAnnotations().filter((entry) => entry.id !== annotationId);
  saveAllAnnotations(annotations);
  void deleteAnnotationFromIndexedDb(annotationId);
  return loadAnnotations(fingerprint);
}

export function replaceAllAnnotations(annotations: TextAnnotation[], fingerprint: string): TextAnnotation[] {
  saveAllAnnotations(annotations);
  void replaceAnnotationsInIndexedDb(annotations);
  return loadAnnotations(fingerprint);
}

export function getAllAnnotations(): TextAnnotation[] {
  return loadAllAnnotations();
}

export async function hydratePersistenceCaches(): Promise<{
  settings: ReaderSettings;
  positions: StoredBookPosition[];
  annotations: TextAnnotation[];
}> {
  await migrateLegacyLocalStorageToIndexedDb();

  const [settings, positions, annotations] = await Promise.all([
    readSettingsFromIndexedDb(),
    readPositionsFromIndexedDb(),
    readAnnotationsFromIndexedDb()
  ]);

  if (settings) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }
  if (positions.length > 0) {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(positions));
  }
  if (annotations.length > 0) {
    window.localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations));
  }

  return {
    settings: settings ?? loadSettings(),
    positions,
    annotations
  };
}

export async function saveOpenedPublication(file: File, fingerprint: string): Promise<void> {
  await savePublicationToIndexedDb(fingerprint, file);
}

export async function loadLatestStoredPublication(): Promise<File | null> {
  return readLatestPublicationFromIndexedDb();
}
