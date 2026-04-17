import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { loadEpubBook, revokeBookResources } from '../lib/epub/loadEpub';
import { paginateBook } from '../lib/portioning/paginateBook';
import { loadSettings, loadStoredPosition, saveSettings, saveStoredPosition, DEFAULT_SETTINGS } from '../lib/persistence/storage';
import {
  clampAnchorToBook,
  getInitialAnchor,
  getPreferredStartAnchor,
  preserveAnchorAfterRepagination
} from '../lib/reader/anchors';
import type { CanonicalBook } from '../types/book';
import type { PaginationResult, ReaderAnchor, ReaderSettings } from '../types/reader';
import { UploadScreen } from './components/UploadScreen';
import { ReaderScreen } from './components/ReaderScreen';
import { useReaderViewport } from './hooks/useReaderViewport';
import defaultBookUrl from '../../book.epub?url';

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
};

function isMobileFullscreenTarget(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrowViewport = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
  return coarsePointer || narrowViewport;
}

function isAlreadyFullscreen(): boolean {
  const fullscreenDocument = document as FullscreenDocument;
  const standaloneMatch = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  return Boolean(
    document.fullscreenElement ||
      fullscreenDocument.webkitFullscreenElement ||
      standaloneMatch
  );
}

async function requestFullscreenIfPossible(): Promise<boolean> {
  if (!isMobileFullscreenTarget() || isAlreadyFullscreen()) {
    return true;
  }

  const target = document.documentElement as FullscreenElement;
  if (typeof target.requestFullscreen === 'function') {
    await target.requestFullscreen();
    return true;
  }

  if (typeof target.webkitRequestFullscreen === 'function') {
    await target.webkitRequestFullscreen();
    return true;
  }

  return false;
}

function getDefaultBookCandidates(): string[] {
  const candidates = [
    defaultBookUrl,
    `${import.meta.env.BASE_URL}book.epub`
  ].filter(Boolean);

  return Array.from(new Set(candidates));
}

