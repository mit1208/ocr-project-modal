'use client';

import { useState, useEffect, useRef } from 'react';
import { MagnifyingGlassIcon, ChevronUpIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface SearchBarProps {
    onSearch: (query: string) => void;
    matchCount: number;
    currentMatch: number; // 0-indexed
    onNextMatch: () => void;
    onPrevMatch: () => void;
    onClose: () => void;
}

export default function SearchBar({ onSearch, matchCount, currentMatch, onNextMatch, onPrevMatch, onClose }: SearchBarProps) {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    useEffect(() => {
        const timeout = setTimeout(() => {
            onSearch(query);
        }, 200);
        return () => clearTimeout(timeout);
    }, [query, onSearch]);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="p-1.5 rounded-md bg-white border border-slate-200 shadow-sm hover:bg-slate-50 hover:shadow transition-all"
                title="Search text (Ctrl+F)"
            >
                <MagnifyingGlassIcon className="w-4 h-4 text-slate-600" />
            </button>
        );
    }

    return (
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg shadow-sm px-2 py-1">
            <MagnifyingGlassIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.shiftKey ? onPrevMatch() : onNextMatch();
                    } else if (e.key === 'Escape') {
                        setQuery('');
                        setIsOpen(false);
                        onClose();
                    }
                }}
                placeholder="Search words..."
                className="w-32 text-xs outline-none bg-transparent text-slate-700 placeholder-slate-400"
            />
            {query && (
                <>
                    <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : '0/0'}
                    </span>
                    <div className="flex items-center gap-0.5 border-l border-slate-200 pl-1">
                        <button
                            onClick={onPrevMatch}
                            disabled={matchCount === 0}
                            className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
                        >
                            <ChevronUpIcon className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                        <button
                            onClick={onNextMatch}
                            disabled={matchCount === 0}
                            className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
                        >
                            <ChevronDownIcon className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                    </div>
                </>
            )}
            <button
                onClick={() => {
                    setQuery('');
                    setIsOpen(false);
                    onClose();
                }}
                className="p-0.5 rounded hover:bg-slate-100 transition-colors"
            >
                <XMarkIcon className="w-3.5 h-3.5 text-slate-400" />
            </button>
        </div>
    );
}
