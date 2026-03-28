# PDF Word Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add word search to the PDF viewer — users type a term, see all matches listed by page with snippets, click to jump to a page, and see the word highlighted on the PDF via the PDF.js text layer.

**Architecture:** New `PdfSearchBar` component renders as a floating overlay inside the PDF pane. Search runs against OCR `results[].text` in-memory. Highlighting uses PDF.js text layer (enabled by switching `renderTextLayer` to `true`). SplitPane orchestrates state between PdfSearchBar and PdfViewer.

**Tech Stack:** React 19, react-pdf 10.x, PDF.js, Tailwind CSS 4, TypeScript, @heroicons/react

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `frontend/src/components/PdfSearchBar.tsx` | Create | Floating search overlay: input, match list, prev/next, close |
| `frontend/src/components/PdfViewer.tsx` | Modify | Enable text layer, accept `searchTerm` prop, drive PDF.js find controller |
| `frontend/src/components/SplitPane.tsx` | Modify | Add search icon to toolbar, Cmd/Ctrl+F handler, search state, render PdfSearchBar |

---

### Task 1: Create PdfSearchBar component with search logic

**Files:**
- Create: `frontend/src/components/PdfSearchBar.tsx`

- [ ] **Step 1: Create PdfSearchBar with search input and match computation**

Create the file with full search logic — debounced input, match building from OCR results, match count, results dropdown, prev/next cycling, close button.

