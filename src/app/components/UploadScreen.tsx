import { useMemo, useRef, useState } from 'react';

interface UploadScreenProps {
  onFileSelected: (file: File) => void;
  busy: boolean;
  error?: string | null;
}

export function UploadScreen({
  onFileSelected,
  busy,
  error
}: UploadScreenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const detail = useMemo(
    () =>
      busy
        ? 'Parsing the EPUB locally, normalizing the markup, and building sentence-safe portions.'
        : 'Drop a local EPUB here or browse for a file. Nothing leaves the browser.',
    [busy]
  );

  function acceptFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) {
      return;
    }
    onFileSelected(file);
  }

  return (
    <main className="upload-shell">
      <div className="upload-backdrop" />
      <section className="upload-card">
        <p className="eyebrow">Immer Lite</p>
        <h1>Modern vertical reading, portioned for the actual viewport.</h1>
        <p className="upload-copy">
          This reader ingests a local EPUB, reinterprets the markup into a clean
          house style, and paginates it into full-screen vertical portions using
          Pretext measurements and sentence-safe boundaries.
        </p>

        <button
          type="button"
          className={`dropzone ${dragActive ? 'drag-active' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            acceptFile(event.dataTransfer.files);
          }}
          disabled={busy}
        >
          <span className="dropzone-title">
            {busy ? 'Building the reader view…' : 'Upload a local `.epub`'}
          </span>
          <span className="dropzone-detail">{detail}</span>
          <span className="dropzone-cta">
            {busy ? 'Working locally' : 'Choose file or drag and drop'}
          </span>
        </button>

        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".epub,application/epub+zip"
          onChange={(event) => acceptFile(event.target.files)}
        />

        {error ? <p className="status error">{error}</p> : null}

        <div className="upload-grid">
          <article>
            <h2>Sentence-safe</h2>
            <p>Portions stop on whole sentences unless one sentence exceeds the viewport.</p>
          </article>
          <article>
            <h2>Pure browser</h2>
            <p>No backend, no server parsing, and no upload requirement.</p>
          </article>
          <article>
            <h2>GitHub Pages ready</h2>
            <p>Static Vite build with configurable Pages base handling.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
