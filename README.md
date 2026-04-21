# Pretext EPUB Reader

Client-side EPUB reader built with Vite, React, and TypeScript. The app accepts a local `.epub` file, parses it entirely in the browser, normalizes the content into a canonical model, and paginates it into full-screen vertical reading portions sized for the real viewport.

No backend is required. The uploaded EPUB never leaves the browser.

## Stack

- Vite
- React
- TypeScript
- `JSZip` for in-browser EPUB archive access
- `@chenglou/pretext` for viewport-aware text layout and measurement
- Vitest for core logic tests

## What the app does

- Uploads a local EPUB through file input or drag and drop
- Parses metadata, manifest, spine, XHTML content, and image resources in-browser
- Normalizes messy EPUB markup into a canonical book model
- Segments text into sentence units
- Rebuilds the reading surface as vertical full-screen portions
- Uses Pretext to measure candidate slices against the actual viewport width
- Stops portions on complete sentence boundaries in the normal flow
- Falls back to line-window continuation only when a single sentence is too large for one screen
- Persists reader settings and last reading anchor in `localStorage`
- Syncs annotations through JSONHosting when browser CORS permits it, with `localStorage` fallback
- Builds as a static site suitable for GitHub Pages

## Local development

```bash
npm install
npm run dev
```

Open the local Vite URL and upload an EPUB.

## Build

```bash
npm run build
```

The production bundle is emitted to `dist/`.

## Tests

```bash
npm test
```

Current tests cover:

- sentence segmentation with abbreviation-heavy input
- sentence-safe portion boundaries
- oversized sentence fallback
- reading anchor preservation after repagination

## GitHub Pages deployment

The project is configured for static deployment:

- no server routes
- no backend endpoints
- no runtime filesystem access outside browser file APIs
- Vite `base` handling for Pages

### Option 1: GitHub Actions

This repo includes [deploy.yml](.github/workflows/deploy.yml). To use it:

1. Push the project to GitHub.
2. Ensure the default branch is `main`, or adjust the workflow.
3. In repository settings, enable GitHub Pages and set the source to `GitHub Actions`.
4. Push to `main`.

The workflow exports `GITHUB_REPOSITORY`, and `vite.config.ts` converts that into the correct Pages base path.

### Option 2: Manual build

If you publish manually, set `VITE_BASE_PATH` during build when needed:

```bash
VITE_BASE_PATH=/your-repo-name/ npm run build
```

For user or org pages hosted at the root, the default `/` base is fine.

## Architecture

The project is split into focused modules instead of coupling EPUB parsing, pagination, and UI into one component tree.

### App shell

- `src/app/App.tsx`
- `src/app/components/*`
- `src/app/hooks/useReaderViewport.ts`

These files manage file ingestion, viewport observation, repagination triggers, swipe/tap navigation, keyboard support, settings, and loading/error states.

### EPUB ingestion

- `src/lib/epub/loadEpub.ts`
- `src/lib/epub/path.ts`

The EPUB is opened as a zip archive in memory using `JSZip`. The parser reads:

- `META-INF/container.xml`
- the OPF package
- manifest and spine
- spine XHTML documents
- image resources

The parser does not inject publisher CSS into the reader. Instead, it walks EPUB DOM nodes and extracts semantic structure into a canonical model.

### Canonical content model

- `src/types/book.ts`

The normalized model is independent from raw EPUB DOM. It stores:

- book metadata
- sections
- block-level structures
- inline runs with semantic marks
- sentence units with stable indices and offsets

The reader never depends directly on the original EPUB DOM after normalization.

### Sentence segmentation

- `src/lib/segmentation/sentences.ts`

Sentence splitting uses `Intl.Segmenter` when available and falls back to a pragmatic regex-based segmenter. A merge pass reduces false boundaries around common abbreviations such as `Mr.`, `Dr.`, `U.S.`, `e.g.`, and similar cases.

### Portioning engine

- `src/lib/portioning/paginateBook.ts`
- `src/lib/portioning/pretextLayout.ts`
- `src/lib/portioning/styleMap.ts`

This is the core logic.

For each text block:

1. The EPUB content has already been normalized into sentence units.
2. Candidate sentence slices are transformed into Pretext rich-inline items.
3. Pretext measures how many lines the candidate slice produces for the current content width.
4. The paginator binary-searches for the largest slice that fits in the remaining viewport height.
5. If a sentence does not fit in the remaining space but would fit on a fresh screen, the engine starts a new portion instead of splitting the sentence.
6. If a single sentence is taller than an entire screen, the engine enters explicit oversized-sentence fallback and continues that sentence by line windows.

This means normal pagination is sentence-safe, while the exceptional fallback remains readable and explicit in code.

## Sentence-safe boundary strategy

The portioner does not paginate by character count. It paginates by measured layout.

The decision loop is:

1. Start from a stable anchor `(blockId, sentenceIndex, lineOffset)`.
2. Measure the largest sentence slice that fits in the remaining viewport height.
3. Commit only slices ending on a sentence boundary.
4. If nothing fits and the next sentence would fit on a fresh portion, stop and start a new portion.
5. Only if the sentence is larger than the full screen does the engine split inside the sentence.

That keeps the default reading rhythm intact and avoids the common problem of crude pagination cutting prose in the wrong place.

## Pretext integration

Pretext is used as a real layout engine, not a decorative dependency.

- text slices are converted into rich-inline items with per-mark font choices
- `measureRichInlineStats` is used for fit decisions
- `walkRichInlineLineRanges` and `materializeRichInlineLineRange` are used to build rendered lines
- repagination is rerun when viewport dimensions or reader settings change

The line data feeds both fit decisions and the final rendered portion lines.

## Viewport reflow behavior

Reader settings and viewport dimensions affect:

- content width
- line count
- block height
- portion boundaries

When the viewport or settings change, the app:

1. keeps the current reading anchor
2. repaginates the book for the new width and height
3. finds the closest new portion containing that anchor
4. resumes reading from the corresponding portion

This avoids relying on a raw portion index, which becomes unstable after reflow.

## Reader settings

Included settings:

- font size
- line height
- horizontal padding
- light, sepia, and dark themes

Settings are stored in `localStorage`.

## Persistence

The app stores:

- reader settings
- last reading anchor per EPUB fingerprint
- last-opened book metadata needed for position lookup
- text annotations, including stable book fingerprint, block id/order, sentence index, character offsets, selected text, and note text

Book fingerprints are content-based SHA-256 hashes when `crypto.subtle` is available, so the same EPUB can be recognized across sessions and devices. Annotation anchors are tied to the normalized book structure rather than a portion index, so they survive viewport and settings reflow.

The app also contains a JSONHosting sync adapter:

- reads from `https://jsonhosting.com/api/json/{id}/raw`
- writes to `https://jsonhosting.com/api/json/{id}` with the document edit key
- falls back to local annotation storage if the network request fails

JSONHosting currently exposes CORS headers on the raw read endpoint. If browser CORS blocks write requests from GitHub Pages, annotations continue to work locally but remote writes require JSONHosting to allow cross-origin `PUT`/`PATCH` or a tiny proxy endpoint.

The book binary itself is not uploaded or sent anywhere.

## Notes and limitations

- DRM-protected EPUBs are not supported.
- The reader intentionally reinterprets publisher styling into a unified design instead of preserving arbitrary EPUB CSS.
- Text is the priority. Images are supported when present in the manifest and referenced in spine content.
- Very malformed EPUBs may still fail to parse, but loading errors are surfaced in the UI.
