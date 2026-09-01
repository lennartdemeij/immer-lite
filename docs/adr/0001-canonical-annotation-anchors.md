# ADR 0001: Persist annotations against canonical text offsets

## Status

Accepted.

## Context

Reader portions reflow when viewport dimensions or reading settings change. DOM ranges and portion indexes therefore cannot identify an annotation across sessions.

## Decision

An annotation is stored against a publication fingerprint, canonical text block ID, canonical character offsets, selected text, and a reader-anchor fallback. The UI derives portion locations and DOM highlights from this record after every pagination pass.

## Consequences

Annotations survive reflow and stored reading positions. A changed publication fingerprint is deliberately treated as a different publication. Remote sync adapters exchange the canonical records rather than rendered DOM data.
