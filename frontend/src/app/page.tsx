'use client';

import { useState, useEffect, useRef, useCallback, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import FileUpload from '@/components/FileUpload';
import SplitPane from '@/components/SplitPane';
import { supabase } from '@/lib/supabase';
import VoiceQA from '@/components/VoiceAssistant';
import HeartbeatSignIn from '@/components/HeartbeatSignIn';
import SlmWorkspace from '@/components/SlmWorkspace';
import FeatureBanner from '@/components/FeatureBanner';
type OcrResult = {
  filename: string;
  s3_key: string;
  results: { page: number; text: string; bounding_boxes?: number[][]; words?: string[] }[];
};



// We export HomeContent so the dynamic route can reuse this entire component without copying/pasting 300 lines
export function HomeContent({ simulatedParams }: { simulatedParams?: URLSearchParams }) {
  const router = useRouter();
  const realSearchParams = useSearchParams();
  const searchParams = simulatedParams || realSearchParams;
  const pathname = usePathname();
  const fileIdFromUrl = searchParams.get('file_id');
  const caseIdFromUrl = searchParams.get('case_id');
  const [session, setSession] = useState<any>(undefined);
  const [isScrolled, setIsScrolled] = useState(false);

  // Track scroll position to update navbar aesthetic
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-redirect logic
  useEffect(() => {
    // Wait until we know for sure if a session exists or not
    if (session === undefined) return;

    if (session?.user?.id && pathname === '/') {
      router.push(`/dashboard/${session.user.id}`);
    } else if (!session && pathname.startsWith('/dashboard')) {
      // If we're on a dashboard route but no session is active, go home
      router.push('/');
    }
  }, [session, pathname, router]);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [s3Url, setS3Url] = useState<string>('');
  const [ocrResults, setOcrResults] = useState<OcrResult | null>(null);
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);
  const [userDocuments, setUserDocuments] = useState<any[]>([]);
  const [publicDocuments, setPublicDocuments] = useState<any[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [viewMode, setViewMode] = useState<'private' | 'public'>('private');
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

  const fetchPublicDocuments = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPublicDocuments(data || []);
    } catch (err: any) {
      console.error('Error fetching public documents:', err.message);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetchUserDocuments(session.user.id);
    }
    fetchPublicDocuments();
  }, [session, fetchUserDocuments, fetchPublicDocuments]);

  const toggleDocumentVisibility = async (doc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setIsLoadingDocs(true);
    try {
      const { error } = await supabase
        .from('documents')
        .update({ is_public: !doc.is_public })
        .eq('id', doc.id);

      if (error) throw error;

      // Refresh both lists to ensure consistency
      if (session?.user?.id) await fetchUserDocuments(session.user.id);
      await fetchPublicDocuments();
    } catch (err: any) {
      console.error('Error toggling visibility:', err.message);
      setError('Failed to update document visibility');
    } finally {
      setIsLoadingDocs(false);
    }
  };

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
        const extractedFileName = fileId.substring(fileId.indexOf('-') + 1) || 'Document.pdf';

        setOcrResults((prev) => ({
          filename: prev?.filename || extractedFileName,
          s3_key: prev?.s3_key || '',
          results: data.map((row) => ({ page: row.page, text: row.text })),
        }));
        setIsLoadingFromUrl(false);
        setIsLoading(false);
        setStatusMessage('✓ Ready to review');

        // Stop polling if it was running
        if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
        return true;
      } else {
        setStatusMessage('Waiting for processing results...');
        return false;
      }
    } catch (err: any) {
      console.warn('Fetch from supabase failed:', err.message);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!fileIdFromUrl || file) return;

    setIsLoadingFromUrl(true);
    setIsLoading(true);
    setStatusMessage('Loading document database...');

    // Initial fetch, then poll if no data
    const init = async () => {
      const found = await fetchResultsFromSupabase(fileIdFromUrl, session?.user?.id);
      if (!found) {
        // Start polling every 3s for up to ~3 min
        let attempts = 0;
        pollTimerRef.current = setInterval(async () => {
          attempts += 1;
          if (attempts >= 60) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setStatusMessage('No results available. Please try refreshing.');
            setIsLoading(false);
            return;
          }
          await fetchResultsFromSupabase(fileIdFromUrl, session?.user?.id);
        }, 3000);
      }
    };
    init();

    setS3Url(`/api/pdf/${encodeURIComponent(fileIdFromUrl)}`);

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
          setStatusMessage('✓ Ready to review');

          // Stop polling since realtime delivered data
          if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [fileIdFromUrl, file, fetchResultsFromSupabase, session]);

  const handleFileUpload = async (selectedFile: File, isPublic: boolean) => {
    setFile(selectedFile);
    setIsLoading(true);
    setError(null);
    setS3Url('');
    setOcrResults(null);
    setStatusMessage('Getting secure upload link...');

    try {
      const res = await fetch('/api/upload-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          contentType: selectedFile.type,
          userId: session?.user?.id,
          isPublic
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || 'Failed to get upload link');
      }

      const { uploadUrl, objectKey, fileId, caseId } = await res.json();

      setStatusMessage('Uploading straight to AWS S3...');

      // No metadata headers needed — the document record was pre-created
      // on the server side in Supabase by the /api/upload-url route.
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
        results: [],
      });

      setIsLoading(false);
      router.push(`/${caseId}/${fileId}`);

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

  const showUpload = !file && !fileIdFromUrl;
  const showSplitPane = file || (fileIdFromUrl && (isLoadingFromUrl || ocrResults));
  const fileMeta = useMemo(() => {
    if (ocrResults && !file) return { name: ocrResults.filename, size: 0, type: 'application/pdf' };
    if (file) return { name: file.name, size: file.size, type: file.type };
    return null;
  }, [ocrResults, file]);

  const displayFileName = ocrResults?.filename || file?.name || 'Document';
  const displayPageCount = ocrResults?.results?.length || 0;

  if (session === undefined) {
    return (
      <div className="min-h-[100dvh] bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!session && !fileIdFromUrl) {
    return (
      <main className="min-h-[100dvh] bg-zinc-950 text-[#FFFFFF] selection:bg-blue-100 selection:text-blue-600 overflow-x-hidden relative">
        {/* Global Atmospheric Pulsars */}
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          {/* Top Primary Pulsar */}
          <div className="absolute left-[-5%] top-[-5%] w-[600px] h-[600px] bg-blue-600/40 rounded-full blur-[160px] animate-pulse"></div>
          <div className="absolute right-[-5%] top-[5%] w-[500px] h-[500px] bg-indigo-600/35 rounded-full blur-[140px] animate-[pulse_8s_infinite]"></div>

          {/* Middle Accent Pulsars */}
          <div className="absolute left-[20%] top-[40%] w-[400px] h-[400px] bg-blue-500/30 rounded-full blur-[130px] animate-[pulse_12s_infinite]"></div>
          <div className="absolute right-[15%] top-[60%] w-[500px] h-[500px] bg-blue-400/25 rounded-full blur-[150px] animate-pulse"></div>

          {/* Bottom Anchor Pulsars */}
          <div className="absolute left-[-10%] bottom-[-5%] w-[700px] h-[700px] bg-blue-700/30 rounded-full blur-[180px] animate-pulse"></div>
          <div className="absolute right-[-10%] bottom-[-10%] w-[600px] h-[600px] bg-indigo-700/30 rounded-full blur-[160px] animate-[pulse_7s_infinite]"></div>

          {/* Decorative Data Grid Overlay */}
          <div className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
        </div>

        {/* Premium Navigation (Ethereal Glass) */}
        <nav className={`fixed top-0 w-full z-50 px-6 md:px-16 transition-all duration-700 ${isScrolled
          ? 'bg-black/10 backdrop-blur-lg py-4 border-b border-white/5'
          : 'bg-transparent py-8 border-b border-transparent'
          }`}>
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <div className="flex items-center group cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <div className="mr-3 w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20 group-hover:rotate-12 transition-all duration-500 neural-throb border border-white/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth="2.5" />
                  <path strokeLinecap="round" strokeWidth="2" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.636 5.636l2.121 2.121m8.486 8.486l2.121 2.121M5.636 18.364l2.121-2.121M18.364 5.636l-2.121 2.121" />
                </svg>
              </div>
              <h1 className="text-xl font-black tracking-tighter text-gradient-nav py-2 px-1">
                MedDoc<span className="text-blue-500 italic ml-0.5">AI</span>
              </h1>
            </div>
            <div className="flex items-center space-x-8 text-[12px] font-bold uppercase tracking-wider text-white">
              <button onClick={() => document.getElementById('login')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-white transition-colors border border-white/30 px-5 py-2 rounded-full hover:bg-white/10">Sign In</button>
              <button onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-blue-400 transition-colors border border-white/30 px-5 py-2 rounded-full hover:bg-white/10">About Me</button>
            </div>
          </div>
        </nav>

        {/* Hero Section */}
        <section className="pt-24 pb-10 px-10 relative z-10">
          <div className="max-w-5xl mx-auto text-center space-y-4 animate-in relative z-10">
            <div className="delay-1 animate-in opacity-0 fill-mode-forwards">
              <FeatureBanner onCtaClick={() => document.getElementById('archive')?.scrollIntoView({ behavior: 'smooth' })} />
            </div>
            <h1 className="text-4xl md:text-[64px] font-black tracking-tighter leading-[1.2] text-gradient py-2">
              Decipher Medical Data.
            </h1>
            <p className="text-base md:text-lg font-medium text-white/90 max-w-xl mx-auto leading-tight delay-1 animate-in opacity-0 fill-mode-forwards">
              Neural OCR & Intelligence for unstructured clinical records. <br className="hidden md:block" />
              Processing complex PDFs at GPU scale.
            </p>
            <div className="pt-1 delay-2 animate-in opacity-0 fill-mode-forwards flex flex-col md:flex-row items-center justify-center gap-4">
              <button
                onClick={() => document.getElementById('login')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-3 bg-white text-black text-[10px] font-black rounded-full hover:bg-zinc-200 transition-all shadow-2xl active:scale-95 uppercase tracking-widest w-full md:w-auto"
              >
                Analyze Records
              </button>
              <button
                onClick={() => document.getElementById('archive')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-8 py-3 bg-white/5 border border-white/10 text-white text-[10px] font-black rounded-full hover:bg-white/10 transition-all active:scale-95 uppercase tracking-widest w-full md:w-auto"
              >
                Explore Public Demo
              </button>
            </div>
          </div>

          {/* Dynamic Visual Component (Replacing static image) */}
          <div className="mt-4 max-w-4xl mx-auto relative h-[360px] border border-white/10 rounded-[2rem] bg-zinc-950/50 overflow-hidden group scan-line delay-3 animate-in opacity-0 fill-mode-forwards">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.1),transparent)] transition-opacity duration-1000"></div>

            {/* Mock Data Visualization */}
            <div className="relative z-10 p-6 h-full flex flex-col font-mono text-[9px] text-blue-500/40">
              <div className="flex justify-between items-center border-b border-white/5 pb-3 mb-3">
                <div className="flex space-x-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500/40"></div>
                  <div className="w-2 h-2 rounded-full bg-yellow-500/40"></div>
                  <div className="w-2 h-2 rounded-full bg-green-500/40"></div>
                </div>
                <div className="text-[8px] uppercase tracking-widest font-black text-white/50">Medical OCR Engine</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 flex-1 overflow-hidden">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <p className="text-white/60 font-black">SCANNING PATIENT_ID: 0x8F2A</p>
                    <div className="h-1 bg-white/5 w-full rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 w-2/3 animate-pulse"></div>
                    </div>
                  </div>
                  {[...Array(15)].map((_, i) => (
                    <div key={i} className="flex space-x-2 opacity-50">
                      <span className="text-blue-500/20">[{i.toString().padStart(2, '0')}]</span>
                      <span className="w-full h-1 bg-white/5 rounded-full relative overflow-hidden">
                        <div className="absolute inset-0 bg-blue-500/20" style={{ width: `${(35 + (i * 7) % 60)}%` }}></div>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="md:border-l border-white/5 md:pl-8 space-y-4">
                  <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/10 relative overflow-hidden">
                    <div className="absolute top-2 right-2 flex space-x-0.5">
                      {[...Array(5)].map((_, i) => (
                        <div key={i} className="ai-wave" style={{ animationDelay: `${i * 0.1}s` }}></div>
                      ))}
                    </div>
                    <p className="text-blue-400 font-black uppercase text-[8px] tracking-[0.2em] mb-1.5">Medical Note Analysis Active</p>
                    <p className="text-white/60 italic leading-tight text-[10px]">"Parsing unstructured clinic notes... Extracting patient history and vital indicators. Processing complete."</p>
                  </div>

                  {/* AI Assistant Simulated Hub */}
                  <div className="flex-1 flex flex-col items-center justify-center space-y-4 pt-4">
                    <div className="relative">
                      <div className="absolute inset-0 w-16 h-16 ai-orb-glow rounded-full"></div>
                      <div className="relative w-16 h-16 bg-blue-500/20 rounded-full border border-blue-500/40 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.2)]">
                        <svg className="w-8 h-8 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z" />
                        </svg>
                      </div>
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-[10px] font-black text-white/40 uppercase tracking-widest">Assistant Engine</p>
                      <p className="text-[9px] text-blue-500 font-bold">Awaiting User Query...</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Public Clinical Portal */}
        <section id="archive" className="max-w-6xl mx-auto px-6 py-20 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div className="space-y-4">
              <h2 className="text-xs font-black text-blue-500 uppercase tracking-[0.3em]">Interactive Showcase</h2>
              <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white">Public Demo Library.</h1>
              <p className="text-white font-medium max-w-lg">
                Explore de-identified clinical records to see the analysis engine in action. No sign-in required for these public demonstrations.
                <span className="block mt-2 text-[10px] text-white/50 italic">— Synthetic data created using Claude.</span>
              </p>
            </div>
            <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl backdrop-blur-md">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest leading-none mb-1">Total Records</p>
              <p className="text-2xl font-black text-blue-400">{publicDocuments.length}</p>
            </div>
          </div>

          {publicDocuments.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {publicDocuments.slice(0, 6).map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => router.push(`/${doc.case_id}/${doc.file_id}`)}
                  className="group p-6 bg-zinc-900/40 border border-white/5 rounded-[2.5rem] hover:border-blue-500/50 hover:bg-zinc-900/60 transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-10 h-10 bg-blue-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 scale-75 group-hover:scale-100 transition-transform duration-500">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </div>
                  </div>
                  <div className="flex flex-col h-full justify-between space-y-8">
                    <div className="space-y-4">
                      <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                      </div>
                      <h3 className="text-lg font-black text-white truncate group-hover:text-blue-400 transition-colors uppercase tracking-tight">{doc.filename}</h3>
                    </div>
                    <div className="flex items-center justify-between pt-4">
                      <span className="text-[9px] font-black text-white/50 uppercase tracking-widest">{new Date(doc.created_at).toLocaleDateString()}</span>
                      <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Explore →</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-white/5 rounded-[3rem] border border-dashed border-white/10">
              <p className="text-white/30 font-black uppercase tracking-widest">Archive Empty</p>
            </div>
          )}
        </section>

        {/* Unified Authentication Section */}
        <section id="login" className="py-20 px-6 bg-transparent relative z-10">
          <div className="max-w-xl mx-auto text-center space-y-8">
            <div className="space-y-6">
              <h2 className="text-4xl font-black tracking-tighter text-gradient py-2 px-1">Sign In Portal.</h2>
              <p className="text-base text-white/80 font-semibold italic">Sign in to access your records.</p>
            </div>

            <div className="bg-zinc-950/50 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl">
              <div className="auth-container">
                <HeartbeatSignIn />
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section id="about" className="py-32 px-6 relative z-10 bg-transparent">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
              {/* Profile Visual */}
              <div className="md:col-span-5 flex justify-center md:justify-end">
                <div className="relative group">
                  <div className="absolute inset-0 bg-blue-500 rounded-[3rem] blur-2xl opacity-20 group-hover:opacity-40 transition-opacity duration-700"></div>
                  <div className="relative w-64 h-80 bg-zinc-900 border border-white/10 rounded-[3rem] overflow-hidden group-hover:border-blue-500/50 transition-colors duration-500">
                    {/* Background Placeholder Content (Visible if no image) */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4 p-8">
                      <div className="w-full h-full border border-dashed border-white/10 rounded-[2rem] flex flex-col items-center justify-center space-y-4">
                        <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400">
                          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest leading-tight">Mit Patel</p>
                          <p className="text-[8px] font-black text-white/30 uppercase tracking-[0.3em] mt-1 italic">Lead Engineer</p>
                        </div>
                      </div>
                    </div>

                    {/* Actual Profile Image - Replace 'src' with your actual image path */}
                    <img
                      src="/profile.png"
                      alt="Mit Patel"
                      className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-1000 grayscale hover:grayscale-0 transition-all duration-700"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                      onLoad={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '1';
                      }}
                    />
                  </div>
                  {/* Floating Tech Tag */}
                  <div className="absolute -bottom-4 -right-4 bg-white/5 backdrop-blur-xl border border-white/10 px-6 py-4 rounded-3xl shadow-2xl">
                    <div className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-[10px] font-black text-white/80 uppercase tracking-widest">Systems Active</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile Content */}
              <div className="md:col-span-7 space-y-8 text-left">
                <div className="space-y-4">
                  <h2 className="text-xs font-black text-blue-500 uppercase tracking-[0.4em]">The Architect</h2>
                  <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-white leading-tight">
                    Mit <span className="text-blue-500">Patel.</span>
                  </h1>
                  <p className="text-white/90 font-medium text-lg md:text-xl max-w-lg leading-relaxed">
                    Engineering high-performance medical AI infrastructure to bridge the gap between unstructured clinical data and actionable research.
                  </p>
                </div>

                <div className="flex flex-wrap gap-4 pt-4">
                  <a
                    href="https://www.linkedin.com/in/mitpatel12/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative flex items-center space-x-4 px-8 py-4 bg-white text-black font-black rounded-full hover:bg-zinc-200 transition-all duration-500 hover:scale-[1.02] active:scale-95 shadow-2xl shadow-blue-500/10 uppercase tracking-widest text-[10px]"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                    </svg>
                    <span>Connect on LinkedIn</span>
                  </a>

                  <div className="flex items-center px-8 py-4 bg-white/5 border border-white/10 text-white/50 text-[10px] font-black rounded-full uppercase tracking-widest">
                    AI Systems Architect
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 bg-transparent relative z-10">
          <div className="max-w-6xl mx-auto flex justify-between items-center text-[9px] font-black text-white/20 tracking-[0.2em] uppercase">
            <p>© 2026 MedDocAI</p>
            <div className="flex items-center space-x-2">
              <span className="w-1 h-1 bg-blue-500 rounded-full"></span>
              <span>Secure Clinical Infrastructure</span>
            </div>
          </div>
        </footer>
      </main>
    )
  }

  return (
    <main className={showSplitPane ? "h-[100dvh] flex flex-col bg-zinc-950 overflow-hidden relative" : "min-h-[100dvh] bg-zinc-950 font-sans relative"}>
      {/* Global Atmospheric Pulsars */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Top Primary Pulsar */}
        <div className="absolute left-[-5%] top-[-5%] w-[600px] h-[600px] bg-blue-600/40 rounded-full blur-[160px] animate-pulse"></div>
        <div className="absolute right-[-5%] top-[5%] w-[500px] h-[500px] bg-indigo-600/35 rounded-full blur-[140px] animate-[pulse_8s_infinite]"></div>

        {/* Middle Accent Pulsars */}
        <div className="absolute left-[20%] top-[40%] w-[400px] h-[400px] bg-blue-500/30 rounded-full blur-[130px] animate-[pulse_12s_infinite]"></div>
        <div className="absolute right-[15%] top-[60%] w-[500px] h-[500px] bg-blue-400/25 rounded-full blur-[150px] animate-pulse"></div>

        {/* Bottom Anchor Pulsars */}
        <div className="absolute left-[-10%] bottom-[-5%] w-[700px] h-[700px] bg-blue-700/30 rounded-full blur-[180px] animate-pulse"></div>
        <div className="absolute right-[-10%] bottom-[-10%] w-[600px] h-[600px] bg-indigo-700/30 rounded-full blur-[160px] animate-[pulse_7s_infinite]"></div>

        {/* Decorative Data Grid Overlay */}
        <div className="absolute inset-0 opacity-[0.12] mix-blend-overlay"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}></div>
      </div>
      {/* Dynamic Header */}
      {!showSplitPane && (
        <nav className={`sticky top-0 z-50 px-6 md:px-16 transition-all duration-700 ${isScrolled
          ? 'bg-black/10 backdrop-blur-lg py-4 border-b border-white/5'
          : 'bg-transparent py-8 border-b border-transparent'
          }`}>
          <div className="max-w-[1600px] mx-auto flex items-center justify-between">
            <div className="flex items-center group cursor-pointer" onClick={() => router.push(session?.user?.id ? `/dashboard/${session.user.id}` : '/')}>
              <div className="mr-3 w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-2xl shadow-blue-500/20 group-hover:rotate-12 transition-all duration-500 neural-throb border border-white/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth="2.5" />
                  <path strokeLinecap="round" strokeWidth="2" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.636 5.636l2.121 2.121m8.486 8.486l2.121 2.121M5.636 18.364l2.121-2.121M18.364 5.636l-2.121 2.121" />
                </svg>
              </div>
              <h1 className="text-xl font-black tracking-tighter text-gradient-nav py-2 px-1">
                MedDoc<span className="text-blue-500 italic ml-0.5">AI</span>
              </h1>
            </div>

            {session?.user ? (
              <div className="flex items-center space-x-6">
                <div className="hidden md:flex items-center space-x-6 mr-4 border-r pr-6 border-white/10">
                  <button
                    onClick={() => setViewMode('private')}
                    className={`text-[12px] font-bold tracking-wider transition-all ${viewMode === 'private' ? 'text-white' : 'text-white/40 hover:text-white'}`}
                  >
                    PATIENT RECORDS
                  </button>
                  <button
                    onClick={() => setViewMode('public')}
                    className={`text-[12px] font-bold tracking-wider transition-all ${viewMode === 'public' ? 'text-blue-400' : 'text-white/40 hover:text-white'}`}
                  >
                    PUBLIC ARCHIVE
                  </button>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => supabase.auth.signOut()}
                    className="text-[11px] text-white/40 hover:text-red-400 font-bold uppercase tracking-wider transition-colors mr-2 hidden md:block"
                  >
                    SIGN OUT
                  </button>
                  <div className="w-9 h-9 bg-zinc-900 border border-white/10 rounded-full flex items-center justify-center text-white text-xs font-black shadow-inner ring-2 ring-white/5">
                    {session.user.email?.[0].toUpperCase()}
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => router.push('/')}
                className="text-[11px] text-white/60 hover:text-white font-bold uppercase tracking-widest transition-colors border border-white/20 px-5 py-2 rounded-full hover:bg-white/10"
              >
                Sign In
              </button>
            )}
          </div>
        </nav>
      )}

      {/* Main Content Area */}
      <div className={showSplitPane ? "flex flex-col h-full" : "max-w-7xl mx-auto p-6 md:p-8 space-y-8"}>

        {showSplitPane && !error && (
          <div className="flex items-center justify-between py-2 px-6 bg-black border-b border-white/5 shadow-sm relative z-10 shrink-0">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => { setFile(null); setOcrResults(null); setS3Url(''); router.push(session?.user?.id ? `/dashboard/${session.user.id}` : '/'); }}
                className="p-1.5 hover:bg-zinc-900 rounded-full transition-colors group"
                title="Back to Home"
              >
                <svg className="w-5 h-5 text-zinc-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
                </svg>
              </button>
              <div className="h-6 w-[1px] bg-white/10"></div>
              {/* Clickable brand logo — always links home */}
              <button
                onClick={() => { setFile(null); setOcrResults(null); setS3Url(''); router.push(session?.user?.id ? `/dashboard/${session.user.id}` : '/'); }}
                className="flex items-center space-x-2 hover:opacity-80 transition-opacity mr-2"
              >
                <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center shadow-lg border border-white/20">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="3" strokeWidth="2.5" />
                    <path strokeLinecap="round" strokeWidth="2" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.636 5.636l2.121 2.121m8.486 8.486l2.121 2.121M5.636 18.364l2.121-2.121M18.364 5.636l-2.121 2.121" />
                  </svg>
                </div>
                <span className="text-sm font-black tracking-tighter text-white hidden sm:inline">MedDoc<span className="text-blue-500 italic">AI</span></span>
              </button>
              <div className="h-6 w-[1px] bg-white/10"></div>
              <div className="flex flex-col">
                <h3 className="text-xs font-black text-white truncate max-w-[200px] md:max-w-md uppercase tracking-tight">{displayFileName}</h3>
                <p className="text-[9px] text-blue-500 font-black uppercase tracking-widest leading-none mt-0.5">{ocrResults && displayPageCount > 0 ? `${displayPageCount} Pages • ✓ Ready to review` : statusMessage}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Visibility Toggle in Header */}
              {userDocuments.find(d => d.file_id === fileIdFromUrl) && (
                <button
                  onClick={(e) => toggleDocumentVisibility(userDocuments.find(d => d.file_id === fileIdFromUrl), e)}
                  disabled={isLoadingDocs}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-black uppercase tracking-widest ${userDocuments.find(d => d.file_id === fileIdFromUrl)?.is_public
                    ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'
                    : 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                    }`}
                  title={userDocuments.find(d => d.file_id === fileIdFromUrl)?.is_public ? "Make Private" : "Make Public"}
                >
                  {userDocuments.find(d => d.file_id === fileIdFromUrl)?.is_public ? (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path></svg>
                      <span>Public</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                      <span>Private</span>
                    </>
                  )}
                </button>
              )}
              {/* Only show NEW ANALYSIS for signed-in users */}
              {session?.user?.id && (
                <button
                  onClick={() => { setFile(null); setOcrResults(null); setS3Url(''); router.push(session?.user?.id ? `/dashboard/${session.user.id}` : '/'); }}
                  className="flex items-center px-4 py-1.5 bg-white text-black text-[10px] font-black rounded-lg hover:bg-zinc-200 transition-all shadow-md active:scale-95"
                >
                  NEW ANALYSIS
                </button>
              )}
            </div>
          </div>
        )}

        {showUpload && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
            {/* Left Column: Stats & Welcome */}
            <div className="lg:col-span-1 space-y-6">
              <div className="relative p-8 bg-gradient-to-br from-indigo-900 to-slate-900 rounded-[2rem] shadow-2xl overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 rounded-full blur-3xl -mr-16 -mt-16 group-hover:bg-blue-500/30 transition-all"></div>
                <div className="relative z-10 space-y-4">
                  <div className="w-12 h-12 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20">
                    <svg className="w-6 h-6 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm4.59-12.42L10 14.17l-2.59-2.58L6 13l4 4 8-8z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">Medical Intelligence</h2>
                    <p className="text-4xl font-black text-white mt-1 tracking-tighter">Status: Active</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="p-6 bg-zinc-900 border border-white/10 rounded-3xl shadow-lg border-l-blue-500 border-l-4">
                  <p className="text-[11px] font-bold text-white/60 uppercase tracking-widest">Your Documents</p>
                  <p className="text-5xl font-black text-white mt-2 tracking-tighter">{userDocuments.length}</p>
                </div>
                <div className="p-6 bg-zinc-900 border border-white/10 rounded-3xl shadow-lg border-l-blue-400 border-l-4">
                  <p className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">Public Archive</p>
                  <p className="text-5xl font-black text-white mt-2 tracking-tighter">{publicDocuments.length}</p>
                </div>
              </div>

            </div>

            {/* Right Column: Upload & History */}
            <div className="lg:col-span-3 space-y-16">
              <section className="space-y-8">
                <SlmWorkspace
                  accessToken={session?.access_token || ''}
                  hasDocuments={userDocuments.length > 0}
                />
              </section>

              <section className="space-y-8">
                <div className="flex items-end justify-between px-2 text-white">
                  <div>
                    <h2 className="text-[11px] font-bold text-blue-500 uppercase tracking-widest leading-none mb-2">Processing Engine</h2>
                    <h1 className="text-5xl font-black text-white tracking-tighter">Initialize Analysis</h1>
                  </div>
                </div>
                <FileUpload onFileSelect={handleFileUpload} isLoading={isLoading} />
              </section>

              <section className="space-y-10 pt-8">
                <div className="flex flex-col md:flex-row items-center justify-between px-2 gap-4">
                  <div className="flex items-baseline space-x-4 md:space-x-6">
                    <button
                      onClick={() => setViewMode('private')}
                      className={`text-lg sm:text-2xl font-black transition-all ${viewMode === 'private' ? 'text-white underline decoration-blue-500 decoration-4 underline-offset-8' : 'text-white/20 hover:text-white/40'}`}
                    >
                      My Documents
                    </button>
                    <button
                      onClick={() => setViewMode('public')}
                      className={`text-lg sm:text-2xl font-black transition-all ${viewMode === 'public' ? 'text-white underline decoration-blue-400 decoration-4 underline-offset-8' : 'text-white/20 hover:text-white/40'}`}
                    >
                      Public Library
                    </button>
                  </div>
                  <span className="text-[11px] font-bold text-white bg-white/10 border border-white/20 px-4 py-2 rounded-full shadow-sm uppercase tracking-wider">
                    {viewMode === 'private' ? userDocuments.length : publicDocuments.length} Entries
                  </span>
                </div>

                {isLoadingDocs ? (
                  <div className="flex justify-center py-20">
                    <div className="w-12 h-12 border-4 border-white/5 border-t-blue-500 rounded-full animate-spin"></div>
                  </div>
                ) : (viewMode === 'private' ? userDocuments : publicDocuments).length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {(viewMode === 'private' ? userDocuments : publicDocuments).map((doc) => (
                      <div
                        key={doc.id}
                        onClick={() => router.push(`/${doc.case_id}/${doc.file_id}`)}
                        className="group flex flex-col p-6 bg-zinc-900/50 border border-white/5 rounded-3xl hover:border-blue-500 hover:shadow-2xl hover:shadow-blue-500/10 transition-all text-left relative overflow-hidden active:scale-[0.982] cursor-pointer"
                        style={{ borderLeftWidth: '4px', borderLeftColor: doc.is_public ? '#3b82f6' : '#2563eb' }}
                      >
                        <div className="flex items-start justify-between relative z-10 w-full">
                          <div className="flex items-center space-x-4">
                            <div className={`p-4 rounded-2xl transition-all shadow-md ${doc.is_public ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-600/10 text-blue-500 group-hover:bg-blue-600 group-hover:text-white'}`}>
                              {doc.is_public ? (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path>
                                </svg>
                              ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                </svg>
                              )}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className={`text-[11px] font-bold uppercase tracking-widest ${doc.is_public ? 'text-blue-400' : 'text-blue-500'}`}>
                                {doc.is_public ? 'DATABASE ENTRY' : 'PATIENT RECORD'}
                              </span>
                              <h4 className="font-bold text-white truncate text-xl leading-tight mt-1">{doc.filename}</h4>
                            </div>
                          </div>

                          {/* Visibility Toggle Button for owner */}
                          {viewMode === 'private' && (
                            <button
                              onClick={(e) => toggleDocumentVisibility(doc, e)}
                              disabled={isLoadingDocs}
                              className={`p-2 rounded-xl border transition-all group/toggle ${doc.is_public
                                ? 'border-blue-500/50 bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white'
                                : 'border-white/10 bg-white/5 text-white/20 hover:border-white/30 hover:text-white'
                                }`}
                              title={doc.is_public ? "Make Private" : "Make Public"}
                            >
                              {doc.is_public ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"></path>
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                                </svg>
                              )}
                            </button>
                          )}
                        </div>

                        <div className="mt-6 flex items-center justify-between relative z-10">
                          <div>
                            <p className="text-[10px] font-mono text-white/80 truncate max-w-[120px]">{doc.case_id.substring(0, 16).toUpperCase()}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] text-white/60 font-bold uppercase tracking-widest">{new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                            <span className="mt-1 text-[11px] font-bold text-blue-400 uppercase group-hover:text-white transition-colors tracking-wide">ANALYZE RECORD →</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-24 bg-zinc-950/50 border-2 border-dashed border-white/5 rounded-[3rem]">
                    <div className="w-16 h-16 bg-zinc-900 rounded-2xl shadow-sm mx-auto flex items-center justify-center text-white/10 mb-6">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    </div>
                    <p className="text-lg font-bold text-white">Records Empty</p>
                    <p className="text-sm text-white/30 mt-2 max-w-xs mx-auto font-medium">No medical records identified. Upload records to begin analysis.</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-md mx-auto p-10 bg-zinc-950 border border-white/10 rounded-[3rem] shadow-2xl text-center">
            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </div>
            <h3 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Access Denied</h3>
            <p className="text-white/40 font-medium mb-10 leading-relaxed text-sm">{error}</p>
            <button
              onClick={() => { setError(null); setIsLoading(false); setFile(null); setOcrResults(null); router.push(session?.user?.id ? `/dashboard/${session.user.id}` : '/'); setS3Url(''); }}
              className="w-full py-4 bg-white text-black font-black rounded-2xl hover:bg-zinc-200 transition-all shadow-xl active:scale-95"
            >
              RETRIEVE RECORDS
            </button>
          </div>
        )}

        {showSplitPane && !error && (
          <div className="flex-1 min-h-0 bg-black rounded-[2rem] border border-white/5 overflow-hidden">
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
      <main className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin"></div>
      </main>
    }>
      <HomeContent />
    </Suspense>
  );
}
