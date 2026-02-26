'use client';

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import FileUpload from '@/components/FileUpload';
import SplitPane from '@/components/SplitPane';
import { supabase } from '@/lib/supabase';
import VoiceQA from '@/components/VoiceAssistant';

type OcrResult = {
  filename: string;
  s3_key: string;
  results: { page: number; text: string; bounding_boxes?: number[][]; words?: string[] }[];
};

import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

// We export HomeContent so the dynamic route can reuse this entire component without copying/pasting 300 lines
export function HomeContent({ simulatedParams }: { simulatedParams?: URLSearchParams }) {
  const router = useRouter();
  const realSearchParams = useSearchParams();
  const searchParams = simulatedParams || realSearchParams;
  const fileIdFromUrl = searchParams.get('file_id');
  const caseIdFromUrl = searchParams.get('case_id');
  const [session, setSession] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [s3Url, setS3Url] = useState<string>('');
  const [ocrResults, setOcrResults] = useState<OcrResult | null>(null);
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);
  const [userDocuments, setUserDocuments] = useState<any[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchUserDocuments = useCallback(async (userId: string) => {
    setIsLoadingDocs(true);
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUserDocuments(data || []);
    } catch (err: any) {
      console.error('Error fetching documents:', err.message);
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetchUserDocuments(session.user.id);
    }
  }, [session, fetchUserDocuments]);

  // ─── Load results from file_id query parameter ───
  const fetchResultsFromSupabase = useCallback(async (fileId: string, userId?: string) => {
    try {
      const { data, error } = await supabase
        .from('ocr_results')
        .select('*')
        .eq('file_id', fileId)
        .order('page', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Because the original File object is gone after a refresh, 
        // we can extract the original filename from the stored fileId
        const extractedFileName = fileId.substring(fileId.indexOf('-') + 1) || 'Document.pdf';

        setOcrResults((prev) => ({
          filename: prev?.filename || extractedFileName,
          s3_key: prev?.s3_key || '',
          results: data.map((row) => ({ page: row.page, text: row.text })),
        }));
        setIsLoadingFromUrl(false);
        setIsLoading(false);
      } else {
        setStatusMessage('Waiting for processing results...');
      }
    } catch (err: any) {
      console.warn('Fetch from supabase failed:', err.message);
    }
  }, []);

  useEffect(() => {
    if (!fileIdFromUrl || file || !session) return;

    setIsLoadingFromUrl(true);
    setIsLoading(true);
    setStatusMessage('Loading document database...');

    // Try to grab the PDF proxy URL first if it is available
    fetchResultsFromSupabase(fileIdFromUrl, session?.user?.id);

    // Fetch the S3 Presigned URL to display the PDF immediately
    fetch(`/api/pdf-url?file_id=${fileIdFromUrl}&user_id=${session?.user?.id || ''}`)
      .then(r => r.json())
      .then(d => { if (d.url) setS3Url(d.url); })
      .catch(e => console.error("Failed to load PDF URL", e));

    const channel = supabase
      .channel(`results-url-${fileIdFromUrl}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ocr_results',
          filter: `file_id=eq.${fileIdFromUrl}`,
        },
        (payload) => {
          setOcrResults((prev) => {
            const freshResults = prev
              ? [...prev.results, { page: payload.new.page, text: payload.new.text }]
              : [{ page: payload.new.page, text: payload.new.text }];
            freshResults.sort((a, b) => a.page - b.page);
            return {
              filename: prev?.filename || 'Document.pdf',
              s3_key: prev?.s3_key || '',
              results: freshResults,
            };
          });
          setIsLoadingFromUrl(false);
          setIsLoading(false);
          setStatusMessage(`Processed page ${payload.new.page}...`);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fileIdFromUrl, file, fetchResultsFromSupabase, session]);

  const handleFileUpload = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsLoading(true);
    setError(null);
    setS3Url('');
    setOcrResults(null);
    setStatusMessage('Getting secure upload link...');

    try {
      // 1. Get S3 Presigned URL
      const res = await fetch('/api/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filename: selectedFile.name, contentType: selectedFile.type, userId: session?.user?.id }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'Failed to get upload link');
      }

      const { uploadUrl, objectKey, fileId, caseId } = await res.json();

      setStatusMessage('Uploading straight to AWS S3...');

      // 2. Upload file directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: selectedFile,
        headers: {
          'Content-Type': selectedFile.type,
        },
      });

      if (!uploadRes.ok) {
        throw new Error('Upload to S3 failed');
      }

      setStatusMessage('File processing via Step Functions... listening for results in real-time');

      setOcrResults({
        filename: selectedFile.name,
        s3_key: objectKey,
        results: [], // start empty
      });

      // Save the document metadata to supabase so we can list it in the dashboard
      if (session?.user?.id) {
        const { error: dbError } = await supabase.from('documents').insert({
          user_id: session.user.id,
          case_id: caseId,
          file_id: fileId,
          filename: selectedFile.name
        });
        if (dbError) {
          console.error("Failed to save document metadata:", dbError);
        }
      }

      setIsLoading(false); // Stop the main loader to let them see the split pane, maybe keep a small loader

      // Update the URL to include the fileId and caseId so it persists on reload
      router.push(`/${caseId}/${fileId}`);

      // 3. Listen to Supabase Realtime
      const channel = supabase
        .channel(`results-${fileId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ocr_results',
            filter: `file_id=eq.${fileId}`,
          },
          (payload) => {
            console.log('Realtime Page Inserted:', payload.new);
            setOcrResults((prev) => {
              if (!prev) return prev;
              const freshResults = [...prev.results, { page: payload.new.page, text: payload.new.text }];
              // Sort by page to keep in order
              freshResults.sort((a, b) => a.page - b.page);
              return { ...prev, results: freshResults };
            });
            setStatusMessage(`Processed page ${payload.new.page}...`);
          }
        )
        .subscribe();

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred');
      setIsLoading(false);
      setStatusMessage('');
    }
  };

  // Determine what to show
  const showUpload = !file && !fileIdFromUrl;
  const showSplitPane = file || (fileIdFromUrl && (isLoadingFromUrl || ocrResults));
  const fileMeta = useMemo(() => {
    if (ocrResults && !file) return { name: ocrResults.filename, size: 0, type: 'application/pdf' };
    if (file) return { name: file.name, size: file.size, type: file.type };
    return null;
  }, [ocrResults, file]);

  const displayFileName = ocrResults?.filename || file?.name || 'Document';
  const displayPageCount = ocrResults?.results?.length || 0;

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0F172A] p-6 relative overflow-hidden">
        {/* Decorative background blur */}
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px]"></div>

        <div className="w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-8 relative z-10">
          <div className="flex flex-col items-center text-center space-y-4 mb-10">
            <div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg ring-4 ring-blue-500/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight mb-2">MedDoc<span className="text-blue-500">AI</span></h1>
              <p className="text-slate-400 font-medium">Next-gen Medical Document Intelligence</p>
            </div>
          </div>

          <div className="auth-container">
            <Auth
              supabaseClient={supabase}
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: '#2563eb',
                      brandAccent: '#1d4ed8',
                    }
                  }
                }
              }}
              providers={['google']}
              onlyThirdPartyProviders
            />
          </div>

          <p className="text-center text-xs text-slate-500 mt-8">
            Secure, HIPAA-compliant document processing.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={showSplitPane ? "h-screen flex flex-col bg-[#F8FAFC] overflow-hidden" : "min-h-screen bg-[#F8FAFC] font-sans"}>
      {/* Dynamic Header */}
      {!showSplitPane && (
        <nav className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-600 rounded-lg shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
              </div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">MedDoc<span className="text-blue-600">AI</span></h1>
            </div>

            <div className="flex items-center space-x-4">
              <div className="hidden md:block text-right mr-2">
                <p className="text-xs font-semibold text-slate-900">{session.user.email}</p>
                <button onClick={() => supabase.auth.signOut()} className="text-[10px] text-slate-400 hover:text-red-500 font-bold uppercase tracking-wider transition-colors">Sign Out</button>
              </div>
              <div className="w-10 h-10 bg-slate-100 border border-slate-200 rounded-full flex items-center justify-center text-slate-600 font-bold shadow-sm">
                {session.user.email?.[0].toUpperCase()}
              </div>
            </div>
          </div>
        </nav>
      )}

      {/* Main Content Area */}
      <div className={showSplitPane ? "flex flex-col h-full" : "max-w-7xl mx-auto p-6 md:p-10 space-y-12"}>

        {showSplitPane && !error && (
          <div className="flex items-center justify-between py-3 px-6 bg-white border-b border-slate-200 shadow-sm relative z-10 shrink-0">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => { setFile(null); setOcrResults(null); setS3Url(''); router.push('/'); }}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors group"
                title="Back to Dashboard"
              >
                <svg className="w-5 h-5 text-slate-400 group-hover:text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                </svg>
              </button>
              <div className="h-6 w-[1px] bg-slate-200"></div>
              <div className="flex flex-col">
                <h3 className="text-sm font-bold text-slate-900 truncate max-w-[200px] md:max-w-md">{displayFileName}</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{ocrResults ? `${displayPageCount} Pages Processed` : statusMessage}</p>
              </div>
            </div>

            <button
              onClick={() => { setFile(null); setOcrResults(null); setS3Url(''); router.push('/'); }}
              className="flex items-center px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl hover:bg-slate-800 transition-all shadow-md active:scale-95"
            >
              <svg className="w-3.5 h-3.5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4"></path>
              </svg>
              NEW ANALYTICS
            </button>
          </div>
        )}

        {showUpload && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
            {/* Left Column: Stats & Welcome */}
            <div className="lg:col-span-1 space-y-6">
              <div className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm space-y-1">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Welcome back</h2>
                <p className="text-2xl font-black text-slate-900 truncate">Doc Insight</p>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-1 gap-4">
                <div className="p-6 bg-blue-600 rounded-3xl shadow-xl shadow-blue-200 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Total Docs</p>
                  <p className="text-3xl font-black mt-1">{userDocuments.length}</p>
                </div>
                <div className="p-6 bg-indigo-600 rounded-3xl shadow-xl shadow-indigo-200 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Extraction Capacity</p>
                  <p className="text-3xl font-black mt-1">Unlimited</p>
                </div>
              </div>

              <div className="hidden lg:block p-6 bg-slate-900 rounded-3xl text-white relative overflow-hidden group">
                <div className="relative z-10">
                  <p className="text-sm font-bold mb-2">Beta Access</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    You're using our high-speed Databricks OCR pipeline powered by GPU-accelerated Modal compute.
                  </p>
                </div>
                <div className="absolute right-[-20px] bottom-[-20px] w-24 h-24 bg-white/5 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500"></div>
              </div>
            </div>

            {/* Right Column: Upload & History */}
            <div className="lg:col-span-3 space-y-10">
              <section className="space-y-4">
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest pl-1">New Extraction</h2>
                <FileUpload onFileSelect={handleFileUpload} isLoading={isLoading} />
              </section>

              <section className="space-y-6">
                <div className="flex items-center justify-between pl-1">
                  <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Document Registry</h2>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">{userDocuments.length} Documents</span>
                </div>

                {isLoadingDocs ? (
                  <div className="flex justify-center py-20">
                    <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
                  </div>
                ) : userDocuments.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {userDocuments.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => router.push(`/${doc.case_id}/${doc.file_id}`)}
                        className="group flex flex-col p-5 bg-white border border-slate-200 rounded-2xl hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5 transition-all text-left relative overflow-hidden active:scale-[0.98]"
                      >
                        <div className="flex items-start justify-between relative z-10">
                          <div className="p-3 bg-slate-50 text-slate-400 group-hover:bg-blue-600 group-hover:text-white rounded-xl transition-all shadow-sm">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                            </svg>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                            <p className="text-[9px] text-blue-500 font-bold uppercase tracking-tighter mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">View Details →</p>
                          </div>
                        </div>

                        <div className="mt-5 relative z-10">
                          <h4 className="font-bold text-slate-900 truncate text-base leading-tight pr-4">{doc.filename}</h4>
                          <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">Case ID: {doc.case_id.substring(0, 12)}</p>
                        </div>

                        {/* Interactive decoration */}
                        <div className="absolute right-[-10px] bottom-[-10px] text-slate-50 opacity-0 group-hover:opacity-100 transition-all group-hover:scale-110">
                          <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z" /></svg>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                    <p className="text-slate-400 font-medium italic">Your document registry is empty.</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-6 bg-red-50 border-2 border-red-100 rounded-3xl shadow-sm text-center">
            <div className="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4 text-white shadow-lg">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </div>
            <h3 className="text-lg font-black text-red-900 mb-2">PROCESS FAILED</h3>
            <p className="text-sm text-red-700 font-medium mb-6 leading-relaxed">{error}</p>
            <button
              onClick={() => { setError(null); setIsLoading(false); setFile(null); setOcrResults(null); router.push('/'); setS3Url(''); }}
              className="w-full py-3 bg-red-600 text-white font-black rounded-2xl hover:bg-red-700 transition-all shadow-md active:scale-95"
            >
              TRY AGAIN
            </button>
          </div>
        )}

        {showSplitPane && !error && (
          <div className="flex-1 min-h-0 bg-white">
            <SplitPane
              file={file}
              fileMeta={ocrResults && !file ? { name: ocrResults.filename, size: 0, type: 'application/pdf' } : file ? { name: file.name, size: file.size, type: file.type } : null}
              s3Url={s3Url}
              results={ocrResults?.results || null}
              isLoading={isLoading && !ocrResults}
              statusMessage={statusMessage}
              fileId={fileIdFromUrl || undefined}
            />
            <VoiceQA fileId={fileIdFromUrl || ''} />
          </div>
        )}
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}