export function App() {
  const [book, setBook] = useState<CanonicalBook | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    typeof window === 'undefined' ? DEFAULT_SETTINGS : loadSettings()
  );
  const deferredSettings = useDeferredValue(settings);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [repaginating, setRepaginating] = useState(false);
  const [pagination, setPagination] = useState<PaginationResult>({ portions: [] });
  const [currentIndex, setCurrentIndex] = useState(0);
  const anchorRef = useRef<ReaderAnchor | null>(null);
  const previousBookRef = useRef<CanonicalBook | null>(null);
  const defaultLoadAttemptedRef = useRef(false);
  const fullscreenBoundRef = useRef(false);

  const { containerRef, viewport } = useReaderViewport(settings.horizontalPadding);
  const currentPortion = pagination.portions[currentIndex] ?? null;

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    return () => revokeBookResources(previousBookRef.current);
  }, []);

  useEffect(() => {
    if (fullscreenBoundRef.current || !isMobileFullscreenTarget()) {
      return;
    }

    fullscreenBoundRef.current = true;

    const handleFirstGesture = () => {
      void requestFullscreenIfPossible()
        .catch(() => {
          return;
        })
        .finally(() => {
          if (isAlreadyFullscreen()) {
            window.removeEventListener('pointerdown', handleFirstGesture, true);
            window.removeEventListener('keydown', handleFirstGesture, true);
          }
        });
    };

    window.addEventListener('pointerdown', handleFirstGesture, true);
    window.addEventListener('keydown', handleFirstGesture, true);

    return () => {
      window.removeEventListener('pointerdown', handleFirstGesture, true);
      window.removeEventListener('keydown', handleFirstGesture, true);
      fullscreenBoundRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!book || !viewport) {
      return;
    }

    const desiredAnchor =
      anchorRef.current != null ? clampAnchorToBook(book, anchorRef.current) : getInitialAnchor(book);
    let cancelled = false;
    setRepaginating(true);

    paginateBook(book, viewport, deferredSettings, desiredAnchor)
      .then((result) => {
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setPagination(result);
          setCurrentIndex(preserveAnchorAfterRepagination(result.portions, desiredAnchor));
        });
      })
      .catch((paginationError) => {
        if (cancelled) {
          return;
        }
        setError(
          paginationError instanceof Error
            ? paginationError.message
            : 'Pagination failed.'
        );
      })
      .finally(() => {
        if (!cancelled) {
          setRepaginating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [book, deferredSettings, viewport]);

  useEffect(() => {
    if (!book || !currentPortion) {
      return;
    }

    anchorRef.current = currentPortion.start;
    saveStoredPosition({
      fingerprint: book.fingerprint,
      title: book.metadata.title,
      anchor: currentPortion.start,
      updatedAt: new Date().toISOString()
    });
  }, [book, currentPortion]);

  const canGoPrevious = currentIndex > 0;
  const canGoNext = currentIndex < pagination.portions.length - 1;

  async function openBookFile(file: File) {
    setError(null);
    setUploading(true);

    try {
      const loaded = await loadEpubBook(file);
      const stored = loadStoredPosition(loaded.fingerprint);
      revokeBookResources(previousBookRef.current);
      previousBookRef.current = loaded;
      anchorRef.current = stored?.anchor ?? getPreferredStartAnchor(loaded);
      setCurrentIndex(0);
      setPagination({ portions: [] });
      setBook(loaded);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not open the EPUB.'
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleFileSelected(file: File) {
    await openBookFile(file);
  }

  useEffect(() => {
    if (book || defaultLoadAttemptedRef.current) {
      return;
    }

    defaultLoadAttemptedRef.current = true;

    const loadDefaultBook = async () => {
      setUploading(true);
      const candidates = getDefaultBookCandidates();
      let lastError: Error | null = null;

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate);
          if (!response.ok) {
            throw new Error(`Default EPUB could not be loaded (${response.status}) from ${candidate}.`);
          }

          const blob = await response.blob();
          await openBookFile(
            new File([blob], 'book.epub', {
              type: blob.type || 'application/epub+zip'
            })
          );
          return;
        } catch (loadError) {
          lastError =
            loadError instanceof Error
              ? loadError
              : new Error('Could not open the default EPUB.');
        }
      }

      setUploading(false);
      setError(lastError?.message ?? 'Could not open the default EPUB.');
    };

    void loadDefaultBook();
  }, [book]);

  const portionCount = pagination.portions.length;
  const appBusy = uploading || repaginating;
  const progressMeta = useMemo(() => {
    if (!book || !currentPortion) {
      return null;
    }

    return `${currentPortion.sectionLabel} • ${book.metadata.title}`;
  }, [book, currentPortion]);

  return (
    <div className="app-shell">
      {book ? (
        <>
          <ReaderScreen
            book={book}
            viewport={viewport}
            portions={pagination.portions}
            portion={currentPortion}
            previousPortion={currentIndex > 0 ? pagination.portions[currentIndex - 1] : null}
            nextPortion={
              currentIndex < pagination.portions.length - 1
                ? pagination.portions[currentIndex + 1]
                : null
            }
            portionCount={portionCount}
            portionIndex={currentIndex}
            settings={settings}
            onSettingsChange={setSettings}
            onFileSelected={handleFileSelected}
            onPrevious={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            onNext={() =>
              setCurrentIndex((index) =>
                Math.min(pagination.portions.length - 1, index + 1)
              )
            }
            onJumpToPortion={(index) =>
              setCurrentIndex(
                Math.max(0, Math.min(pagination.portions.length - 1, index))
              )
            }
            containerRef={containerRef}
          />
          {error ? <div className="floating-error">{error}</div> : null}
          {progressMeta ? <div className="sr-only">{progressMeta}</div> : null}
        </>
      ) : (
        <div ref={containerRef} className="reader-shell theme-light upload-root">
          <UploadScreen onFileSelected={handleFileSelected} busy={appBusy} error={error} />
        </div>
      )}

      {!book && (
        <div className="upload-action-strip">
          <button type="button" onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset reader defaults
          </button>
        </div>
      )}

      {book && !canGoPrevious ? <div className="edge-hint top">Start of book</div> : null}
      {book && !canGoNext ? <div className="edge-hint bottom">End of book</div> : null}
    </div>
  );
}
