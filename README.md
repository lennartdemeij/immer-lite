# Pretext EPUB Reader

Client-side EPUB reader built with Vite, React, and TypeScript. The app parses a local `.epub` entirely in the browser, normalizes the source into a canonical book model, and paginates that model into viewport-sized vertical reading portions.

No backend is required. The uploaded EPUB never leaves the browser.

## Stack

- Vite
- React
- TypeScript
- `JSZip` for in-browser EPUB archive access
- `@chenglou/pretext` for rich-inline layout and measurement
- Vitest for parser and portioning tests

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Tests

```bash
npm test
```

## High-level pipeline

At runtime the book goes through these phases:

1. Open the EPUB zip in memory.
2. Read the package document, manifest, spine, metadata, resources, and TOC.
3. Parse each linear spine document into a DOM.
4. Annotate relevant DOM elements with browser-computed CSS snapshots.
5. Convert each spine document into canonical sections and blocks.
6. Segment text blocks into sentence units with stable offsets.
7. Classify sections into `front`, `body`, or `back`.
8. Build parse diagnostics and a confidence score.
9. Paginate the normalized book into measured portions for the current viewport.

The main entry points are:

- Parser: [src/lib/epub/loadEpub.ts](src/lib/epub/loadEpub.ts)
- Style measurement: [src/lib/epub/computeStyles.ts](src/lib/epub/computeStyles.ts)
- Section heuristics: [src/lib/epub/heuristics.ts](src/lib/epub/heuristics.ts)
- Portioner: [src/lib/portioning/paginateBook.ts](src/lib/portioning/paginateBook.ts)
- Pretext adapter: [src/lib/portioning/pretextLayout.ts](src/lib/portioning/pretextLayout.ts)
- Reader anchors: [src/lib/reader/anchors.ts](src/lib/reader/anchors.ts)
- Persistence: [src/lib/persistence/storage.ts](src/lib/persistence/storage.ts) and [src/lib/persistence/indexedDb.ts](src/lib/persistence/indexedDb.ts)
- Rect mapping: [src/lib/reader/contentRects.ts](src/lib/reader/contentRects.ts)
- PWA bootstrap: [src/lib/pwa/registerServiceWorker.ts](src/lib/pwa/registerServiceWorker.ts)

## Canonical data model

The normalized book model lives in [src/types/book.ts](src/types/book.ts).

Important design choices:

- The reader does not render raw EPUB DOM after parsing.
- The parser emits canonical `sections`.
- Each section contains canonical `blocks`.
- Text blocks contain canonical `inlineContent`.
- Text blocks are segmented into stable `sentences`.
- Each block has a monotonic global `order`.
- Computed CSS is stored as snapshots on blocks, not preserved as live stylesheet behavior.

Supported canonical block kinds:

- `heading`
- `paragraph`
- `quote`
- `list-item`
- `scene-break`
- `image`

The reader-facing portion model lives in [src/types/reader.ts](src/types/reader.ts).

## Parser: exact steps

### 1. Validate input and fingerprint the book

Implemented in [loadEpub.ts](src/lib/epub/loadEpub.ts).

- Rejects files that do not end in `.epub`.
- Reads the file into an `ArrayBuffer`.
- Computes a stable SHA-256 fingerprint when `crypto.subtle` is available.
- Falls back to `file:name:size` when Web Crypto is unavailable.

This fingerprint is later used for persistence and annotation identity.

### 2. Read EPUB package structure

The parser loads:

- `META-INF/container.xml`
- the OPF package document referenced by `rootfile@full-path`
- `manifest`
- `spine`
- metadata fields such as title, creator, language, publisher, description

Concrete behavior:

- Only `spine` items with `linear !== "no"` are treated as readable content.
- Manifest hrefs are resolved relative to the OPF directory.
- Missing `container.xml`, missing package path, or missing OPF fail hard.

### 3. Load resources

Resource handling is intentionally narrow.

- All manifest items are indexed into `book.resources`.
- Only image resources get `objectUrl`s.
- Fonts and other binary assets are not converted into object URLs for the reader.

This is deliberate because the reader re-renders content in its own layout system instead of replaying publisher rendering.

### 4. Load and sanitize CSS for measurement

Implemented in [loadEpub.ts](src/lib/epub/loadEpub.ts).

The parser gathers CSS from:

- linked stylesheets referenced by `<link rel="stylesheet">`
- inline `<style>` elements inside each spine document

Before style measurement, stylesheet text is sanitized:

