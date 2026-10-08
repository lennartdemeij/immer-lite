import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { BookSearchResult } from '../../lib/reader/search';

export function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="reader-tool-icon" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
  </svg>;
}

interface BookSearchPanelProps {
  open: boolean;
  query: string;
  results: BookSearchResult[];
  pending: boolean;
  navigationLocked: boolean;
  panelRef: RefObject<HTMLElement>;
  onQueryChange: (query: string) => void;
  onSelect: (result: BookSearchResult) => void;
}

export function BookSearchPanel({ open, query, results, pending, navigationLocked, panelRef, onQueryChange, onSelect }: BookSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => { if (open) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => setActiveIndex(-1), [query, results]);
  const canSelect = !pending && !navigationLocked;
  return (
    <aside ref={panelRef} id="book-search-panel" className={`settings-panel book-search-panel ${open ? 'open' : ''}`}
      aria-label="Search this book" hidden={!open}>
      <div className="settings-panel-inner">
        <label className="book-search-field">
          <SearchIcon />
          <input ref={inputRef} type="search" value={query} placeholder="Search this book…"
            aria-label="Search this book" role="combobox" aria-autocomplete="list"
            aria-expanded={Boolean(query.trim() && results.length)} aria-controls="book-search-results"
            aria-activedescendant={activeIndex >= 0 ? `book-search-result-${activeIndex}` : undefined}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (!canSelect || !results.length) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => event.key === 'ArrowDown'
                  ? (index + 1) % results.length : (index <= 0 ? results.length : index) - 1);
              } else if (event.key === 'Enter') {
                event.preventDefault();
                onSelect(results[Math.max(0, activeIndex)]);
              }
            }} />
        </label>
        <div className="book-search-results" id="book-search-results" role="listbox" aria-label="Search results" aria-busy={pending}>
          {results.map((result, index) => (
            <button key={`${result.blockId}:${result.startOffset}`} type="button" role="option"
              id={`book-search-result-${index}`} aria-selected={index === activeIndex}
              className="book-search-result" disabled={!canSelect}
              onClick={() => onSelect(result)}>
              <span className="book-search-chapter">{result.sectionLabel}</span>
              <span className="book-search-excerpt">{result.before}<mark>{result.match}</mark>{result.after}</span>
            </button>
          ))}
        </div>
        <p className="book-search-status" role="status">
          {navigationLocked ? 'Pause reading aloud to jump to a result.'
            : pending ? 'Searching…' : !query.trim() ? 'Find a word or phrase in this book.'
              : results.length ? `${results.length === 5 ? 'First 5' : results.length} ${results.length === 1 ? 'match' : 'matches'}`
                : 'No matches. Try another word or phrase.'}
        </p>
      </div>
    </aside>
  );
}
