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

    // Debounce query and reset active match
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query);
            setActiveMatchIndex(0);
        }, 300);
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
        if (matches.length === 0) return;
        setActiveMatchIndex((i) => (i + 1) % matches.length);
    }, [matches.length]);

    const goToPrev = useCallback(() => {
        if (matches.length === 0) return;
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
        },
        []
    );

    // Highlight the search term within a snippet
    const renderSnippet = useCallback(
        (snippet: string) => {
            if (!debouncedQuery.trim()) return snippet;
            const regex = new RegExp(`(${debouncedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            const parts = snippet.split(regex);
            return parts.map((part, i) =>
                part.toLowerCase() === debouncedQuery.toLowerCase() ? (
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
