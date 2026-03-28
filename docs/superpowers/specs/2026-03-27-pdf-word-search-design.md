# PDF Word Search Feature

## Overview

Add in-PDF word search to the document viewer. Users can search for words across the document, see a list of all matches with page numbers and text snippets, click a match to jump to that page, and see the word highlighted on the rendered PDF page.

## Search UI

### Trigger
- **Keyboard shortcut:** Cmd+F (Mac) / Ctrl+F (Windows) opens the search bar. Overrides the browser's native find-in-page within the PDF pane.
- **Toolbar button:** A search icon button added to the SplitPane toolbar toggles the search bar.
- **Escape** closes the search bar and clears highlights.

### Floating Search Bar
- Positioned at the top-right of the PDF pane as a floating overlay.
- Contains:
  - Text input (auto-focused on open)
  - Match count display (e.g., "3 matches found")
  - Prev/next navigation buttons (up/down arrows) to cycle through matches
  - Close button (X)

### Results Dropdown
- Appears below the search input when matches are found.
- Lists all matches with:
  - Page number
  - Text snippet with the search term bolded for context (e.g., `Page 2 — "...patient experienced **chest** pain..."`)
- Clicking a result:
  1. Scrolls the PDF to that page
  2. Highlights the word on the page via PDF.js text layer
- Active/selected match is visually distinguished in the list.

## Search Logic

### Search Source
- Searches against OCR `results[].text` data (case-insensitive).
- OCR text is the primary search source since it reliably covers scanned and image-based PDFs.

### Match Building
- Search is debounced (300ms) to avoid excessive re-computation while typing.
- For each OCR result page, find all occurrences of the search term in the text.
- Build a flat list of matches: `{ page, snippetText, matchIndexInPage }`.
- Snippet extracts ~40 characters of surrounding context around the match.

### Navigation
- Prev/next buttons cycle through the flat match list sequentially.
- Each navigation triggers `handleNavigateToPage(page)` to scroll the PDF viewer.
- The current match index is tracked to support prev/next cycling.

## Highlight Strategy

### PDF.js Text Layer (best-effort word highlight)
- Enable `renderTextLayer={true}` in PdfViewer (currently `false`).
- Use PDF.js find controller to highlight matching words directly on the page.
- This works when the PDF has embedded text (many scanned PDFs include an OCR text layer).
- Highlighted words get a visible background color via CSS targeting `.textLayer .highlight` spans.

### Fallback (page-level)
- When PDF.js text layer has no content for a page (pure image PDF), fall back to:
  - Page-level highlight ring (reuses existing `highlightedPage` ring animation).
  - The results dropdown snippet serves as confirmation of the match.

## Component Structure

### New: `PdfSearchBar.tsx`
- Floating overlay component.
- Props: `ocrResults`, `onNavigateToPage`, `onSearchTermChange`, `onClose`.
- Manages: search input state, match list computation, current match index, prev/next cycling.
- Renders: input, match count, results dropdown list, prev/next/close buttons.

### Modified: `PdfViewer.tsx`
- Enable `renderTextLayer={true}` on `<Page>` components.
- Accept new prop `searchTerm: string` to pass to PDF.js find controller.
- Add CSS for text layer highlight styling (`.textLayer .highlight`).
- Integrate with `pdfjs` find controller API to trigger search and highlight when `searchTerm` changes.

### Modified: `SplitPane.tsx`
- Add search icon button to the toolbar (right side, near zoom controls).
- Add `Cmd/Ctrl+F` keyboard event listener (scoped to the PDF pane).
- Manage search state: `isSearchOpen`, `searchTerm`.
- Render `PdfSearchBar` as a child of the PDF pane container.
- Pass OCR `results` to PdfSearchBar for searching.

## Data Flow

```
User types search term
        │
        ▼
PdfSearchBar filters OCR results[] text
        │
        ▼
Builds match list [{page, snippet, index}]
        │
        ├──► Displays match count + results dropdown
        │
        ▼
User clicks a match (or prev/next)
        │
        ├──► Calls onNavigateToPage(page) → PdfViewer scrolls to page
        │
        └──► Calls onSearchTermChange(term) → PdfViewer triggers PDF.js
             find controller → highlights word on text layer (best-effort)
```

## Styling

- Search bar: semi-transparent dark background (`bg-slate-800/90`), backdrop blur, rounded corners, consistent with existing toolbar aesthetic.
- Results dropdown: scrollable list, max height ~200px, white background with subtle border.
- Active match in list: blue highlight background.
- PDF text layer highlights: yellow background on matched words (CSS on `.textLayer .highlight`).
- Page highlight ring: reuses existing blue ring animation from PdfViewer.

## Edge Cases

- **No matches:** Display "No matches found" in the results area.
- **Empty search input:** No search performed, results list hidden.
- **PDF still loading:** Search bar can be opened but shows "Document loading..." until OCR results are available.
- **Very many matches:** Results dropdown is scrollable; performance should be fine since we're searching in-memory OCR text (not re-processing the PDF).
