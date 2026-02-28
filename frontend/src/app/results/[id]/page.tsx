'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SplitPane from '@/components/SplitPane';
import { supabase } from '@/lib/supabase';
import VoiceQA from '@/components/VoiceAssistant';

type OcrResult = {
    filename: string;
    s3_key: string;
    results: { page: number; text: string; bounding_boxes?: number[][]; words?: string[] }[];
};

const POLL_INTERVAL_MS = 3000;  // poll every 3s
const MAX_POLL_ATTEMPTS = 60;   // up to ~3 minutes

export default function ResultsPage() {
    const params = useParams();
    const router = useRouter();
    const fileId = params.id as string;

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<OcrResult | null>(null);
    const [s3Url, setS3Url] = useState<string>('');
    const [polling, setPolling] = useState(false);

    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const attemptRef = useRef(0);

    const fetchResults = useCallback(async (isRetry = false) => {
        try {
            if (!isRetry) setIsLoading(true);

            const { data, error: dbError } = await supabase
                .from('ocr_results')
                .select('*')
                .eq('file_id', fileId)
                .order('page', { ascending: true });

            if (dbError) throw dbError;

            if (data && data.length > 0) {
                // Data found — stop polling and display
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
                setPolling(false);
                setError(null);
                setResults({
                    filename: 'Document.pdf',
                    s3_key: `uploads/${fileId}`,
                    results: data.map((row) => ({ page: row.page, text: row.text })),
                });
                setS3Url(`http://localhost:8000/api/pdf-proxy?s3_key=${encodeURIComponent(`uploads/${fileId}`)}`);
                setIsLoading(false);
                return true;
            }
            return false;
        } catch (err: any) {
            if (!isRetry) setError(err.message || 'An unexpected error occurred');
            return false;
        } finally {
            if (!isRetry) setIsLoading(false);
        }
    }, [fileId]);

    // Initial fetch + start polling if no data
    useEffect(() => {
        if (!fileId) return;
        attemptRef.current = 0;

        const init = async () => {
            const found = await fetchResults(false);
            if (!found) {
                // No data yet — start polling
                setPolling(true);
                setError(null);
                pollRef.current = setInterval(async () => {
                    attemptRef.current += 1;
                    if (attemptRef.current >= MAX_POLL_ATTEMPTS) {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setPolling(false);
                        setError('No results ready for this Document ID yet. Please try refreshing.');
                        return;
                    }
                    await fetchResults(true);
                }, POLL_INTERVAL_MS);
            }
        };
        init();

        return () => {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        };
    }, [fileId, fetchResults]);

    return (
        <main className="h-[100dvh] flex flex-col bg-slate-50 overflow-hidden font-sans">
            {/* Compact Header */}
            <header className="flex items-center justify-between bg-white px-4 py-3 border-b border-slate-200 shrink-0 shadow-sm z-10">
                <div
                    className="flex items-center space-x-3 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => router.push('/')}
                >
                    <div className="p-1.5 bg-blue-600 rounded-lg shadow-sm">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                    <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                        MedDoc<span className="text-blue-600">AI</span>
                    </h1>
                </div>

                <button
                    onClick={() => router.push('/')}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                    Upload New File
                </button>
            </header>

            <div className="flex-1 flex flex-col min-h-0">
                {error && (
                    <div className="p-4 m-4 max-w-lg mx-auto bg-red-50 text-red-700 border border-red-200 rounded-lg shadow-sm">
                        <p className="font-medium">Error loading document</p>
                        <p className="text-sm">{error}</p>
                        <button
                            onClick={() => router.push('/')}
                            className="mt-2 text-sm font-semibold underline hover:text-red-800"
                        >
                            Go back home
                        </button>
                    </div>
                )}

                {isLoading && !error && !polling && (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <p className="text-slate-500 font-medium">Loading document and extracted text...</p>
                    </div>
                )}
                {polling && !results && (
                    <div className="flex flex-col items-center justify-center py-20 space-y-4">
                        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <p className="text-slate-600 font-medium">Waiting for OCR processing to complete...</p>
                        <p className="text-sm text-slate-400">This page will auto-update when results are ready</p>
                    </div>
                )}
                {!isLoading && results && (
                    <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-500 p-3">
                        <div className="flex justify-between items-center bg-white px-4 py-2 rounded-t-xl border border-b-0 border-slate-200 shrink-0">
                            <div className="flex items-center space-x-3">
                                <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-slate-900">{results.filename}</p>
                                    <p className="text-xs text-slate-500">{results.results.length} pages extracted • File ID: {fileId.split('-')[0]}...</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 min-h-0">
                            <SplitPane
                                file={null}
                                fileMeta={{ name: results.filename, size: 0, type: 'application/pdf' }}
                                s3Url={s3Url}
                                results={results.results}
                                isLoading={false}
                                statusMessage=""
                                fileId={fileId}
                            />
                        </div>
                        <VoiceQA fileId={fileId} />
                    </div>
                )}
            </div>
        </main>
    );
}
