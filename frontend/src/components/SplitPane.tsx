'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
    MagnifyingGlassPlusIcon,
    MagnifyingGlassMinusIcon,
    MagnifyingGlassIcon,
    DocumentTextIcon,
} from '@heroicons/react/24/outline';
import ClinicalSummary from './ClinicalSummary';
import PdfSearchBar from './PdfSearchBar';

const PdfViewer = dynamic<any>(() => import('./PdfViewer'), { ssr: false });

export interface OcrResultData {
    page: number;
    text: string;
    bounding_boxes?: number[][];
    words?: string[];
}

interface SplitPaneProps {
    file: File | null;
    fileMeta?: { name: string; size: number; type: string } | null;
    s3Url?: string;
    results: OcrResultData[] | null;
    isLoading?: boolean;
    statusMessage?: string;
    fileId?: string;
}

export default function SplitPane({ file, fileMeta, s3Url, results, isLoading, statusMessage, fileId }: SplitPaneProps) {
    const [currentPage, setCurrentPage] = useState(1);
    const [numPages, setNumPages] = useState<number>(0);
    const [scale, setScale] = useState(1.0);
    const [targetPage, setTargetPage] = useState<number | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const pdfPaneRef = useRef<HTMLDivElement>(null);

    // Use S3 URL if available, otherwise fall back to local blob from File
    const fileUrl = useMemo(() => {
        if (s3Url) return s3Url;
        if (file) return URL.createObjectURL(file);
        return '';
    }, [file, s3Url]);

    const fileName = fileMeta?.name || file?.name || 'Document';
    const isPdf = fileId ? true : (fileMeta?.type || file?.type || '') === 'application/pdf';

    const totalPages = numPages || (results ? Math.max(...results.map(r => r.page)) : 1);

    const zoomIn = () => setScale(s => Math.min(s + 0.2, 3.0));
    const zoomOut = () => setScale(s => Math.max(s - 0.2, 0.4));

    const handlePageChange = useCallback((page: number) => {
        setCurrentPage(page);
    }, []);

    const handleNavigateToPage = useCallback((page: number) => {
        setTargetPage(page);
    }, []);

    const handleLoadSuccess = useCallback((n: number) => {
        setNumPages(n);
    }, []);

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

    const handleSearchClose = useCallback(() => {
        setIsSearchOpen(false);
        setSearchTerm('');
    }, []);

    const handleSearchTermChange = useCallback((term: string) => {
        setSearchTerm(term);
    }, []);

    // No early return — show the layout even while PDF is loading

    return (
        <div className="flex flex-col w-full h-full rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-lg relative">

            {/* ─── Top Toolbar ─── */}
            <div className="flex flex-col sm:flex-row gap-y-2 items-center justify-between p-3 px-5 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-slate-100 shrink-0">
                {/* Left: Current page indicator */}
                <div className="flex items-center space-x-2 text-sm font-medium text-slate-700">
                    <span className="bg-white px-3 py-1 rounded-md border border-slate-200 shadow-sm tabular-nums">
                        Page {currentPage}
                    </span>
                    <span className="text-slate-400">/</span>
                    <span className="text-slate-500 tabular-nums">{totalPages || '—'}</span>
                </div>

                {/* Center: File Info */}
                <div className="flex items-center space-x-2 text-sm text-slate-500">
                    <DocumentTextIcon className="w-4 h-4" />
                    <span className="truncate max-w-[200px]">{fileName}</span>
                    {s3Url && (
                        <span className="text-xs bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-medium">S3</span>
                    )}
                </div>

                {/* Right: Search + Zoom */}
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => setIsSearchOpen((v) => !v)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border shadow-sm hover:shadow transition-all ${
                            isSearchOpen
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                        title="Search document"
                    >
                        <MagnifyingGlassIcon className="w-4 h-4 shrink-0" />
                        <span className="text-xs font-bold tracking-tight">Search</span>
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
            </div>

            {/* ─── Split Content ─── */}
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">

                {/* ═══ Left Pane: PDF Viewer ═══ */}
                <div ref={pdfPaneRef} className="relative w-full md:w-1/2 h-1/2 md:h-full border-b flex-shrink-0 md:flex-shrink md:border-b-0 md:border-r border-slate-200 bg-slate-100 overflow-auto">
                    {isSearchOpen && (
                        <PdfSearchBar
                            ocrResults={results}
                            onNavigateToPage={handleNavigateToPage}
                            onSearchTermChange={handleSearchTermChange}
                            onClose={handleSearchClose}
                        />
                    )}
                    {!fileUrl ? (
                        <div className="flex flex-col items-center justify-center h-full space-y-3">
                            <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                            <p className="text-sm text-slate-400">Loading document...</p>
                        </div>
                    ) : isPdf ? (
                        <PdfViewer
                            fileUrl={fileUrl}
                            scale={scale}
                            onLoadSuccess={handleLoadSuccess}
                            onPageChange={handlePageChange}
                            targetPage={targetPage}
                            searchTerm={searchTerm}
                        />
                    ) : (
                        <div className="w-full h-full overflow-auto flex items-center justify-center p-6">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={fileUrl}
                                alt="Uploaded document"
                                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                            />
                        </div>
                    )}
                </div>

                {/* ═══ Right Pane: Clinical Summary (AI-Powered) ═══ */}
                <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col bg-white min-w-0 md:border-l border-slate-200">
                    <div className="flex-1 min-h-0 flex flex-col">
                        {fileId ? (
                            <ClinicalSummary fileId={fileId} rawResults={results} onNavigateToPage={handleNavigateToPage} />
                        ) : isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4">
                                <div className="relative">
                                    <div className="w-14 h-14 border-4 border-slate-100 rounded-full"></div>
                                    <div className="absolute top-0 left-0 w-14 h-14 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
                                </div>
                                <div className="text-center space-y-1">
                                    <p className="font-medium text-slate-600 animate-pulse">
                                        {statusMessage || 'Processing document...'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Results will appear here automatically
                                    </p>
                                </div>
                            </div>
                        ) : results ? (
                            <div className="h-full flex flex-col p-6 overflow-auto bg-slate-50">
                                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-4 border-b border-slate-200 pb-2">Extracted Text</h3>
                                <div className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-slate-800 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex-1 overflow-auto">
                                    {results.map(r => r.text).join('\n\n')}
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                                <DocumentTextIcon className="w-12 h-12 text-slate-200" />
                                <p className="text-sm">Upload a document to see extracted text</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