- `@import ...;` rules are removed
- `@font-face { ... }` blocks are removed
- every `url(...)` is rewritten to `url("")`

Reason:

- avoid loading remote or embedded resources during measurement
- avoid font downloads and image loads
- keep style analysis fast and deterministic

### 5. Parse TOC

Implemented in [loadEpub.ts](src/lib/epub/loadEpub.ts).

TOC parsing order:

1. EPUB 3 nav document: manifest item with `properties~="nav"`
2. NCX fallback:
   - `spine@toc` target if present
   - otherwise first manifest item with media type `application/x-dtbncx+xml`

Supported structures:

- nested `<nav>` + `<ol>/<ul>`
- nested NCX `<navPoint>`

Stored per entry:

- `label`
- resolved `href`
- `depth`
- nested `children`

If the parsed TOC is missing or too weak, `pretext` now derives a fallback TOC from classified body sections later in the pipeline.

### 6. Compute browser styles once, in batch

Implemented in [computeStyles.ts](src/lib/epub/computeStyles.ts).

This is one of the most important parser stages.

Current strategy:

- all parsed spine documents are measured in one batched pass
- one shared hidden `iframe` is reused
- each document is mounted into its own `shadowRoot`
- styles are injected into that shadow root
- source DOM is cloned before measurement
- resource attributes are stripped from the cloned DOM

Stripped resource attributes:

- `src`
- `srcset`
- `poster`
- `data`

Elements are not all measured blindly. The code filters to style-relevant elements only:

- semantic tags such as `p`, `div`, `blockquote`, `li`, `span`, `a`, `img`, `h1-h6`, `hr`, etc.
- elements with direct readable text
- elements with `class`, `style`, `id`, or `href`

The browser-computed snapshot stored per element includes:

- margins and paddings
- `fontFamily`
- `fontStyle`
- `fontWeight`
- `fontVariant`
- `textDecorationLine`
- `textAlign`
- `display`
- page-break intent inferred from `break-before` / `break-after` and legacy page-break properties

This gives the parser CSS-aware heuristics without needing to preserve publisher CSS during reader rendering.

### 7. Walk each spine DOM and emit canonical blocks

Implemented in `parseSectionBlocks(...)` in [loadEpub.ts](src/lib/epub/loadEpub.ts).

The parser walks `body.children` recursively and emits canonical blocks.

Important traversal rules:

- `div`, `section`, and `article` recurse into children when they contain nested block-level children
- otherwise they may collapse into a single text block
- `ul` and `ol` become one canonical block per direct `<li>`
- standalone `img` or image-only paragraphs become canonical `image` blocks
- `figure` with a direct image becomes one canonical `image` block, with `figcaption` used as caption when present
- wrapper nodes with only direct `<li>` children are normalized into list-item blocks
- wrapper nodes with only direct image content are normalized into image blocks instead of leaking wrapper text semantics
- explicit CSS `page-break-before` / `page-break-after` hints are converted into structural break signals between canonical blocks

### 8. Detect structural breaks

Scene-break detection happens before normal paragraph classification.

Current `scene-break` heuristics:

- any `<hr>` becomes a `scene-break`
- ornament-only text blocks also become `scene-break`
- explicit CSS page-break hints can also introduce `scene-break` boundaries between adjacent canonical blocks

Concrete ornament rules:

- max normalized length: `24` characters
- explicit matches for repeated separators such as:
  - `***`
  - `· · ·`
  - `• • •`
  - `...`