```tsx
'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    MagnifyingGlassIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';

export interface OcrResultData {
    page: number;
    text: string;
    bounding_boxes?: number[][];
    words?: string[];
}

interface SearchMatch {
    page: number;
    snippet: string;
    matchIndex: number;
}

interface PdfSearchBarProps {
    ocrResults: OcrResultData[] | null;
    onNavigateToPage: (page: number) => void;
    onSearchTermChange: (term: string) => void;
    onClose: () => void;
}

function buildSnippet(text: string, index: number, termLength: number): string {
    const contextChars = 40;
    const start = Math.max(0, index - contextChars);
    const end = Math.min(text.length, index + termLength + contextChars);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return snippet;
}

export default function PdfSearchBar({
    ocrResults,
    onNavigateToPage,
    onSearchTermChange,
    onClose,
}: PdfSearchBarProps) {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [activeMatchIndex, setActiveMatchIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);

    // Auto-focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Debounce query
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(timer);
    }, [query]);

    // Build matches from OCR results
    const matches: SearchMatch[] = useMemo(() => {
        if (!debouncedQuery.trim() || !ocrResults) return [];
        const term = debouncedQuery.toLowerCase();
        const result: SearchMatch[] = [];
        let matchIndex = 0;

        for (const ocrResult of ocrResults) {
            const textLower = ocrResult.text.toLowerCase();
            let searchFrom = 0;
            let pos: number;

            while ((pos = textLower.indexOf(term, searchFrom)) !== -1) {
                result.push({
                    page: ocrResult.page,
                    snippet: buildSnippet(ocrResult.text, pos, term.length),
                    matchIndex: matchIndex++,
                });
                searchFrom = pos + 1;
            }
        }

        return result;
    }, [debouncedQuery, ocrResults]);

    // Reset active match when matches change
    useEffect(() => {
        setActiveMatchIndex(0);
    }, [matches]);

    // Notify parent of search term changes
    useEffect(() => {
        onSearchTermChange(debouncedQuery);
    }, [debouncedQuery, onSearchTermChange]);

    // Navigate to active match's page
    useEffect(() => {
        if (matches.length > 0 && matches[activeMatchIndex]) {
            onNavigateToPage(matches[activeMatchIndex].page);
        }
    }, [activeMatchIndex, matches, onNavigateToPage]);

    // Scroll active match into view in the results list
    useEffect(() => {
        if (!resultsRef.current) return;
        const activeEl = resultsRef.current.querySelector('[data-active="true"]');
        if (activeEl) {
            activeEl.scrollIntoView({ block: 'nearest' });
        }
    }, [activeMatchIndex]);

    const goToNext = useCallback(() => {
        setActiveMatchIndex((i) => (i + 1) % matches.length);
    }, [matches.length]);

    const goToPrev = useCallback(() => {
        setActiveMatchIndex((i) => (i - 1 + matches.length) % matches.length);
    }, [matches.length]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'Enter') {
                if (e.shiftKey) {
                    goToPrev();
                } else {
                    goToNext();
                }
            }
        },
        [onClose, goToNext, goToPrev]
    );

    const handleMatchClick = useCallback(
        (index: number) => {
            setActiveMatchIndex(index);
            onNavigateToPage(matches[index].page);
        },
        [matches, onNavigateToPage]
    );

    // Highlight the search term within a snippet
    const renderSnippet = useCallback(
        (snippet: string) => {
            if (!debouncedQuery.trim()) return snippet;
            const regex = new RegExp(`(${debouncedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const parts = snippet.split(regex);
            return parts.map((part, i) =>
                regex.test(part) ? (
                    <span key={i} className="font-bold text-yellow-300">
                        {part}
                    </span>
                ) : (
                    part
                )
            );
        },
        [debouncedQuery]
    );

    return (
        <div className="absolute top-3 right-3 z-20 w-80 flex flex-col rounded-lg shadow-xl overflow-hidden">
            {/* Search input bar */}
            <div className="flex items-center gap-2 bg-slate-800/90 backdrop-blur-sm px-3 py-2">
                <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 shrink-0" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search in document..."
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-400 outline-none"
                />
                {debouncedQuery.trim() && (
                    <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                        {matches.length > 0
                            ? `${activeMatchIndex + 1} of ${matches.length}`
                            : 'No matches'}
                    </span>
                )}
                <button
                    onClick={goToPrev}
                    disabled={matches.length === 0}
                    className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors"
                >
                    <ChevronUpIcon className="w-4 h-4 text-slate-300" />
                </button>
                <button
                    onClick={goToNext}
                    disabled={matches.length === 0}
                    className="p-0.5 rounded hover:bg-slate-700 disabled:opacity-30 transition-colors"
                >
                    <ChevronDownIcon className="w-4 h-4 text-slate-300" />
                </button>
                <button
                    onClick={onClose}
                    className="p-0.5 rounded hover:bg-slate-700 transition-colors"
                >
                    <XMarkIcon className="w-4 h-4 text-slate-300" />
                </button>
            </div>

            {/* Results dropdown */}
            {debouncedQuery.trim() && matches.length > 0 && (
                <div
                    ref={resultsRef}
                    className="max-h-[200px] overflow-y-auto bg-white border border-slate-200 border-t-0"
                >
                    {matches.map((match, i) => (
                        <button
                            key={`${match.page}-${match.matchIndex}`}
                            data-active={i === activeMatchIndex}
                            onClick={() => handleMatchClick(i)}
                            className={`w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors ${
                                i === activeMatchIndex ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                            }`}
                        >
                            <span className="font-medium text-slate-600">Page {match.page}</span>
                            <span className="text-slate-400 mx-1">&mdash;</span>
                            <span className="text-slate-500">
                                &ldquo;{renderSnippet(match.snippet)}&rdquo;
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to PdfSearchBar.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PdfSearchBar.tsx
git commit -m "feat: add PdfSearchBar component with search logic and results dropdown"
```

---

### Task 2: Enable text layer and search highlighting in PdfViewer

**Files:**
- Modify: `frontend/src/components/PdfViewer.tsx`

- [ ] **Step 1: Add searchTerm prop and enable renderTextLayer**

In `PdfViewer.tsx`, make the following changes:

1. Add `searchTerm?: string` to the props interface:

```tsx
export interface PdfViewerProps {
    fileUrl: string;
    scale: number;
    onLoadSuccess: (numPages: number) => void;
    onPageChange?: (page: number) => void;
    targetPage?: number | null;
    searchTerm?: string;
}
```

2. Destructure the new prop in the component function signature:

```tsx
const PdfViewer = memo(function PdfViewer({
    fileUrl,
    scale,
    onLoadSuccess,
    onPageChange,
    targetPage,
    searchTerm,
}: PdfViewerProps) {
```

3. Change `renderTextLayer={false}` to `renderTextLayer={true}` on the `<Page>` component.

4. Add a `useEffect` after the existing state declarations to use CSS-based highlighting. When `searchTerm` changes, inject/update a `<style>` tag that uses CSS Custom Highlight API or simple text layer mark styling:

```tsx
// Highlight search term in text layer via CSS
useEffect(() => {
    if (!containerRef.current) return;

    // Remove previous highlights
    const textLayers = containerRef.current.querySelectorAll('.react-pdf__Page__textContent');
    textLayers.forEach((layer) => {
        const spans = layer.querySelectorAll('span');
        spans.forEach((span) => {
            const originalText = span.getAttribute('data-original-text');
            if (originalText !== null) {
                span.textContent = originalText;
                span.removeAttribute('data-original-text');
            }
        });
    });

    if (!searchTerm?.trim()) return;

    const term = searchTerm.toLowerCase();

    // Apply highlights to text layer spans
    textLayers.forEach((layer) => {
        const spans = layer.querySelectorAll('span');
        spans.forEach((span) => {
            const text = span.textContent || '';
            if (text.toLowerCase().includes(term)) {
                span.setAttribute('data-original-text', text);
                const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                const parts = text.split(regex);
                span.innerHTML = '';
                parts.forEach((part) => {
                    if (part.toLowerCase() === term) {
                        const mark = document.createElement('mark');
                        mark.className = 'pdf-search-highlight';
                        mark.textContent = part;
                        span.appendChild(mark);
                    } else {
                        span.appendChild(document.createTextNode(part));
                    }
                });
            }
        });
    });
}, [searchTerm, numPages]);
```

- [ ] **Step 2: Add CSS for highlight marks**

Add a `<style>` JSX element inside the return, right before the `<Document>` component:

```tsx
<style>{`
    .pdf-search-highlight {
        background-color: rgba(253, 224, 71, 0.6);
        border-radius: 2px;
        padding: 0 1px;
        color: inherit;
    }
    .react-pdf__Page__textContent {
        opacity: 0.4;
    }
    .react-pdf__Page__textContent span {
        color: transparent;
    }
    .react-pdf__Page__textContent .pdf-search-highlight {
        color: transparent;
        background-color: rgba(253, 224, 71, 0.5);
    }
`}</style>
```

Note: The text layer renders transparent text overlaid on the canvas. We keep text transparent but make highlight backgrounds visible so yellow marks appear over the matching words on the rendered PDF image.

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to PdfViewer.tsx

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PdfViewer.tsx
git commit -m "feat: enable text layer and add search term highlighting in PdfViewer"
```

---

### Task 3: Integrate search into SplitPane toolbar

**Files:**
- Modify: `frontend/src/components/SplitPane.tsx`

- [ ] **Step 1: Add search state and keyboard handler**

In `SplitPane.tsx`, make the following changes:

1. Add import for `MagnifyingGlassIcon` and `PdfSearchBar`:

```tsx
import {
    MagnifyingGlassPlusIcon,
    MagnifyingGlassMinusIcon,
    MagnifyingGlassIcon,
    DocumentTextIcon,
} from '@heroicons/react/24/outline';
import ClinicalSummary from './ClinicalSummary';
import PdfSearchBar from './PdfSearchBar';
```

2. Add state variables after the existing state declarations:

```tsx
const [isSearchOpen, setIsSearchOpen] = useState(false);
const [searchTerm, setSearchTerm] = useState('');
const pdfPaneRef = useRef<HTMLDivElement>(null);
```

3. Add a `useEffect` for the Cmd/Ctrl+F keyboard shortcut:

```tsx
// Cmd/Ctrl+F to open search
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
            e.preventDefault();
            setIsSearchOpen(true);
        }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
}, []);
```

4. Add close handler:

```tsx
const handleSearchClose = useCallback(() => {
    setIsSearchOpen(false);
    setSearchTerm('');
}, []);

const handleSearchTermChange = useCallback((term: string) => {
    setSearchTerm(term);
}, []);
```

- [ ] **Step 2: Add search icon button to toolbar**

Add a search icon button in the toolbar, in the right-side zoom section, before the zoom out button:

```tsx
{/* Right: Search + Zoom */}
<div className="flex items-center space-x-2">
    <button
        onClick={() => setIsSearchOpen((v) => !v)}
        className={`p-1.5 rounded-md border shadow-sm hover:shadow transition-all ${
            isSearchOpen
                ? 'bg-blue-50 border-blue-300 text-blue-600'
                : 'bg-white border-slate-200 hover:bg-slate-50'
        }`}
    >
        <MagnifyingGlassIcon className="w-4 h-4" />
    </button>
    <button
        onClick={zoomOut}
        className="p-1.5 rounded-md bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:shadow transition-all"
    >
        <MagnifyingGlassMinusIcon className="w-4 h-4 text-slate-600" />
    </button>
    <span className="text-xs font-medium text-slate-500 w-10 text-center tabular-nums">
        {Math.round(scale * 100)}%
    </span>
    <button
        onClick={zoomIn}
        className="p-1.5 rounded-md bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:shadow transition-all"
    >
        <MagnifyingGlassPlusIcon className="w-4 h-4 text-slate-600" />
    </button>
</div>
```

- [ ] **Step 3: Add PdfSearchBar and pass searchTerm to PdfViewer**

1. Make the left pane container `relative` and add a `ref` so the search bar can float inside it. Change the PDF pane div:

```tsx
<div ref={pdfPaneRef} className="relative w-full md:w-1/2 h-1/2 md:h-full border-b flex-shrink-0 md:flex-shrink md:border-b-0 md:border-r border-slate-200 bg-slate-100 overflow-auto">
```

2. Add PdfSearchBar right inside the PDF pane div, before the conditional rendering:

```tsx
{isSearchOpen && (
    <PdfSearchBar
        ocrResults={results}
        onNavigateToPage={handleNavigateToPage}
        onSearchTermChange={handleSearchTermChange}
        onClose={handleSearchClose}
    />
)}
```

3. Pass `searchTerm` to PdfViewer:

```tsx
<PdfViewer
    fileUrl={fileUrl}
    scale={scale}
    onLoadSuccess={handleLoadSuccess}
    onPageChange={handlePageChange}
    targetPage={targetPage}
    searchTerm={searchTerm}
/>
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SplitPane.tsx
git commit -m "feat: integrate PDF search bar with toolbar button and Cmd/Ctrl+F shortcut"
```

---

### Task 4: Manual testing and highlight timing fix

**Files:**
- Modify: `frontend/src/components/PdfViewer.tsx`

- [ ] **Step 1: Run the dev server and test**

Run: `cd frontend && npm run dev`

Test the following:
1. Open a document in the viewer
2. Press Cmd/Ctrl+F — search bar should appear floating over the PDF pane
3. Type a word that exists in the OCR results — match count should appear, results dropdown should list matches
4. Click a match — PDF should scroll to that page
5. If the PDF has embedded text, yellow highlights should appear on matching words
6. Press Escape — search bar closes
7. Click the search icon in the toolbar — search bar toggles

- [ ] **Step 2: Fix highlight timing for pages that render after search**

The text layer renders asynchronously per page. The highlight effect in Task 2 runs on `searchTerm` change, but pages that haven't rendered their text layer yet will be missed. Add a `MutationObserver` to re-apply highlights when new text layer content appears:

In `PdfViewer.tsx`, update the search highlight `useEffect` to include a MutationObserver:

```tsx
useEffect(() => {
    if (!containerRef.current) return;

    const applyHighlights = () => {
        if (!containerRef.current) return;
        const textLayers = containerRef.current.querySelectorAll('.react-pdf__Page__textContent');
        textLayers.forEach((layer) => {
            const allSpans = layer.querySelectorAll('span');
            allSpans.forEach((span) => {
                // Restore original text first
                const originalText = span.getAttribute('data-original-text');
                if (originalText !== null) {
                    span.textContent = originalText;
                    span.removeAttribute('data-original-text');
                }
            });

            if (!searchTerm?.trim()) return;
            const term = searchTerm.toLowerCase();

            allSpans.forEach((span) => {
                const text = span.textContent || '';
                if (text.toLowerCase().includes(term)) {
                    span.setAttribute('data-original-text', text);
                    const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                    const parts = text.split(regex);
                    span.innerHTML = '';
                    parts.forEach((part) => {
                        if (part.toLowerCase() === term) {
                            const mark = document.createElement('mark');
                            mark.className = 'pdf-search-highlight';
                            mark.textContent = part;
                            span.appendChild(mark);
                        } else {
                            span.appendChild(document.createTextNode(part));
                        }
                    });
                }
            });
        });
    };

    applyHighlights();

    // Watch for new text layer content being rendered
    const observer = new MutationObserver(() => {
        applyHighlights();
    });

    observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
    });

    return () => observer.disconnect();
}, [searchTerm]);
```

Note: Remove the previous `numPages` dependency since the MutationObserver handles dynamically rendered pages.

- [ ] **Step 3: Verify it compiles and test again**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

Test: Scroll through pages while search is active — newly rendered pages should get highlights applied.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/PdfViewer.tsx
git commit -m "fix: use MutationObserver for reliable search highlights on lazily rendered pages"
```

---

### Task 5: Build verification

- [ ] **Step 1: Run production build**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run lint**

Run: `cd frontend && npm run lint 2>&1 | tail -20`
Expected: No new lint errors

- [ ] **Step 3: Commit any lint fixes if needed**

```bash
git add -A
git commit -m "chore: fix lint issues from PDF search feature"
```
