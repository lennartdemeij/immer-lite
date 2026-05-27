import type { StoredBookPosition } from './storage';
import type { ReaderSettings, TextAnnotation } from '../../types/reader';

const DB_NAME = 'pretext-reader';
const DB_VERSION = 1;
const META_STORE = 'meta';
const SETTINGS_STORE = 'settings';
const POSITIONS_STORE = 'positions';
const ANNOTATIONS_STORE = 'annotations';
const PUBLICATIONS_STORE = 'publications';

const LOCAL_STORAGE_SETTINGS_KEY = 'pretext-reader:settings';
const LOCAL_STORAGE_POSITIONS_KEY = 'pretext-reader:positions';
const LOCAL_STORAGE_ANNOTATIONS_KEY = 'pretext-reader:annotations';
const MIGRATION_META_KEY = 'storage-schema-version';

type StoreName =
  | typeof META_STORE
  | typeof SETTINGS_STORE
  | typeof POSITIONS_STORE
  | typeof ANNOTATIONS_STORE
  | typeof PUBLICATIONS_STORE;

interface MetaRecord {
  key: string;
  value: unknown;
}

interface SettingsRecord {
  key: 'active';
  value: ReaderSettings;
}

interface PublicationRecord {
  id: string;
  fingerprint: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  updatedAt: string;
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(POSITIONS_STORE)) {
        db.createObjectStore(POSITIONS_STORE, { keyPath: 'fingerprint' });
      }
      if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
        const store = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: 'id' });
        store.createIndex('byFingerprint', 'fingerprint', { unique: false });
      }
      if (!db.objectStoreNames.contains(PUBLICATIONS_STORE)) {
        const store = db.createObjectStore(PUBLICATIONS_STORE, { keyPath: 'id' });
        store.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
  });
}

async function withStore<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T> | T
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) {
    return null;
  }

  return new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let settled = false;

    transaction.oncomplete = () => {
      if (settled) {
        return;
      }
      settled = true;
      db.close();
      resolve(resultValue);
    };
    transaction.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      db.close();
      reject(transaction.error ?? new Error(`IndexedDB transaction failed for ${storeName}.`));
    };
    transaction.onabort = () => {
      if (settled) {
        return;
      }
      settled = true;
      db.close();
      reject(transaction.error ?? new Error(`IndexedDB transaction was aborted for ${storeName}.`));
    };

    let resultValue: T | null = null;

    Promise.resolve(work(store))
      .then((value) => {
        resultValue = value;
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        transaction.abort();
        reject(error);
      });
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

async function getMetaValue<T>(key: string): Promise<T | null> {
  const result = await withStore(META_STORE, 'readonly', async (store) => {
    const record = await requestToPromise(store.get(key));
    return (record as MetaRecord | undefined)?.value as T | undefined;
  });

  return (result as T | null) ?? null;
}

async function setMetaValue(key: string, value: unknown): Promise<void> {
  await withStore(META_STORE, 'readwrite', (store) =>
    requestToPromise(store.put({ key, value } satisfies MetaRecord))
  );
}

function readLocalStorageJson<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function migrateLegacyLocalStorageToIndexedDb(): Promise<void> {
  if (typeof window === 'undefined' || !canUseIndexedDb()) {
    return;
  }

  const schemaVersion = await getMetaValue<number>(MIGRATION_META_KEY);
  if (schemaVersion === DB_VERSION) {
    return;
  }

  const settings = readLocalStorageJson<ReaderSettings>(LOCAL_STORAGE_SETTINGS_KEY);
  const positions = readLocalStorageJson<StoredBookPosition[]>(LOCAL_STORAGE_POSITIONS_KEY) ?? [];
  const annotations = readLocalStorageJson<TextAnnotation[]>(LOCAL_STORAGE_ANNOTATIONS_KEY) ?? [];

  if (settings) {
    await writeSettingsToIndexedDb(settings);
  }

  if (positions.length > 0) {
    await withStore(POSITIONS_STORE, 'readwrite', async (store) => {
      for (const position of positions) {
        await requestToPromise(store.put(position));
      }
    });
  }

  if (annotations.length > 0) {
    await replaceAnnotationsInIndexedDb(annotations);
  }

  await setMetaValue(MIGRATION_META_KEY, DB_VERSION);
}

export async function readSettingsFromIndexedDb(): Promise<ReaderSettings | null> {
  const result = await withStore(SETTINGS_STORE, 'readonly', async (store) => {
    const record = await requestToPromise(store.get('active'));
    return (record as SettingsRecord | undefined)?.value ?? null;
  });

  return (result as ReaderSettings | null) ?? null;
}

export async function writeSettingsToIndexedDb(settings: ReaderSettings): Promise<void> {
  await withStore(SETTINGS_STORE, 'readwrite', (store) =>
    requestToPromise(store.put({ key: 'active', value: settings } satisfies SettingsRecord))
  );
}

export async function readPositionsFromIndexedDb(): Promise<StoredBookPosition[]> {
  const result = await withStore(POSITIONS_STORE, 'readonly', (store) =>
    requestToPromise(store.getAll())
  );

  return ((result as StoredBookPosition[] | null) ?? []).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export async function writePositionToIndexedDb(position: StoredBookPosition): Promise<void> {
  await withStore(POSITIONS_STORE, 'readwrite', (store) =>
    requestToPromise(store.put(position))
  );
}

export async function readAnnotationsFromIndexedDb(): Promise<TextAnnotation[]> {
  const result = await withStore(ANNOTATIONS_STORE, 'readonly', (store) =>
    requestToPromise(store.getAll())
  );

  return (result as TextAnnotation[] | null) ?? [];
}

export async function writeAnnotationToIndexedDb(annotation: TextAnnotation): Promise<void> {
  await withStore(ANNOTATIONS_STORE, 'readwrite', (store) =>
    requestToPromise(store.put(annotation))
  );
}

export async function deleteAnnotationFromIndexedDb(annotationId: string): Promise<void> {
  await withStore(ANNOTATIONS_STORE, 'readwrite', (store) =>
    requestToPromise(store.delete(annotationId))
  );
}

export async function replaceAnnotationsInIndexedDb(annotations: TextAnnotation[]): Promise<void> {
  await withStore(ANNOTATIONS_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.clear());
    for (const annotation of annotations) {
      await requestToPromise(store.put(annotation));
    }
  });
}

export async function savePublicationToIndexedDb(
  fingerprint: string,
  file: File
): Promise<void> {
  const record: PublicationRecord = {
    id: fingerprint,
    fingerprint,
    fileName: file.name,
    mimeType: file.type || 'application/epub+zip',
    blob: file,
    updatedAt: new Date().toISOString()
  };

  await withStore(PUBLICATIONS_STORE, 'readwrite', async (store) => {
    await requestToPromise(store.put(record));
    const allRecords = (await requestToPromise(store.getAll())) as PublicationRecord[];
    const staleRecords = allRecords
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(3);

    for (const staleRecord of staleRecords) {
      await requestToPromise(store.delete(staleRecord.id));
    }
  });
}

export async function readLatestPublicationFromIndexedDb(): Promise<File | null> {
  const records = await withStore(PUBLICATIONS_STORE, 'readonly', (store) =>
    requestToPromise(store.getAll())
  );

  const latest = ((records as PublicationRecord[] | null) ?? [])
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

  if (!latest) {
    return null;
  }

  return new File([latest.blob], latest.fileName, {
    type: latest.mimeType,
    lastModified: Date.parse(latest.updatedAt)
  });
}