- fallback ornament-only detection accepts strings made entirely of characters such as:
  - `.`
  - `_`
  - `*`
  - `~`
  - `-`
  - `–`
  - `—`
  - `=`
  - `+`
  - `|`
  - `/`
  - `\`
  - `·`
  - `•`
  - `⋅`
  - `●`
  - `○`
  - `◦`
  - `◆`
  - `◇`
  - `▪`
  - `▫`
  - `❖`
  - `❦`
  - `⁂`
  - `※`

This is what prevents publisher separators like `...` or `—` from leaking through as ordinary text paragraphs.

### 9. Infer block kind

Implemented in `inferTextBlockKind(...)` in [heuristics.ts](src/lib/epub/heuristics.ts).

Hard mappings:

- `h1-h6` => `heading`
- `blockquote` => `quote`
- `li` => `list-item`

Heuristic mappings for non-semantic containers like `p` or `div`:

- normalize text
- count words
- compute `shortText = text.length <= 120 && wordCount <= 14`
- read computed style

Rules:

- short text + centered or bold or small-caps => `heading`
- short text + explicit CSS page-break hint => `heading`
- short text + centered + italic => `quote`
- otherwise => `paragraph`

This lets the parser recover headings from EPUBs that visually style headings as paragraphs or divs.

### 10. Extract inline content and semantic marks

Implemented in `extractInlineContent(...)` and `addStyleMarks(...)` in [loadEpub.ts](src/lib/epub/loadEpub.ts).

Inline extraction walks text nodes recursively and records:

- raw text
- marks
- normalized hrefs for links

Marks come from both HTML tags and computed CSS.

Tag-derived marks:

- `<em>` / `<i>` => `italic`
- `<strong>` / `<b>` => `bold`
- `<code>` => `code`
- `<a>` => `link`

Computed-style-derived marks:

- bold font weight >= `600`
- italic / oblique font style
- underline from `text-decoration-line`
- strikethrough from `text-decoration-line`
- small caps from `font-variant`

Other inline behaviors:

- `<br>` becomes a single space
- internal links are normalized relative to the section href
- external schemes such as `http:` are preserved as external links

### 11. Segment text into sentence units

Implemented in [src/lib/segmentation/sentences.ts](src/lib/segmentation/sentences.ts).

Flow:

1. collapse inline text into one normalized block string
2. segment into sentence boundaries
3. rebuild per-sentence inline slices with stable offsets

Segmentation behavior:

- uses `Intl.Segmenter` when available
- falls back to a regex-based segmenter otherwise
- includes a merge pass to avoid bad breaks after common abbreviations

Each `SentenceUnit` stores:

- stable `index`
- `text`
- `startOffset`
- `endOffset`
- `inlineIds` for the inline fragments belonging to that sentence

### 12. Collect anchors and local links

Implemented in [loadEpub.ts](src/lib/epub/loadEpub.ts).

Per section the parser also collects:

- every DOM `id` as `anchorIds`
- every non-external inline href as `localLinks`

These are later used for TOC resolution and reciprocal-footnote detection.

### 13. Classify sections into front/body/back matter

Implemented in `classifySections(...)` in [heuristics.ts](src/lib/epub/heuristics.ts).

This stage assigns:

- canonical section `label`
- optional `navLabel`
- optional TOC depth
- `matter: front | body | back`

#### 13.1 TOC matching

Each TOC entry is matched to a section by:

1. exact href + fragment match against the section's `anchorIds`
2. href-without-fragment match against `section.href`

First successful assignment wins for a section.

#### 13.2 Search text used for classification

For each section the classifier builds a normalized search string from:

- current section label
- TOC label
- href
- heading texts
- preview text from the first few text blocks

#### 13.3 Dominant body-style heuristic

For each section:

- gather non-heading text blocks
- build a style signature from:
  - font family
  - font style
  - font weight
  - font variant
  - text align
  - display
- weight each signature by text length

Across all substantial sections, the most frequent signature becomes the dominant body style.

This is used as a fallback signal for where the main reading body starts and ends.

#### 13.4 Reciprocal footnote section detection

A section is treated as note-like / back-matter-like when all of these hold:

- text length <= `900`
- sentence count <= `8`
- section has local links
- section links back to an earlier section
- that earlier section also links into this section

This is the current heuristic for “short note section that is really attached to previous body text”.

#### 13.5 Body start detection

The classifier first looks for an explicit body start:

- section is not front-matter-like
- search text matches one of:
  - `introduction`
  - `intro`
  - `prologue`
  - `chapter 1`
  - `chapter one`
  - `part 1`
  - `part one`
  - `book 1`
  - `book one`

If that fails, fallback body start is:

- not front-matter-like
- not reciprocal-footnote-like
- substantial
- and either:
  - matches dominant body style
  - or has above-average text length

If that still fails, the first section with any text is used.

#### 13.6 Body end detection

The classifier first looks for explicit back matter after body start:

- `about the author`
- `acknowledgments`
- `afterword`
- `appendix`
- `bibliography`
- `endnotes`
- `glossary`
- `index`
- `notes`
- `references`

If that fails, fallback body end is the last section after body start that:

- is not reciprocal-footnote-like
- and either:
  - matches dominant body style
  - or is substantial

#### 13.7 Final matter assignment

Final matter rules:

- reciprocal-footnote-like or explicit back-matter match => `back`
- index before body start => `front`
- index after body end => `back`
- everything else inside body range => `body`

Section labels are updated in this order:

1. TOC label if available
2. otherwise first heading text
3. otherwise existing fallback label

### 14. Finalize TOC

After section classification, the parser checks whether the original TOC is actually usable against the parsed sections.

Current TOC usability rules:

- empty TOC => unusable
- single-entry TOC must map to exactly one parsed section
- multi-entry TOC must map onto at least `max(2, ceil(entryCount * 0.35))` parsed sections

If the original TOC is unusable, the parser derives a fallback TOC from classified body sections:

- only `body` sections with text are considered
- sections with a heading or substantial text are eligible
- depth is inferred from labels such as `Part`, `Book`, `Chapter`, `Introduction`, `Prologue`, `Epilogue`, or from heading levels when available
- the resulting TOC is hierarchical when depth cues exist, otherwise effectively flat

This is intentionally simpler than full TOC reconstruction, but it gives the reader a navigable structure even when the source EPUB nav is missing or weak.

### 15. Parse diagnostics and confidence score

Implemented in `createParseStats(...)` in [loadEpub.ts](src/lib/epub/loadEpub.ts).

Warnings currently include cases like:

- no usable TOC found
- computed styles not fully resolved for a section
- only one readable spine section found
- spine entries missing from the archive

Info-level diagnostics currently include cases like:

- skipped empty spine documents
- generated derived TOC from body sections

Confidence scoring starts at `1.0` and is reduced by:

- `-0.28` per error
- `-0.08` per warning

The result is clamped to `[0, 1]`.

`parseStats` now also includes per-phase timing entries for stages such as:

- file read
- fingerprinting
- zip open
- package parsing
- stylesheet loading
- TOC loading
- section preparation
- computed-style annotation
- section building
- section classification
- final TOC selection

## Parser-adjacent reader heuristics

Implemented in [src/lib/reader/anchors.ts](src/lib/reader/anchors.ts).

These are not part of EPUB ingestion itself, but they depend directly on parser output.

### Preferred start anchor

The reader tries to avoid dumping the user into front matter.

Priority:

1. first non-front/non-back section that matches strong body-start patterns like `Chapter 1`
2. otherwise first readable non-front/non-back substantial section
3. otherwise first readable non-front/non-back section
4. otherwise absolute first section

This uses the parser's `matter` classification plus another pass over title-like patterns.

### Rich locators and anchor fallback

Reader anchors are no longer just `blockId + sentenceIndex + lineOffset`.

They now also carry optional context such as:

- `locator` string
- `sectionId`
- `sectionIndex`
- `sectionHref`
- `progression`
- `excerpt`

During pagination, each portion boundary anchor is enriched with section metadata and a short textual excerpt from the sentence it points to.

This extra locator data is used in two places:

- persistence, so stored positions and annotations are not tied only to a single block id
- fallback anchor recovery, so the reader can still recover a reasonable position if an exact `blockId` no longer exists

Current anchor recovery order:

1. exact `blockId`
2. `excerpt` text match in the book
3. same `sectionId`
4. nearest `progression`
5. default book start

This is still much simpler than full EPUB CFI, but substantially richer than a bare block id.

## Persistence and offline

Implemented in [src/lib/persistence/storage.ts](src/lib/persistence/storage.ts), [src/lib/persistence/indexedDb.ts](src/lib/persistence/indexedDb.ts), [src/lib/pwa/registerServiceWorker.ts](src/lib/pwa/registerServiceWorker.ts), and the assets in [public](public).

The project now has two persistence layers:

- synchronous `localStorage` cache for immediate app bootstrap
- structured IndexedDB stores for durable storage and future migrations

### IndexedDB stores

Current stores:

- `settings`
- `positions`
- `annotations`
- `publications`
- `meta`

Responsibilities:

- `settings` stores active reader settings
- `positions` stores latest reading position per book fingerprint
- `annotations` stores user annotations
- `publications` stores recently opened EPUB blobs for reopen/offline use
- `meta` stores persistence schema version information

### Storage migration

On startup, the app runs a migration pass from legacy `localStorage` keys into IndexedDB.

Current migrated keys:

- `pretext-reader:settings`
- `pretext-reader:positions`
- `pretext-reader:annotations`

After migration:

- IndexedDB becomes the durable backing store
- `localStorage` remains a bootstrap cache
- writes are mirrored to both layers

This keeps the current startup path fast while making the storage model more evolvable.

### Stored publication reopening

When a user opens a local EPUB file, the file is persisted into the `publications` store.

Startup order is now:

1. hydrate IndexedDB-backed caches
2. reopen the latest stored local publication if one exists
3. otherwise fall back to the bundled default `book.epub`

The bundled default book is intentionally not re-saved into the publication store, so it does not overwrite a real user-uploaded offline book.

### Service worker and manifest

The app now registers a production-only service worker and ships a web app manifest.

Current PWA behavior:

- cache app shell resources on install
- use same-origin cache-first fetch handling
- cache newly fetched same-origin resources
- clear old cache versions on activation
- trigger reload on service-worker controller change

Files involved:

- [public/sw.js](public/sw.js)
- [public/manifest.webmanifest](public/manifest.webmanifest)
- [public/icon-192.svg](public/icon-192.svg)
- [public/icon-512.svg](public/icon-512.svg)

## Portioner: exact steps

Implemented in [src/lib/portioning/paginateBook.ts](src/lib/portioning/paginateBook.ts).

The portioner never paginates by characters. It paginates by measured layout.

### 1. Start from a stable cursor

Internal cursor shape:

- `sectionIndex`
- `blockIndex`
- `sentenceIndex`
- `lineOffset`

Public anchors use:

- `locator`
- `sectionId`
- `sectionIndex`
- `sectionHref`
- `blockId`
- `blockOrder`
- `sentenceIndex`
- `lineOffset`
- `progression`
- `excerpt`

If a caller provides `startAnchor`, pagination starts there. Otherwise it starts at the first block.

### 2. Build one portion at a time

For each new portion:

- start at the current cursor
- set `remainingHeight = viewport.contentHeight`
- append blocks until the next block no longer fits or should not be included

Each portion stores:

- `start` anchor
- `end` anchor
- `sectionId`
- `sectionLabel`
- canonical rendered blocks

### 3. Do not casually cross section boundaries

If the working cursor reaches a new section and the current portion already has content, the portion stops.

This means sections are natural hard-ish boundaries unless a new portion is completely empty.

### 4. Keep headings with following content

Implemented in `shouldKeepHeadingWithNextBlock(...)`.

If the next block is a heading and the current portion already has content, the portioner checks whether the heading plus the first sentence of the next readable text block can still fit.

If not, the current portion stops before the heading.

This avoids orphan headings at the bottom of a screen.

### 5. Handle scene breaks and images explicitly

Scene-break handling:

- `scene-break` blocks consume fixed vertical space based on `styleMap`
- if they do not fit and the portion already has content, the portion stops before them

Image handling:

- max image height is constrained by typography settings
- current ratio is `0.36` of full viewport height
- if an image would get less than `120px` usable height and the portion already has content, it moves to the next portion
- otherwise it is included and remaining height is reduced accordingly

### 6. Find the largest sentence slice that fits

Implemented in `findMaxSentenceFit(...)`.

For text blocks, the portioner binary-searches over sentence boundaries:

- low = current sentence index
- high = block sentence count
- candidate slices are measured with Pretext
- the best fitting exclusive sentence index is returned

Measurement is done against the real current viewport width and reader settings.

### 7. Rank candidate breakpoints instead of always taking the longest fit

Implemented in `chooseSentenceBreak(...)`.

This is the main break-quality heuristic.

For every candidate end sentence between `startSentence + 1` and `maxSentenceExclusive`, the code computes a score:

- base score = number of sentences included
- `+2.5` if the candidate ends the block
- `-1.2` if only one sentence would remain after the break
- `-0.5` if more than one but fewer than `2` sentences would remain
- `+0.45` if the final sentence ends with strong punctuation like `.`, `!`, `?`
- `-0.35` if the final sentence ends with weak punctuation like `,`, `:`, `;`
- `-1.5` if the block is a heading and the candidate would split the heading

Highest score wins.

This means the portioner prefers:

- finishing a block cleanly
- not leaving a tiny tail behind
- stronger prose endings
- not cutting headings

### 8. Normal case: never split inside a sentence

If at least one sentence fits:

- choose the best sentence boundary
- render that sentence slice
- consume its measured height
- move the cursor to the next sentence or next block

This is the normal path.

### 9. If the next sentence does not fit, but would fit on a fresh screen, stop

This is the key “sentence-safe pagination” behavior.

If nothing fits in the remaining height, the code measures a single sentence against a fresh viewport-sized screen:

- if it would fit on a fresh screen and the current portion already has content, stop the portion
- do not split that sentence just to fill the bottom gap

This is why the reader avoids ugly in-sentence cuts in ordinary flow.

### 10. Oversized sentence fallback

If a single sentence is larger than an entire screen, the portioner enters fallback mode.

Implemented in `renderOversizedSentence(...)`.

Behavior:

- estimate how many lines fit in the remaining height
- always show at least `MIN_VISIBLE_LINES = 2`
- render a line window for that sentence
- track continuation using `lineOffset`

This is the only mode where the engine splits inside a sentence.

### 11. Continuation semantics are explicit

Rendered text slices carry:

- `continuationStart`
- `continuationEnd`

These are derived from:

- whether the slice starts mid-block or mid-sentence
- whether it ends before the block is finished

The reader uses these flags for continuation markers.

### 12. Yield back to the browser during long paginations

After every `24` portions, the paginator awaits a zero-delay timeout.

This prevents very long books from monopolizing the main thread for one uninterrupted run.

### 13. Safety guard against infinite loops

Pagination aborts if loop iterations exceed:

- `book.totalBlocks * 10_000`

This is a defensive guard for malformed cursor progress.

## Pretext integration details

Implemented mainly in [src/lib/portioning/pretextLayout.ts](src/lib/portioning/pretextLayout.ts) and [src/lib/portioning/styleMap.ts](src/lib/portioning/styleMap.ts).

Pretext is used for actual fit decisions, not just final rendering.

Current responsibilities:

- convert canonical inline runs into Pretext rich-inline items
- choose fonts per block kind and inline marks
- measure candidate slices
- materialize actual rendered lines for the accepted slice

Typography is normalized by block kind:

- headings use a condensed display stack
- body and quotes use a serif stack
- code uses a mono stack
- block margins and line heights are unified by `styleMap`

This is where the system intentionally diverges from original EPUB presentation.

## Repagination behavior

When viewport or settings change:

1. keep the current reading anchor
2. repaginate the whole book
3. locate the portion containing the old anchor
4. reopen at that corresponding new portion

This avoids treating the previous portion index as stable across reflow.

## Rect-aware content mapping

Implemented in [src/lib/reader/contentRects.ts](src/lib/reader/contentRects.ts) and consumed in [src/app/components/ReaderScreen.tsx](src/app/components/ReaderScreen.tsx).

The reader now maintains a small geometry layer for text selections and annotations.

Current behavior:

- when the user selects text, the DOM `Range` client rects are captured and normalized relative to the current portion pane
- saved annotations can store those normalized rect snapshots
- when an annotation is opened again, the reader can re-measure the live DOM spans that overlap the annotation offsets
- the current portion then renders an absolute overlay highlight based on those rects

This is useful because offsets alone answer "what text is selected", while rect mapping answers "where is that text on screen right now".

That geometry layer is the basis for more advanced features later, such as:

- better visual annotation overlays
- tap-to-annotation hit testing
- region-based navigation
- focus or guided-reading modes

## Current tests

The test suite currently covers:

- sentence segmentation with abbreviation-heavy input
- TOC and front/body/back classification
- derived TOC fallback and weak-TOC detection
- heading inference from computed style signals
- reciprocal-footnote downgrading
- sentence-safe portion boundaries
- oversized-sentence fallback
- heading-orphan prevention
- anchor preservation after repagination
- richer section-based anchor fallback

See:

- [src/lib/segmentation/sentences.test.ts](src/lib/segmentation/sentences.test.ts)
- [src/lib/epub/heuristics.test.ts](src/lib/epub/heuristics.test.ts)
- [src/lib/portioning/paginateBook.test.ts](src/lib/portioning/paginateBook.test.ts)
- [src/lib/reader/anchors.test.ts](src/lib/reader/anchors.test.ts)

## Deployment

The project is configured for static deployment and GitHub Pages.

### GitHub Actions

This repo includes [deploy.yml](.github/workflows/deploy.yml).

1. Push the repo to GitHub.
2. Ensure the main deployment branch matches the workflow.
3. In repository settings, enable GitHub Pages and set the source to `GitHub Actions`.
4. Push to the deployment branch.

### Manual build

If you publish manually, set `VITE_BASE_PATH` when needed:

```bash
VITE_BASE_PATH=/your-repo-name/ npm run build
```

## Notes and limitations

- DRM-protected EPUBs are not supported.
- The reader intentionally reinterprets publisher styling into a unified reader layout.
- Computed styles are used as parser signals, not as a promise of pixel-identical EPUB rendering.
- Images are supported, but the system is still text-first.
- Very malformed EPUBs may still parse poorly; `parseStats.diagnostics` is the intended inspection surface for that.
