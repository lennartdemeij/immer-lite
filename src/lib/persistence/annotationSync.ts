import type { TextAnnotation } from '../../types/reader';

const JSONHOSTING_ID = import.meta.env.VITE_JSONHOSTING_ID || 'ee853aad';
const JSONHOSTING_EDIT_KEY =
  import.meta.env.VITE_JSONHOSTING_EDIT_KEY ||
  '4f120cd366bedf4add34d471966f76b5dfaf4c22cb262dd955d18e28bf717f3a';
const JSONHOSTING_API_URL = `https://jsonhosting.com/api/json/${JSONHOSTING_ID}`;
const JSONHOSTING_RAW_URL = `${JSONHOSTING_API_URL}/raw`;

interface RemoteAnnotationStore {
  schemaVersion: 1;
  updatedAt: string;
  annotations: TextAnnotation[];
}

function sortAnnotations(annotations: TextAnnotation[]): TextAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.fingerprint !== right.fingerprint) {
      return left.fingerprint.localeCompare(right.fingerprint);
    }

    if (left.blockOrder !== right.blockOrder) {
      return left.blockOrder - right.blockOrder;
    }

    if (left.startOffset !== right.startOffset) {
      return left.startOffset - right.startOffset;
    }

    return left.endOffset - right.endOffset;
  });
}

export function mergeAnnotations(
  localAnnotations: TextAnnotation[],
  remoteAnnotations: TextAnnotation[]
): TextAnnotation[] {
  const byId = new Map<string, TextAnnotation>();

  [...remoteAnnotations, ...localAnnotations].forEach((annotation) => {
    const existing = byId.get(annotation.id);
    if (!existing || annotation.updatedAt >= existing.updatedAt) {
      byId.set(annotation.id, annotation);
    }
  });

  return sortAnnotations(Array.from(byId.values()));
}

function parseRemoteStore(content: Partial<RemoteAnnotationStore>): RemoteAnnotationStore {
  const annotations = Array.isArray(content.annotations)
    ? content.annotations.filter((annotation): annotation is TextAnnotation =>
        Boolean(
          annotation &&
            typeof annotation.id === 'string' &&
            typeof annotation.fingerprint === 'string' &&
            typeof annotation.blockId === 'string' &&
            typeof annotation.selectedText === 'string' &&
            typeof annotation.note === 'string'
        )
      )
    : [];

  return {
    schemaVersion: 1,
    updatedAt: typeof content.updatedAt === 'string' ? content.updatedAt : new Date().toISOString(),
    annotations
  };
}

export async function fetchRemoteAnnotations(): Promise<TextAnnotation[]> {
  // JSONHosting only sends browser CORS headers on the raw endpoint.
  const response = await fetch(JSONHOSTING_RAW_URL, {
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Could not fetch annotations (${response.status}).`);
  }

  const payload = (await response.json()) as Partial<RemoteAnnotationStore>;
  return parseRemoteStore(payload).annotations;
}

export async function pushRemoteAnnotations(annotations: TextAnnotation[]): Promise<TextAnnotation[]> {
  const store: RemoteAnnotationStore = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    annotations: sortAnnotations(annotations)
  };

  const response = await fetch(JSONHOSTING_API_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      editKey: JSONHOSTING_EDIT_KEY,
      data: store
    })
  });

  if (!response.ok) {
    throw new Error(`Could not sync annotations (${response.status}).`);
  }

  return store.annotations;
}
