'use client';

import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up the PDF.js worker from CDN
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;



export interface PdfViewerProps {
    fileUrl: string;
    scale: number;
    onLoadSuccess: (numPages: number) => void;
    onPageChange?: (page: number) => void;
    targetPage?: number | null;
    searchTerm?: string;
}

const PdfViewer = memo(function PdfViewer({
    fileUrl,
    scale,
    onLoadSuccess,
    onPageChange,
    targetPage,
    searchTerm,
}: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);
    const [numPages, setNumPages] = useState(0);
    const [highlightedPage, setHighlightedPage] = useState<number | null>(null);
    const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

    // Track container width
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Track which page is most visible via IntersectionObserver
    useEffect(() => {
        if (!numPages || !onPageChange) return;

        const observer = new IntersectionObserver(
            (entries) => {
                let maxRatio = 0;
                let visiblePage = 1;
                entries.forEach((entry) => {
                    if (entry.intersectionRatio > maxRatio) {
                        maxRatio = entry.intersectionRatio;
                        const idx = pageRefs.current.indexOf(entry.target as HTMLDivElement);
                        if (idx >= 0) visiblePage = idx + 1;
                    }
                });
                if (maxRatio > 0) onPageChange(visiblePage);
            },
            {
                root: containerRef.current,
                threshold: [0, 0.25, 0.5, 0.75, 1],
            }
        );

        pageRefs.current.forEach((ref) => {
            if (ref) observer.observe(ref);
        });

        return () => observer.disconnect();
    }, [numPages, onPageChange]);

    useEffect(() => {
        if (!targetPage || !pageRefs.current[targetPage - 1]) return;
        const ref = pageRefs.current[targetPage - 1];
        if (ref) {
            ref.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setHighlightedPage(targetPage);
            const t = setTimeout(() => setHighlightedPage(null), 1500);
            return () => clearTimeout(t);
        }
    }, [targetPage]);

    // Highlight search term in text layer
    useEffect(() => {
        if (!containerRef.current) return;

        const applyHighlights = () => {
            if (!containerRef.current) return;
            const textLayers = containerRef.current.querySelectorAll('.react-pdf__Page__textContent');
            textLayers.forEach((layer) => {
                const allSpans = layer.querySelectorAll('span');
                allSpans.forEach((span) => {
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

    const handleLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
        setNumPages(n);
        pageRefs.current = new Array(n).fill(null);
        onLoadSuccess(n);
    }, [onLoadSuccess]);

    const memoizedFile = useMemo(() => fileUrl || null, [fileUrl]);

    if (!fileUrl) {
        return (
            <div className="flex flex-col items-center justify-center h-full space-y-3">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                <p className="text-sm text-slate-400">Waiting for document URL...</p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="w-full h-full overflow-auto" style={{ scrollBehavior: 'smooth' }}>
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
            <Document
                file={memoizedFile}
                onLoadSuccess={handleLoadSuccess}
                loading={
                    <div className="flex flex-col items-center justify-center py-20 space-y-3">
                        <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                        <p className="text-sm text-slate-400">Loading document from S3...</p>
                    </div>
                }
                error={
                    <div className="flex flex-col items-center justify-center py-20 text-red-400 space-y-2">
                        <p className="font-medium">Failed to load PDF</p>
                        <p className="text-sm">Please try uploading again.</p>
                    </div>
                }
            >
                <div className="flex flex-col items-center py-4 space-y-4">
                    {Array.from({ length: numPages }, (_, i) => (
                        <div
                            key={i}
                            ref={(el) => { pageRefs.current[i] = el; }}
                            className={`relative ${highlightedPage === i + 1 ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-100 rounded-lg' : ''}`}
                            data-page={i + 1}
                        >
                            {/* Page number badge */}
                            <div className="absolute top-2 left-2 z-10 bg-slate-800/70 text-white text-xs px-2 py-0.5 rounded-md font-medium backdrop-blur-sm">
                                {i + 1}
                            </div>
                            <div className="rounded-lg shadow-lg overflow-hidden bg-white">
                                <Page
                                    pageNumber={i + 1}
                                    scale={scale}
                                    width={containerWidth > 0 ? containerWidth - 48 : undefined}
                                    renderTextLayer={true}
                                    renderAnnotationLayer={false}
                                    loading={
                                        <div className="flex items-center justify-center h-[700px] w-[500px] bg-slate-50">
                                            <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
                                        </div>
                                    }
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </Document>
        </div>
    );
});

export default PdfViewer;
