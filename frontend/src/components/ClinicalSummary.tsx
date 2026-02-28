'use client';

import { useState, useEffect, useRef } from 'react';
import {
    ExclamationTriangleIcon,
    BeakerIcon,
    HeartIcon,
    CalendarDaysIcon,
    UserIcon,
    BuildingOffice2Icon,
    DocumentTextIcon,
    ClockIcon,
    ShieldExclamationIcon,
    CheckCircleIcon,
    ArrowPathIcon,
    Squares2X2Icon,
    ListBulletIcon,
    UserCircleIcon,
    PaperAirplaneIcon,
    MicrophoneIcon,
    SpeakerWaveIcon
} from '@heroicons/react/24/outline';

/* ─── Type Definitions ─── */

interface CriticalFlag { flag: string; page: number; severity: string }
interface AbnormalFinding { finding: string; value: string; reference: string; page: number; severity: string }
interface GroupItem { label: string; value: string; page: number; status: string | null; reference: string | null }
interface Group { title: string; items: GroupItem[] }
interface TimelineEvent { date: string; event: string; page: number; category: string }

interface PatientEntry {
    patient_name?: string | null;
    date_of_birth?: string | null;
    patient_id?: string | null;
    visit_date?: string | null;
    provider?: string | null;
    facility?: string | null;
    chief_complaint?: string | null;
    follow_up?: string | null;
    summary?: string | null;
    pages?: number[];
}

interface SummaryData {
    status?: string;
    message?: string;
    document_type?: string;
    clinical_summary?: string;
    patients?: PatientEntry[];
    // Legacy single-patient fields (backwards compatibility)
    chief_complaint?: string | null;
    follow_up?: string | null;
    patient_name?: string | null;
    date_of_birth?: string | null;
    patient_id?: string | null;
    visit_date?: string | null;
    provider?: string | null;
    facility?: string | null;
}

interface FlagsData {
    status?: string;
    message?: string;
    critical_flags?: CriticalFlag[];
    abnormal_findings?: AbnormalFinding[];
}

interface DetailsPatient {
    patient_name: string;
    groups: Group[];
}
interface DetailsData {
    status?: string;
    message?: string;
    patients?: DetailsPatient[];
    groups?: Group[];
}
interface TimelineData { status?: string; message?: string; timeline?: TimelineEvent[] }

interface ClinicalSummaryProps { fileId: string; rawResults?: { page: number; text: string }[] | null }

type TabId = 'summary' | 'alerts' | 'timeline' | 'details';

/* ─── Category Styles ─── */

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    visit: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    test: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
    procedure: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
    prescription: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    'follow-up': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    billing: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
};

const GROUP_ICONS: Record<string, string> = {
    'Diagnoses': '🩺', 'Medications': '💊', 'Lab Results': '🧪',
    'Vital Signs': '📊', 'Allergies': '⚠️', 'Procedures': '🔬',
    'Imaging': '📷', 'Clinical Notes': '📋', 'Line Items': '📦',
    'Payment Details': '💳',
};


export default function ClinicalSummary({ fileId, rawResults }: ClinicalSummaryProps) {
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [flagsData, setFlagsData] = useState<FlagsData | null>(null);
    const [detailsData, setDetailsData] = useState<DetailsData | null>(null);
    const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
    const [pageCount, setPageCount] = useState(0);

    const [summaryLoading, setSummaryLoading] = useState(true);
    const [flagsLoading, setFlagsLoading] = useState(true);
    const [detailsLoading, setDetailsLoading] = useState(true);
    const [timelineLoading, setTimelineLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<TabId>('summary');
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handleSpeak = async (text: string) => {
        if (isSpeaking) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            // Also stop browser TTS fallback
            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            setIsSpeaking(false);
            return;
        }

        try {
            setIsSpeaking(true);
            const res = await fetch('/api/ai/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });

            const data = await res.json();
            if (data.audio) {
                const mime = data.mimeType || 'audio/mpeg';
                console.log(`[Audio] Playing ${data.audio.length} bytes of ${mime}...`);
                const audioUrl = `data:${mime};base64,${data.audio}`;
                const audio = new Audio(audioUrl);
                audioRef.current = audio;
                audio.onended = () => {
                    setIsSpeaking(false);
                    audioRef.current = null;
                };
                await audio.play();
            } else {
                console.log("Free service ran (Browser TTS Fallback)");
                console.error("[Audio] API returned no audio data, falling back to browser TTS");
                const utterance = new SpeechSynthesisUtterance(text);

                // Select Google US Voice if available
                const voices = window.speechSynthesis.getVoices();
                const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('en-US'));
                if (preferredVoice) utterance.voice = preferredVoice;

                utterance.onend = () => setIsSpeaking(false);
                utterance.onerror = () => setIsSpeaking(false);
                window.speechSynthesis.speak(utterance);
            }
        } catch (err) {
            console.log("Free service ran (Browser TTS Fallback)");
            console.error("[Audio] Playback exception, falling back to browser TTS:", err);
            const utterance = new SpeechSynthesisUtterance(text);

            // Select Google US Voice if available
            const voices = window.speechSynthesis.getVoices();
            const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('en-US'));
            if (preferredVoice) utterance.voice = preferredVoice;

            utterance.onend = () => setIsSpeaking(false);
            utterance.onerror = () => setIsSpeaking(false);
            window.speechSynthesis.speak(utterance);
        }
    };

    // Fire all 4 granular calls in parallel, with polling for 'processing' state
    const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!fileId) return;

        const base = '/api/ai';

        // Track which sections still need data
        const needsRefetch = { summary: true, flags: true, details: true, timeline: true };

        const fetchSection = async <T,>(endpoint: string, setter: (d: T | null | { status: string, message: string }) => void, loadingSetter: (b: boolean) => void, key: keyof typeof needsRefetch, countSetter?: (n: number) => void) => {
            try {
                const res = await fetch(`${base}/${endpoint}/${fileId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();

                if (json.status === 'processing') {
                    setter({ status: 'processing', message: json.message || "Processing document..." });
                    // Still needs refetch
                } else if (json.data) {
                    setter(json.data as T);
                    needsRefetch[key] = false; // Got real data
                } else {
                    setter(null);
                    // null = no data yet, keep polling
                }

                if (countSetter && json.page_count) countSetter(json.page_count);
            } catch (err) {
                console.error(`Failed to fetch ${endpoint}:`, err);
                setter(null);
            } finally {
                loadingSetter(false);
            }
        };

        const fetchAll = async (isInitial: boolean) => {
            const promises: Promise<void>[] = [];
            if (isInitial || needsRefetch.summary)
                promises.push(fetchSection<SummaryData>('summary', setSummaryData, isInitial ? setSummaryLoading : () => { }, 'summary', setPageCount));
            if (isInitial || needsRefetch.flags)
                promises.push(fetchSection<FlagsData>('flags', setFlagsData, isInitial ? setFlagsLoading : () => { }, 'flags'));
            if (isInitial || needsRefetch.details)
                promises.push(fetchSection<DetailsData>('details', setDetailsData, isInitial ? setDetailsLoading : () => { }, 'details'));
            if (isInitial || needsRefetch.timeline)
                promises.push(fetchSection<TimelineData>('timeline', setTimelineData, isInitial ? setTimelineLoading : () => { }, 'timeline'));
            await Promise.all(promises);

            // Check if we still need polling
            const stillNeeds = Object.values(needsRefetch).some(v => v);
            if (!stillNeeds && pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
            return stillNeeds;
        };

        // Initial fetch
        fetchAll(true).then(needsMore => {
            if (needsMore) {
                // Start polling every 5s for sections that still need data
                pollTimerRef.current = setInterval(() => fetchAll(false), 5000);
            }
        });

        return () => {
            if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
        };
    }, [fileId, rawResults?.length]);

    // Auto-switch to summary when first AI results arrive
    useEffect(() => {
        if (summaryData && activeTab === 'summary') {
            // Already on summary, no-op
        }
    }, [summaryData, activeTab]);

    const allLoading = summaryLoading && flagsLoading && detailsLoading && timelineLoading;

    const hasCriticalFlags = flagsData?.critical_flags && flagsData.critical_flags.length > 0;
    const hasAbnormals = flagsData?.abnormal_findings && flagsData.abnormal_findings.length > 0;
    const hasTimeline = timelineData?.timeline && timelineData.timeline.length > 0;
    const hasGroups = (detailsData?.groups && detailsData.groups.length > 0) || (detailsData?.patients && detailsData.patients.length > 0);

    const TABS: { id: TabId; label: string; icon: string; badge?: number; loading: boolean }[] = [
        { id: 'summary', label: 'Overview', icon: '📝', loading: summaryLoading },
        { id: 'alerts', label: 'Alerts', icon: '⚠️', badge: (flagsData?.critical_flags?.length || 0) + (flagsData?.abnormal_findings?.length || 0), loading: flagsLoading },
        { id: 'timeline', label: 'Timeline', icon: '📅', badge: timelineData?.timeline?.length, loading: timelineLoading },
        { id: 'details', label: 'Details', icon: '📋', badge: detailsData?.patients?.length || detailsData?.groups?.length, loading: detailsLoading },
    ];

    return (
        <div className="h-full flex flex-row flex-1 min-h-0 bg-white overflow-hidden">
            {/* ═══ Left Sidebar (AI Analysis & Tabs) ═══ */}
            <div className="w-[72px] sm:w-[110px] flex flex-col border-r border-slate-200 bg-slate-50/50 shrink-0">
                <div className="flex flex-col items-center justify-center px-2 py-4 border-b border-slate-200 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 shrink-0 shadow-sm text-center">
                    <span className="text-3xl drop-shadow-sm animate-pulse" title="Clinical Intelligence OCR">🏥</span>
                </div>

                <div className="flex flex-col py-3 w-full gap-2 px-1.5 pointer-events-auto shrink-0 flex-1 overflow-y-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex flex-col items-center gap-1 py-3 px-1 rounded-xl text-center transition-all relative ${activeTab === tab.id
                                ? 'bg-white shadow-sm ring-1 ring-slate-200 active-tab-indicator'
                                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                                }`}
                            title={tab.label}
                        >
                            {tab.loading ? (
                                <div className="w-6 h-6 border-2 border-transparent border-t-blue-400 rounded-full animate-spin mb-1"></div>
                            ) : (
                                <span className="text-xl sm:text-2xl drop-shadow-sm mb-0.5">{tab.icon}</span>
                            )}
                            <span className={`hidden sm:block text-[10px] uppercase font-bold tracking-wider ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-500'}`}>
                                {tab.label}
                            </span>
                            {!tab.loading && tab.badge !== undefined && tab.badge > 0 && (
                                <span className={`absolute top-1.5 right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[9px] rounded-full font-bold border shadow-sm ${activeTab === tab.id ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-red-50 text-red-600 border-red-100'}`}>
                                    {tab.badge}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══ Right Block (Content) ═══ */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                {/* ─── Analysis Header ─── */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-slate-100 bg-white/50 backdrop-blur-sm z-10 shrink-0 gap-3">
                    <h2 className="text-base sm:text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <span className="w-6 h-6 sm:w-8 sm:h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-100">
                            <DocumentTextIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                        </span>
                        Clinical Intelligence
                    </h2>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <button
                            onClick={() => {
                                console.log("[VoiceQA] Dispatching open event...");
                                window.dispatchEvent(new CustomEvent('open-voice-assistant'));
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-xl shadow-blue-100 hover:bg-blue-700 hover:-translate-y-0.5 transition-all active:translate-y-0"
                        >
                            <MicrophoneIcon className="w-4 h-4" />
                            Ask AI Assistant
                        </button>
                        {isSpeaking && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg animate-pulse">
                                <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Audio Playback</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* ═══ Tab Content ═══ */}
                <div className="flex-1 overflow-y-auto w-full">

                    {/* ── ALERTS TAB ── */}
                    {activeTab === 'alerts' && (
                        <div className="p-5 space-y-4 max-w-4xl">
                            {flagsLoading ? (
                                <LoadingCard text="Scanning for critical flags..." />
                            ) : flagsData?.status === 'processing' ? (
                                <LoadingCard text={flagsData?.message || "Awaiting OCR..."} />
                            ) : flagsData === null ? (
                                <LoadingCard text="Waiting for text..." />
                            ) : (hasCriticalFlags || hasAbnormals) ? (
                                <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 shadow-sm">
                                    <div className="flex items-center gap-3 mb-5 border-b border-red-100 pb-3">
                                        <ShieldExclamationIcon className="w-7 h-7 text-red-600" />
                                        <h3 className="text-lg font-bold text-red-800 uppercase tracking-wider">Critical Alerts Detected</h3>
                                    </div>

                                    <div className="space-y-6">
                                        {hasCriticalFlags && (
                                            <div>
                                                <h4 className="text-sm font-semibold text-red-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-red-600"></div> Direct Flags
                                                </h4>
                                                <div className="space-y-3">
                                                    {flagsData?.critical_flags?.map((cf, i) => (
                                                        <div key={`flag-${i}`} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white/70 p-3 rounded-xl border border-red-100 shadow-sm">
                                                            <div className="flex items-start gap-2.5 text-red-800 font-medium leading-relaxed">
                                                                <ExclamationTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" />
                                                                <span className="text-[15px]">{cf.flag}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <PageBadge page={cf.page} />
                                                                <SeverityBadge severity={cf.severity} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {hasAbnormals && (
                                            <div>
                                                <h4 className="text-sm font-semibold text-red-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-amber-500"></div> Abnormal Findings
                                                </h4>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    {flagsData?.abnormal_findings?.map((af, i) => (
                                                        <div key={`abnormal-${i}`} className="flex flex-col bg-white/80 rounded-xl p-4 shadow-sm border border-red-100">
                                                            <div className="flex justify-between items-start mb-2 border-b border-slate-100 pb-2">
                                                                <span className="font-bold text-slate-800">{af.finding}</span>
                                                                <PageBadge page={af.page} />
                                                            </div>
                                                            <div className="flex items-baseline gap-2 mb-1">
                                                                <span className="text-sm text-slate-500">Value:</span>
                                                                <span className="text-lg font-bold text-red-600"> {af.value}</span>
                                                            </div>
                                                            <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div> Reference: {af.reference}
                                                            </span>
                                                            <div className="mt-3 text-right">
                                                                <SeverityBadge severity={af.severity} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-12 bg-emerald-50 border-2 border-emerald-100 rounded-2xl text-emerald-700">
                                    <CheckCircleIcon className="w-16 h-16 text-emerald-500 mb-4" />
                                    <h3 className="text-xl font-bold uppercase tracking-wider mb-2">Clean Bill of Health</h3>
                                    <p className="text-emerald-600/80 font-medium">No critical alerts or abnormal findings detected.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── SUMMARY TAB ── */}
                    {activeTab === 'summary' && (
                        <div className="p-5 space-y-4">
                            {summaryLoading ? (
                                <LoadingCard text="Generating clinical summary..." />
                            ) : summaryData?.status === 'processing' ? (
                                <LoadingCard text={summaryData?.message || "Awaiting OCR..."} />
                            ) : summaryData ? (
                                <>
                                    {/* Document Type + Overall Summary */}
                                    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <DocumentTextIcon className="w-5 h-5 text-blue-600" />
                                            <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                                                {summaryData.document_type || 'Document'}
                                            </span>
                                            {summaryData.patients && summaryData.patients.length > 1 && (
                                                <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2.5 py-0.5 rounded-full">
                                                    {summaryData.patients.length} Patients
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-start justify-between gap-4">
                                            {summaryData.clinical_summary && (
                                                <p className="text-sm text-slate-700 leading-relaxed flex-1">{summaryData.clinical_summary}</p>
                                            )}
                                            <button
                                                onClick={() => handleSpeak(summaryData.clinical_summary || '')}
                                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all shrink-0 shadow-sm border ${isSpeaking ? 'bg-indigo-600 text-white border-indigo-500 animate-pulse' : 'bg-white text-indigo-600 border-indigo-100 hover:bg-indigo-50'}`}
                                            >
                                                {isSpeaking ? <SpeakerWaveIcon className="w-4 h-4" /> : <SpeakerWaveIcon className="w-4 h-4 opacity-70" />}
                                                {isSpeaking ? 'Stop' : 'Listen'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Patient Cards — one per patient */}
                                    {summaryData.patients && summaryData.patients.length > 0 ? (
                                        summaryData.patients.map((patient, idx) => (
                                            <div key={idx} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                                {/* Patient Header */}
                                                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                                                    <div className="flex items-center gap-2">
                                                        <UserIcon className="w-4 h-4 text-slate-500" />
                                                        <h3 className="text-sm font-bold text-slate-800">
                                                            {patient.patient_name || `Patient ${idx + 1}`}
                                                        </h3>
                                                        {patient.patient_id && (
                                                            <span className="text-[10px] font-mono text-slate-400">MRN: {patient.patient_id}</span>
                                                        )}
                                                    </div>
                                                    {patient.pages && (
                                                        <div className="flex items-center gap-1">
                                                            {patient.pages.map(p => <PageBadge key={p} page={p} />)}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="p-4 space-y-3">
                                                    {/* Demographics Row */}
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {patient.date_of_birth && <InfoItem label="DOB" value={patient.date_of_birth} />}
                                                        {patient.visit_date && <InfoItem label="Visit Date" value={patient.visit_date} />}
                                                        {patient.provider && <InfoItem label="Provider" value={patient.provider} icon={<HeartIcon className="w-3.5 h-3.5" />} />}
                                                        {patient.facility && <InfoItem label="Facility" value={patient.facility} icon={<BuildingOffice2Icon className="w-3.5 h-3.5" />} />}
                                                    </div>

                                                    {/* Per-patient Summary */}
                                                    {patient.summary && (
                                                        <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-3">
                                                            {patient.summary}
                                                        </p>
                                                    )}

                                                    {/* Chief Complaint */}
                                                    {patient.chief_complaint && (
                                                        <div className="border-l-2 border-amber-300 pl-3">
                                                            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Chief Complaint</span>
                                                            <p className="text-sm text-slate-700 mt-0.5">{patient.chief_complaint}</p>
                                                        </div>
                                                    )}

                                                    {/* Follow-up */}
                                                    {patient.follow_up && (
                                                        <div className="bg-sky-50 border border-sky-100 rounded-lg p-3">
                                                            <div className="flex items-center gap-1.5 mb-1">
                                                                <ClockIcon className="w-3.5 h-3.5 text-sky-600" />
                                                                <span className="text-[10px] font-semibold text-sky-800 uppercase tracking-wider">Follow-up</span>
                                                            </div>
                                                            <p className="text-sm text-sky-700">{patient.follow_up}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        /* Legacy single-patient fallback */
                                        <>
                                            {(summaryData.patient_name || summaryData.provider || summaryData.facility) && (
                                                <div className="bg-white border border-slate-200 rounded-xl p-4">
                                                    <div className="flex items-center gap-2 mb-3">
                                                        <UserIcon className="w-5 h-5 text-slate-500" />
                                                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Patient Information</h3>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3">
                                                        {summaryData.patient_name && <InfoItem label="Name" value={summaryData.patient_name} />}
                                                        {summaryData.date_of_birth && <InfoItem label="DOB" value={summaryData.date_of_birth} />}
                                                        {summaryData.patient_id && <InfoItem label="Patient ID" value={summaryData.patient_id} />}
                                                        {summaryData.visit_date && <InfoItem label="Visit Date" value={summaryData.visit_date} />}
                                                        {summaryData.provider && <InfoItem label="Provider" value={summaryData.provider} icon={<HeartIcon className="w-3.5 h-3.5" />} />}
                                                        {summaryData.facility && <InfoItem label="Facility" value={summaryData.facility} icon={<BuildingOffice2Icon className="w-3.5 h-3.5" />} />}
                                                    </div>
                                                </div>
                                            )}
                                            {summaryData.chief_complaint && (
                                                <div className="border-l-2 border-amber-300 pl-3">
                                                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Chief Complaint</span>
                                                    <p className="text-sm text-slate-700 mt-0.5">{summaryData.chief_complaint}</p>
                                                </div>
                                            )}
                                            {summaryData.follow_up && (
                                                <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <ClockIcon className="w-5 h-5 text-sky-600" />
                                                        <h3 className="text-xs font-bold text-sky-800 uppercase tracking-wider">Follow-up</h3>
                                                    </div>
                                                    <p className="text-sm text-sky-700">{summaryData.follow_up}</p>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* ── AT A GLANCE ── */}
                                    {detailsLoading ? (
                                        <LoadingCard text="Extracting details..." small />
                                    ) : hasGroups ? (
                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2.5 pt-2">
                                                <div className="w-7 h-7 bg-indigo-100 rounded-lg flex items-center justify-center">
                                                    <ListBulletIcon className="w-4 h-4 text-indigo-600" />
                                                </div>
                                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">At a Glance</h3>
                                                <div className="flex-1 h-px bg-slate-200"></div>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {(detailsData?.groups || detailsData?.patients?.flatMap(p => p.groups) || []).map((g, i) => {
                                                    const abnormalCount = g.items.filter(it => it.status === 'abnormal').length;
                                                    const normalCount = g.items.filter(it => it.status === 'normal').length;
                                                    const isExpanded = expandedGroups.has(i);
                                                    const previewItems = g.items.slice(0, 3);
                                                    const hasMore = g.items.length > 3;
                                                    const displayItems = isExpanded ? g.items : previewItems;
                                                    return (
                                                        <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                                                            {/* Group Header */}
                                                            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
                                                                <div className="flex items-center gap-2.5">
                                                                    <span className="text-lg">{GROUP_ICONS[g.title] || '📄'}</span>
                                                                    <h4 className="text-sm font-bold text-slate-800">{g.title}</h4>
                                                                </div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-semibold">
                                                                        {g.items.length} item{g.items.length !== 1 ? 's' : ''}
                                                                    </span>
                                                                    {abnormalCount > 0 && (
                                                                        <span className="text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                                                            <ExclamationTriangleIcon className="w-3 h-3" />
                                                                            {abnormalCount}
                                                                        </span>
                                                                    )}
                                                                    {normalCount > 0 && abnormalCount === 0 && (
                                                                        <span className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                                                            <CheckCircleIcon className="w-3 h-3" />
                                                                            All Normal
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* Group Items */}
                                                            <div className="divide-y divide-slate-50">
                                                                {displayItems.map((item, ii) => (
                                                                    <div key={ii} className={`flex items-center justify-between px-4 py-2.5 text-sm ${item.status === 'abnormal' ? 'bg-red-50/40' : ''}`}>
                                                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                            {item.status === 'abnormal' && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                                                                            {item.status === 'normal' && <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                                                            <span className="font-medium text-slate-700 truncate">{item.label}</span>
                                                                        </div>
                                                                        <span className={`text-sm font-semibold tabular-nums ml-3 flex-shrink-0 ${item.status === 'abnormal' ? 'text-red-600' : 'text-slate-600'}`}>
                                                                            {item.value}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                            {/* Show More / Less */}
                                                            {hasMore && (
                                                                <button
                                                                    onClick={() => {
                                                                        setExpandedGroups(prev => {
                                                                            const next = new Set(prev);
                                                                            if (next.has(i)) next.delete(i); else next.add(i);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="w-full py-2 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-50 border-t border-slate-100 transition-colors"
                                                                >
                                                                    {isExpanded ? '▲  Show Less' : `▼  Show ${g.items.length - 3} More`}
                                                                </button>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : null}

                                    {/* ── EXTRACTED RECORDS (merged from Records tab) ── */}
                                    {rawResults && rawResults.length > 0 && (
                                        <div className="space-y-3 pt-2">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-7 h-7 bg-slate-100 rounded-lg flex items-center justify-center">
                                                    <DocumentTextIcon className="w-4 h-4 text-slate-500" />
                                                </div>
                                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Extracted Records</h3>
                                                <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">{rawResults.length} page{rawResults.length !== 1 ? 's' : ''}</span>
                                                <div className="flex-1 h-px bg-slate-200"></div>
                                            </div>
                                            <div className="space-y-3">
                                                {rawResults.map((r, i) => (
                                                    <div key={i} className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-100/70 border-b border-slate-200">
                                                            <PageBadge page={r.page} />
                                                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Page {r.page}</span>
                                                        </div>
                                                        <div className="px-4 py-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
                                                            {r.text}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <LoadingCard text="Waiting for text..." />
                            )}
                        </div>
                    )}

                    {/* ── TIMELINE TAB ── */}
                    {activeTab === 'timeline' && (
                        <div className="p-5">
                            {timelineLoading ? (
                                <LoadingCard text="Building timeline..." />
                            ) : timelineData?.status === 'processing' ? (
                                <LoadingCard text={timelineData?.message || "Awaiting OCR..."} />
                            ) : timelineData === null ? (
                                <LoadingCard text="Waiting for text..." />
                            ) : hasTimeline ? (
                                <div className="relative pl-8">
                                    <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-gradient-to-b from-blue-400 via-purple-300 to-slate-200 rounded-full"></div>
                                    <div className="space-y-5">
                                        {timelineData!.timeline!.map((ev, i) => {
                                            const style = CATEGORY_STYLES[ev.category] || CATEGORY_STYLES.visit;
                                            return (
                                                <div key={i} className="relative">
                                                    <div className={`absolute -left-[22px] top-1.5 w-3.5 h-3.5 rounded-full ${style.dot} border-2 border-white shadow-sm`}></div>
                                                    <div className={`${style.bg} border border-slate-100 rounded-xl p-3.5`}>
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className={`text-xs font-bold ${style.text}`}>{ev.date}</span>
                                                            <div className="flex items-center gap-2">
                                                                <PageBadge page={ev.page} />
                                                                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.bg} ${style.text} border`}>
                                                                    {ev.category}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <p className="text-sm text-slate-700">{ev.event}</p>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <EmptyState icon={<CalendarDaysIcon className="w-10 h-10 text-slate-200" />} text="No timeline events found" />
                            )}
                        </div>
                    )}

                    {/* ── DETAILS TAB ── */}
                    {activeTab === 'details' && (
                        <div className="p-5 space-y-4">
                            {detailsLoading ? (
                                <LoadingCard text="Extracting clinical details..." />
                            ) : detailsData?.status === 'processing' ? (
                                <LoadingCard text={detailsData?.message || "Awaiting OCR..."} />
                            ) : detailsData === null ? (
                                <LoadingCard text="Waiting for text..." />
                            ) : hasGroups ? (
                                <div className="space-y-8">
                                    {(detailsData!.patients || [{ patient_name: 'Document Level Findings', groups: detailsData!.groups || [] }]).map((patient, pidx) => (
                                        <div key={pidx} className="space-y-4">
                                            {/* Patient Header */}
                                            {detailsData!.patients && (
                                                <div className="flex items-center gap-2 mb-4">
                                                    <div className="bg-indigo-100 p-2 rounded-lg">
                                                        <UserIcon className="w-5 h-5 text-indigo-600" />
                                                    </div>
                                                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                                                        {patient.patient_name || 'Unknown Patient'}
                                                    </h2>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-1 gap-4">
                                                {patient.groups?.map((group, gi) => (
                                                    <div key={gi} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                        <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border-b border-slate-100">
                                                            <span className="text-lg">{GROUP_ICONS[group.title] || '📄'}</span>
                                                            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{group.title}</h3>
                                                            <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full font-bold">{group.items.length}</span>
                                                        </div>
                                                        <div className="divide-y divide-slate-50">
                                                            {group.items.map((item, ii) => (
                                                                <div key={ii} className={`flex items-center justify-between px-4 py-2.5 ${item.status === 'abnormal' ? 'bg-red-50/50' : ''}`}>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-2">
                                                                            {item.status === 'abnormal' && <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                                                                            {item.status === 'normal' && <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                                                                            <span className="text-sm font-medium text-slate-800 truncate">{item.label}</span>
                                                                        </div>
                                                                        {item.reference && <span className="text-[10px] text-slate-400 ml-5 block mt-0.5 font-medium">ref: {item.reference}</span>}
                                                                    </div>
                                                                    <div className="flex items-center gap-3 ml-3 flex-shrink-0 text-right">
                                                                        <span className={`text-sm font-semibold max-w-[200px] truncate ${item.status === 'abnormal' ? 'text-red-600' : 'text-slate-600'}`}>{item.value}</span>
                                                                        <PageBadge page={item.page} />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}

                                </div>
                            ) : (
                                <EmptyState icon={<Squares2X2Icon className="w-10 h-10 text-slate-200" />} text="No detailed findings to display" />
                            )}
                        </div>
                    )}


                </div>
            </div>
        </div>
    );
}

/* ─── Reusable Sub-Components ─── */

function PageBadge({ page }: { page: number }) {
    return (
        <span className="inline-flex items-center text-[10px] font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
            p.{page}
        </span>
    );
}

function SeverityBadge({ severity }: { severity: string }) {
    return (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${severity === 'CRITICAL' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
            {severity}
        </span>
    );
}

function InfoItem({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
    return (
        <div className="space-y-0.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {icon}{label}
            </div>
            <div className="text-sm font-medium text-slate-800">{value}</div>
        </div>
    );
}

function LoadingCard({ text, small }: { text: string; small?: boolean }) {
    return (
        <div className={`flex items-center gap-3 ${small ? 'p-3' : 'p-6'} bg-slate-50 rounded-xl border border-slate-100`}>
            <div className="w-5 h-5 border-2 border-transparent border-t-blue-400 rounded-full animate-spin flex-shrink-0"></div>
            <span className="text-sm text-slate-400">{text}</span>
        </div>
    );
}

function ErrorCard({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-3 p-4 bg-red-50 rounded-xl border border-red-100">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
            <span className="text-sm text-red-600">{text}</span>
        </div>
    );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-2">
            {icon}
            <p className="text-sm">{text}</p>
        </div>
    );
}
