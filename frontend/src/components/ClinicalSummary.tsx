'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

const BodyMap3D = dynamic(() => import('./BodyMap3D'), { ssr: false });
const IntakeSheet = dynamic(() => import('./IntakeSheet'), { ssr: false });
const ConsultationAssistant = dynamic(() => import('./ConsultationAssistant'), { ssr: false });
const IMESummaryBuilder = dynamic(() => import('./IMESummaryBuilder'), { ssr: false });
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
    SpeakerWaveIcon,
    SparklesIcon,
    PlusIcon,
    CalendarIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    ExclamationCircleIcon,
    CheckIcon
} from '@heroicons/react/24/outline';

/* ─── Type Definitions ─── */

interface CriticalFlag { flag: string; page: number; severity: string }
interface AbnormalFinding { finding: string; value: string; reference: string; page: number; severity: string }
interface GroupItem { label: string; value: string; page: number; status: string | null; reference: string | null }
interface Group { title: string; items: GroupItem[] }
interface TimelineEvent { date: string; event: string; page: number; category: string; patient_name?: string | null }
interface ChronologyEvent {
    id: string;
    date: string;
    description: string;
    pages: number[];
    category?: string;
    comments?: string;
    body_parts?: string[];
    defendants?: string[];
    significance?: string;
    phase?: 'pre' | 'post' | 'unknown';
    patient_name?: string | null;
}
interface ChronologyIssue {
    id: string;
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    event_ids?: string[];
    pages?: number[];
    patient_name?: string | null;
}
interface ChronologySettings {
    incident_date?: string | null;
    gap_days_threshold?: number | null;
    preferred_columns?: string[] | null;
    hidden_columns?: string[] | null;
    column_order?: string[] | null;
}
interface ChronologyVersion {
    version: number;
    label?: string | null;
    is_final?: boolean | null;
    created_at?: string | null;
    source?: string | null;
}
interface ChronologyData {
    status?: string;
    message?: string;
    chronology?: ChronologyEvent[];
    ai_chronology?: ChronologyEvent[];
    issues?: ChronologyIssue[];
    version?: number;
    source?: string;
    versions?: ChronologyVersion[];
    settings?: ChronologySettings;
    columns?: string[] | null;
}

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

type IntakeProblem = {
    id: string;
    description: string;
    icd10_code?: string | null;
    icd10_description?: string | null;
    status?: string | null;
    source_pages?: number[];
    source_text?: string | null;
    flags?: string[];
    hcc_relevant?: boolean;
    validated?: boolean;
    confidence?: string | null;
};

type IntakeMedication = {
    id: string;
    name?: string | null;
    dose?: string | null;
    frequency?: string | null;
    prescriber?: string | null;
    source_pages?: number[];
    source_text?: string | null;
    flags?: string[];
};

type IntakeWorkup = {
    id: string;
    description?: string | null;
    cpt_code?: string | null;
    cpt_description?: string | null;
    date?: string | null;
    key_findings?: string | null;
    status?: string | null;
    validated?: boolean;
    source_pages?: number[];
    referenced_on_page?: number | null;
};

type IntakeFlag = {
    id: string;
    type?: string | null;
    severity?: string | null;
    description?: string | null;
    explanation?: string | null;
    suggested_action?: string | null;
};

type ClinicalIntake = {
    problem_list?: IntakeProblem[];
    medications?: IntakeMedication[];
    completed_workup?: IntakeWorkup[];
    flags?: IntakeFlag[];
    suggested_next_steps?: string[];
};

type IntakeDecision = {
    item_type: string;
    item_id: string;
    action: string;
    edited_value?: any | null;
    reason?: string | null;
};

type IntakeData = {
    clinical_intake?: ClinicalIntake;
    contradictions?: any;
    decisions?: IntakeDecision[];
    status?: string;
    message?: string;
};

interface ClinicalSummaryProps {
    fileId: string;
    caseId?: string | null;
    rawResults?: { page: number; text: string }[] | null;
    onNavigateToPage?: (page: number) => void;
}

type TabId = 'summary' | 'alerts' | 'timeline' | 'chronology' | 'issues' | 'details' | 'consultation' | 'ime' | 'intake' | 'bodymap';

/* ─── Category Styles ─── */

const CATEGORY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
    visit: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
    test: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
    procedure: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
    prescription: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    'follow-up': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
    billing: { bg: 'bg-slate-50', text: 'text-slate-600', dot: 'bg-slate-400' },
    incident: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
    injury: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
    administrative: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
    milestone: { bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
    claim_correspondence: { bg: 'bg-cyan-50', text: 'text-cyan-700', dot: 'bg-cyan-500' },
};

const GROUP_ICONS: Record<string, string> = {
    'Diagnoses': '🩺', 'Medications': '💊', 'Lab Results': '🧪',
    'Vital Signs': '📊', 'Allergies': '⚠️', 'Procedures': '🔬',
    'Imaging': '📷', 'Clinical Notes': '📋', 'Line Items': '📦',
    'Payment Details': '💳',
};

type ColumnKey = 'patient' | 'date' | 'description' | 'pages' | 'comments' | 'category' | 'significance' | 'body_parts' | 'defendants' | 'phase';
type ChronologyColumn = { key: ColumnKey; label: string };

const DEFAULT_CHRONOLOGY_COLUMNS: ChronologyColumn[] = [
    { key: 'patient', label: 'Patient' },
    { key: 'date', label: 'Date' },
    { key: 'description', label: 'Description' },
    { key: 'pages', label: 'Page' },
    { key: 'comments', label: 'Comments' },
    { key: 'category', label: 'Category' },
    { key: 'significance', label: 'Significance' },
    { key: 'body_parts', label: 'Body Parts' },
    { key: 'defendants', label: 'Defendants' },
    { key: 'phase', label: 'Phase' },
];

const DEFAULT_VISIBLE_COLUMNS: ColumnKey[] = ['date', 'description', 'pages', 'comments'];

function normalizeColumnOrder(settings?: ChronologySettings | null, override?: string[] | null): ColumnKey[] {
    const baseKeys = DEFAULT_CHRONOLOGY_COLUMNS.map(c => c.key);
    const preferredOrder = (override || settings?.column_order || []).filter((k): k is ColumnKey => baseKeys.includes(k as ColumnKey));
    const remaining = baseKeys.filter(k => !preferredOrder.includes(k));
    return preferredOrder.length > 0 ? [...preferredOrder, ...remaining] : baseKeys;
}

function normalizeVisibleColumns(settings?: ChronologySettings | null): Set<ColumnKey> {
    const hidden = new Set((settings?.hidden_columns || []).filter((k): k is ColumnKey => DEFAULT_CHRONOLOGY_COLUMNS.some(c => c.key === k)));
    const preferred = settings?.preferred_columns?.filter((k): k is ColumnKey => DEFAULT_CHRONOLOGY_COLUMNS.some(c => c.key === k)) || null;
    if (preferred && preferred.length > 0) {
        return new Set(preferred);
    }
    const visible = DEFAULT_VISIBLE_COLUMNS.filter(k => !hidden.has(k));
    return new Set(visible);
}


function parseDateString(value: string | null | undefined): Date | null {
    if (!value) return null;
    const trimmed = value.trim();
    const iso = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
        const [_, y, m, d] = iso;
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    const us = trimmed.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
    if (us) {
        const [_, mm, dd, yy] = us;
        const year = yy.length === 2 ? Number(`20${yy}`) : Number(yy);
        return new Date(year, Number(mm) - 1, Number(dd));
    }
    const long = trimmed.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (long) {
        const monthMap: Record<string, number> = {
            jan: 0, january: 0,
            feb: 1, february: 1,
            mar: 2, march: 2,
            apr: 3, april: 3,
            may: 4,
            jun: 5, june: 5,
            jul: 6, july: 6,
            aug: 7, august: 7,
            sep: 8, september: 8,
            oct: 9, october: 9,
            nov: 10, november: 10,
            dec: 11, december: 11,
        };
        const monthKey = long[1].toLowerCase();
        const month = monthMap[monthKey];
        if (month === undefined) return null;
        return new Date(Number(long[3]), month, Number(long[2]));
    }
    return null;
}

function normalizeDateInputValue(value: string | null | undefined): string {
    if (!value) return '';
    const trimmed = value.trim();
    const iso = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    const parsed = parseDateString(trimmed);
    if (!parsed) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatChronologyDateLabel(value: string | null | undefined): string {
    const parsed = parseDateString(value);
    if (!parsed) return value?.trim() || 'Undated';
    return parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function summarizeText(value: string | null | undefined, max = 120): string {
    const text = (value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '—';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function ClinicalSummary({ fileId, caseId, rawResults, onNavigateToPage }: ClinicalSummaryProps) {
    const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
    const [flagsData, setFlagsData] = useState<FlagsData | null>(null);
    const [detailsData, setDetailsData] = useState<DetailsData | null>(null);
    const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
    const [chronologyData, setChronologyData] = useState<ChronologyData | null>(null);
    const [intakeData, setIntakeData] = useState<IntakeData | null>(null);
    const [pageCount, setPageCount] = useState(0);

    const [summaryLoading, setSummaryLoading] = useState(true);
    const [flagsLoading, setFlagsLoading] = useState(true);
    const [detailsLoading, setDetailsLoading] = useState(true);
    const [timelineLoading, setTimelineLoading] = useState(true);
    const [chronologyLoading, setChronologyLoading] = useState(true);
    const [intakeLoading, setIntakeLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<TabId>('summary');
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const [chronologyEdits, setChronologyEdits] = useState<ChronologyEvent[]>([]);
    const [selectedChronologyRows, setSelectedChronologyRows] = useState<Set<string>>(new Set());
    const [columnOrder, setColumnOrder] = useState<ColumnKey[]>(DEFAULT_CHRONOLOGY_COLUMNS.map(c => c.key));
    const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(new Set(DEFAULT_VISIBLE_COLUMNS));
    const [chronologySaveStatus, setChronologySaveStatus] = useState<string | null>(null);
    const [chronologyError, setChronologyError] = useState<string | null>(null);
    const [incidentDateInput, setIncidentDateInput] = useState<string>('');
    const [gapThresholdInput, setGapThresholdInput] = useState<number>(30);
    const [selectedPatient, setSelectedPatient] = useState<string>('All');
    const [isChronologyInitialized, setIsChronologyInitialized] = useState(false);
    const [activeChronologyEditorId, setActiveChronologyEditorId] = useState<string | null>(null);

    const [codeSearchOpen, setCodeSearchOpen] = useState(false);
    const [codeSearchQuery, setCodeSearchQuery] = useState('');
    const [codeSearchResults, setCodeSearchResults] = useState<{ code: string; description: string }[]>([]);
    const [editingProblemId, setEditingProblemId] = useState<string | null>(null);

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

    const runCodeSearch = useCallback(async (query: string) => {
        if (!query.trim()) {
            setCodeSearchResults([]);
            return;
        }
        try {
            const res = await fetch(`/api/ai/code-search?type=icd10&q=${encodeURIComponent(query)}`);
            const json = await res.json();
            setCodeSearchResults(json.data || []);
        } catch (err) {
            console.error('Code search failed:', err);
        }
    }, []);

    useEffect(() => {
        if (!codeSearchOpen) return;
        const t = setTimeout(() => {
            runCodeSearch(codeSearchQuery);
        }, 250);
        return () => clearTimeout(t);
    }, [codeSearchQuery, codeSearchOpen, runCodeSearch]);

    useEffect(() => {
        if (!fileId) return;

        const base = '/api/ai';

        // Track which sections still need data
        const needsRefetch = { summary: true, flags: true, details: true, timeline: true, chronology: true, intake: true };

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
            if (isInitial || needsRefetch.chronology)
                promises.push(fetchSection<ChronologyData>('chronology', setChronologyData, isInitial ? setChronologyLoading : () => { }, 'chronology'));
            if (isInitial || needsRefetch.intake)
                promises.push(fetchSection<IntakeData>('intake', setIntakeData, isInitial ? setIntakeLoading : () => { }, 'intake'));
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

    useEffect(() => {
        if (!chronologyData || chronologyData.status === 'processing') return;
        if (chronologyData.chronology) {
            setChronologyEdits(chronologyData.chronology);
            setSelectedChronologyRows(new Set());
            setIsChronologyInitialized(true);
        }
        const settings = chronologyData.settings || null;
        setIncidentDateInput(settings?.incident_date || '');
        setGapThresholdInput(settings?.gap_days_threshold || 30);
        setColumnOrder(normalizeColumnOrder(settings, chronologyData.columns || null));
        const normalizedVisible = normalizeVisibleColumns(settings);
        const hasExplicitVisibility = (settings?.preferred_columns && settings.preferred_columns.length > 0) || (settings?.hidden_columns && settings.hidden_columns.length > 0);
        if (!hasExplicitVisibility && summaryData?.patients && summaryData.patients.length > 1) {
            normalizedVisible.add('patient');
        }
        setVisibleColumns(normalizedVisible);
    }, [chronologyData, summaryData]);

    const allLoading = summaryLoading && flagsLoading && detailsLoading && timelineLoading;

    const hasCriticalFlags = flagsData?.critical_flags && flagsData.critical_flags.length > 0;
    const hasAbnormals = flagsData?.abnormal_findings && flagsData.abnormal_findings.length > 0;
    const hasTimeline = timelineData?.timeline && timelineData.timeline.length > 0;
    const hasChronology = chronologyData?.chronology && chronologyData.chronology.length > 0;
    const hasIssues = chronologyData?.issues && chronologyData.issues.length > 0;
    const hasGroups = (detailsData?.groups && detailsData.groups.length > 0) || (detailsData?.patients && detailsData.patients.length > 0);

    const patientOptions = useMemo(() => {
        const names = new Set<string>();
        summaryData?.patients?.forEach(p => { if (p.patient_name) names.add(p.patient_name); });
        chronologyEdits.forEach(ev => { if (ev.patient_name) names.add(ev.patient_name); });
        return ['All', ...Array.from(names)];
    }, [summaryData?.patients, chronologyEdits]);
    const assignablePatients = useMemo(() => patientOptions.filter(p => p !== 'All'), [patientOptions]);

    const sortedChronology = useMemo(() => {
        const sourceChronology = (isChronologyInitialized ? chronologyEdits : chronologyData?.chronology) || [];
        return [...sourceChronology].sort((a, b) => {
            const da = parseDateString(a.date);
            const db = parseDateString(b.date);
            if (!da && !db) return 0;
            if (!da) return 1;
            if (!db) return -1;
            return da.getTime() - db.getTime();
        });
    }, [isChronologyInitialized, chronologyEdits, chronologyData?.chronology]);
    const displayedChronology = useMemo(() =>
        selectedPatient === 'All'
            ? sortedChronology
            : sortedChronology.filter(ev => ev.patient_name === selectedPatient),
        [sortedChronology, selectedPatient]
    );

    const TABS: { id: TabId; label: string; icon: string; badge?: number; loading: boolean }[] = [
        { id: 'summary', label: 'Overview', icon: '📝', loading: summaryLoading },
        { id: 'alerts', label: 'Alerts', icon: '⚠️', badge: (flagsData?.critical_flags?.length || 0) + (flagsData?.abnormal_findings?.length || 0), loading: flagsLoading },
        { id: 'timeline', label: 'Timeline', icon: '📅', badge: timelineData?.timeline?.length, loading: timelineLoading },
        { id: 'chronology', label: 'Chronology', icon: '🧾', badge: chronologyData?.chronology?.length, loading: chronologyLoading },
        { id: 'issues', label: 'Issues', icon: '🔎', badge: chronologyData?.issues?.length, loading: chronologyLoading },
        { id: 'details', label: 'Details', icon: '📋', badge: detailsData?.patients?.length || detailsData?.groups?.length, loading: detailsLoading },
        { id: 'consultation', label: 'Consult', icon: '🎙️', loading: false },
        { id: 'ime', label: 'IME', icon: '📄', loading: false },
        { id: 'intake', label: 'Intake', icon: '🧩', badge: intakeData?.clinical_intake?.problem_list?.length, loading: intakeLoading },
        { id: 'bodymap', label: 'Body Map', icon: '🫀', loading: false },
    ];

    const orderedColumns = columnOrder
        .map(key => DEFAULT_CHRONOLOGY_COLUMNS.find(c => c.key === key))
        .filter(Boolean) as ChronologyColumn[];
    const visibleColumnList = orderedColumns.filter(c => visibleColumns.has(c.key));
    const activeChronologyEditor = chronologyEdits.find(ev => ev.id === activeChronologyEditorId) || null;

    const updateChronologyField = (id: string, key: keyof ChronologyEvent, value: any) => {
        setChronologyEdits(prev => prev.map(ev => ev.id === id ? { ...ev, [key]: value } : ev));
    };

    const parsePagesInput = (value: string): number[] => {
        return value
            .split(',')
            .map(v => Number(v.trim()))
            .filter(n => Number.isFinite(n) && n > 0);
    };

    const decisions = intakeData?.decisions || [];

    const getDecision = (itemType: string, itemId: string) => {
        return decisions.find(d => d.item_type === itemType && d.item_id === itemId) || null;
    };

    const saveDecision = async (payload: IntakeDecision) => {
        try {
            await fetch(`/api/ai/intake/${fileId}/decision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            setIntakeData(prev => {
                if (!prev) return prev;
                const nextDecisions = [...(prev.decisions || [])];
                const idx = nextDecisions.findIndex(d => d.item_type === payload.item_type && d.item_id === payload.item_id);
                if (idx >= 0) nextDecisions[idx] = payload; else nextDecisions.push(payload);
                return { ...prev, decisions: nextDecisions };
            });
        } catch (err) {
            console.error('Failed to save decision:', err);
        }
    };

    const openCodeSearch = (problemId: string, initialQuery: string) => {
        setEditingProblemId(problemId);
        setCodeSearchQuery(initialQuery || '');
        setCodeSearchResults([]);
        setCodeSearchOpen(true);
    };

    const exportIntake = async (format: 'fhir' | 'csv' | 'pdf') => {
        try {
            const res = await fetch(`/api/ai/intake/${fileId}/export?format=${format}`);
            if (!res.ok) throw new Error(`Export failed: ${res.status}`);
            if (format === 'pdf') {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `clinical-intake.${format}`;
                link.click();
                window.URL.revokeObjectURL(url);
                return;
            }
            const text = await res.text();
            const ext = format === 'fhir' ? 'json' : 'csv';
            downloadFile(`clinical-intake.${ext}`, text, format === 'fhir' ? 'application/json' : 'text/csv');
        } catch (err) {
            console.error('Failed to export intake:', err);
        }
    };

    const navigateToPage = (page?: number | null) => {
        if (!page || !onNavigateToPage) return;
        onNavigateToPage(page);
    };

    const toggleRowSelection = (id: string) => {
        setSelectedChronologyRows(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const addChronologyRow = () => {
        const newRow: ChronologyEvent = {
            id: `user-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            date: '',
            description: '',
            pages: [],
            category: 'visit',
            comments: '',
            body_parts: [],
            defendants: [],
            significance: '',
            phase: 'unknown',
            patient_name: selectedPatient !== 'All' ? selectedPatient : null,
        };
        setChronologyEdits(prev => [newRow, ...prev]);
        setActiveChronologyEditorId(newRow.id);
    };

    const deleteChronologyRow = (id: string) => {
        setChronologyEdits(prev => prev.filter(ev => ev.id !== id));
        setSelectedChronologyRows(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
        setActiveChronologyEditorId(prev => prev === id ? null : prev);
    };

    const splitChronologyRow = (id: string) => {
        setChronologyEdits(prev => {
            const idx = prev.findIndex(ev => ev.id === id);
            if (idx === -1) return prev;
            const target = prev[idx];
            const parts = (target.description || '').split(/\n|;| \/ /).map(p => p.trim()).filter(Boolean);
            if (parts.length < 2) return prev;
            const first = { ...target, description: parts[0] };
            const newRows = parts.slice(1).map((part, i) => ({
                ...target,
                id: `${target.id}-split-${i + 1}-${Date.now()}`,
                description: part,
            }));
            const next = [...prev];
            next.splice(idx, 1, first, ...newRows);
            return next;
        });
    };

    const mergeSelectedChronologyRows = () => {
        const ids = Array.from(selectedChronologyRows);
        if (ids.length < 2) return;
        setChronologyEdits(prev => {
            const rows = prev.filter(ev => ids.includes(ev.id));
            if (rows.length < 2) return prev;
            const primary = rows[0];
            const merged: ChronologyEvent = {
                ...primary,
                description: rows.map(r => r.description).filter(Boolean).join(' / '),
                pages: Array.from(new Set(rows.flatMap(r => r.pages || []))),
                comments: rows.map(r => r.comments).filter(Boolean).join(' | '),
                body_parts: Array.from(new Set(rows.flatMap(r => r.body_parts || []))),
                defendants: Array.from(new Set(rows.flatMap(r => r.defendants || []))),
            };
            const remaining = prev.filter(ev => !ids.includes(ev.id));
            return [merged, ...remaining];
        });
        setSelectedChronologyRows(new Set());
    };

    const downloadFile = (filename: string, content: string, mime: string) => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const exportChronologyCsv = (filename: string) => {
        const headers = visibleColumnList.map(c => c.label);
        const rows = chronologyEdits.map(ev => visibleColumnList.map(c => {
            if (c.key === 'patient') return ev.patient_name || '';
            if (c.key === 'pages') return (ev.pages || []).join(', ');
            if (c.key === 'body_parts') return (ev.body_parts || []).join(', ');
            if (c.key === 'defendants') return (ev.defendants || []).join(', ');
            return String((ev as any)[c.key] || '');
        }));
        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/\"/g, '""')}"`).join(',')).join('\n');
        downloadFile(filename, csv, 'text/csv');
    };

    const exportChronologyMarkdown = (filename: string) => {
        const headers = visibleColumnList.map(c => c.label);
        const divider = headers.map(() => '---');
        const rows = chronologyEdits.map(ev => visibleColumnList.map(c => {
            if (c.key === 'patient') return ev.patient_name || '';
            if (c.key === 'pages') return (ev.pages || []).join(', ');
            if (c.key === 'body_parts') return (ev.body_parts || []).join(', ');
            if (c.key === 'defendants') return (ev.defendants || []).join(', ');
            return String((ev as any)[c.key] || '');
        }));
        const md = [
            `| ${headers.join(' | ')} |`,
            `| ${divider.join(' | ')} |`,
            ...rows.map(r => `| ${r.join(' | ')} |`)
        ].join('\n');
        downloadFile(filename, md, 'text/markdown');
    };

    const exportChronologyWord = (filename: string) => {
        const headers = visibleColumnList.map(c => `<th>${c.label}</th>`).join('');
        const rows = chronologyEdits.map(ev => {
            const cells = visibleColumnList.map(c => {
                let value = '';
                if (c.key === 'patient') value = ev.patient_name || '';
                else if (c.key === 'pages') value = (ev.pages || []).join(', ');
                else if (c.key === 'body_parts') value = (ev.body_parts || []).join(', ');
                else if (c.key === 'defendants') value = (ev.defendants || []).join(', ');
                else value = String((ev as any)[c.key] || '');
                return `<td>${value}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Chronology</title></head><body><table border="1" cellspacing="0" cellpadding="6"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
        downloadFile(filename, html, 'application/msword');
    };

    const saveChronologyVersion = async (isFinal: boolean) => {
        setChronologySaveStatus(null);
        setChronologyError(null);
        const hasMissingPages = chronologyEdits.some(ev => !ev.pages || ev.pages.length === 0);
        if (hasMissingPages) {
            setChronologyError('Every event must include at least one Bates/page reference.');
            return;
        }
        try {
            const res = await fetch(`/api/ai/chronology/${fileId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save_version',
                    chronology: chronologyEdits,
                    is_final: isFinal,
                    base_version: chronologyData?.version ?? 0,
                    columns: columnOrder,
                    label: isFinal ? 'Final' : null
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to save');
            setChronologySaveStatus(`Saved v${json.data?.version || ''}`);
            await refreshChronology();
        } catch (err: any) {
            setChronologyError(err.message || 'Failed to save chronology');
        }
    };

    const revertToAiChronology = () => {
        if (chronologyData?.ai_chronology) {
            setChronologyEdits(chronologyData.ai_chronology);
            setSelectedChronologyRows(new Set());
        }
    };

    const updateChronologySettings = async () => {
        try {
            const res = await fetch(`/api/ai/chronology/${fileId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_settings',
                    incident_date: incidentDateInput || null,
                    gap_days_threshold: gapThresholdInput,
                    preferred_columns: Array.from(visibleColumns),
                    hidden_columns: DEFAULT_CHRONOLOGY_COLUMNS.map(c => c.key).filter(k => !visibleColumns.has(k)),
                    column_order: columnOrder,
                })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'Failed to update settings');
            setChronologySaveStatus('Settings updated');
            await refreshChronology();
        } catch (err: any) {
            setChronologyError(err.message || 'Failed to update settings');
        }
    };

    const toggleColumnVisibility = (key: ColumnKey) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const moveColumn = (key: ColumnKey, direction: 'up' | 'down') => {
        setColumnOrder(prev => {
            const idx = prev.indexOf(key);
            if (idx === -1) return prev;
            const next = [...prev];
            const swapWith = direction === 'up' ? idx - 1 : idx + 1;
            if (swapWith < 0 || swapWith >= next.length) return prev;
            [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
            return next;
        });
    };

    const refreshChronology = async () => {
        try {
            setChronologyLoading(true);
            const res = await fetch(`/api/ai/chronology/${fileId}`);
            const json = await res.json();
            if (res.ok) setChronologyData(json.data);
        } catch (err) {
            console.error('Failed to refresh chronology', err);
        } finally {
            setChronologyLoading(false);
        }
    };

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
                            <SparklesIcon className="w-4 h-4" />
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
                                    <div className="space-y-8">
                                        {(() => {
                                            const sorted = [...(timelineData?.timeline || [])].sort((a, b) => {
                                                const da = parseDateString(a.date);
                                                const db = parseDateString(b.date);
                                                if (!da && !db) return 0;
                                                if (!da) return 1;
                                                if (!db) return -1;
                                                return da.getTime() - db.getTime();
                                            });
                                            const groups: { date: string, items: TimelineEvent[] }[] = [];
                                            sorted.forEach(ev => {
                                                const last = groups[groups.length - 1];
                                                if (last && last.date === ev.date) {
                                                    last.items.push(ev);
                                                } else {
                                                    groups.push({ date: ev.date, items: [ev] });
                                                }
                                            });
                                            return groups.map((group, gi) => (
                                                <div key={gi} className="relative">
                                                    {/* Timeline Dot */}
                                                    <div className="absolute -left-[22px] top-1.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white shadow-sm z-10"></div>
                                                    
                                                    <div className="flex flex-col gap-2">
                                                        <span className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">{group.date}</span>
                                                        <div className="space-y-2">
                                                            {group.items.map((ev, ei) => {
                                                                const style = CATEGORY_STYLES[ev.category] || CATEGORY_STYLES.visit;
                                                                return (
                                                                    <div key={ei} className={`${style.bg} border border-slate-100 rounded-xl p-3 shadow-sm hover:shadow-md transition-shadow`}>
                                                                        <div className="flex items-center justify-between mb-1.5">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.bg} ${style.text} border border-current/10`}>
                                                                                    {ev.category}
                                                                                </span>
                                                                                {ev.patient_name && (
                                                                                    <span className="text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/70 text-slate-500 border border-slate-200">
                                                                                        {ev.patient_name}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <PageBadge page={ev.page} />
                                                                        </div>
                                                                        <p className="text-sm text-slate-700 leading-snug">{ev.event}</p>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            ) : (
                                <EmptyState icon={<CalendarDaysIcon className="w-10 h-10 text-slate-200" />} text="No timeline events found" />
                            )}
                        </div>
                    )}

                    {/* ── CHRONOLOGY TAB ── */}
                    {activeTab === 'chronology' && (
                        <div className="p-5 space-y-4">
                            {chronologyLoading ? (
                                <LoadingCard text="Preparing editable chronology..." />
                            ) : chronologyData?.status === 'processing' ? (
                                <LoadingCard text={chronologyData?.message || "Awaiting OCR..."} />
                            ) : chronologyData === null ? (
                                <LoadingCard text="Waiting for text..." />
                            ) : hasChronology ? (
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-4 bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm">
                                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm">Editable Chronology</span>
                                                    <span className="bg-white border border-slate-200 px-2 py-1 rounded-md text-slate-500 font-mono text-[10px]">v{chronologyData?.version ?? 0}</span>
                                                    {chronologyData?.source && (
                                                        <span className="text-[10px] text-slate-400 font-medium italic">Source: {chronologyData.source}</span>
                                                    )}
                                                </div>
                                                {chronologyData?.versions && chronologyData.versions.length > 1 && (
                                                    <div className="flex items-center gap-1.5 mt-1">
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">History:</span>
                                                        <div className="flex gap-1 overflow-x-auto pb-0.5">
                                                            {chronologyData.versions.map(v => (
                                                                <button
                                                                    key={v.version}
                                                                    onClick={() => { /* Potential fetch version logic */ }}
                                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${v.version === chronologyData.version ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}
                                                                >
                                                                    v{v.version}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-2 border-l-0 xl:border-l xl:pl-4 border-slate-200">
                                                <button onClick={addChronologyRow} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-xl text-xs font-bold hover:bg-blue-100 transition-colors shadow-sm">
                                                    <PlusIcon className="w-3.5 h-3.5" /> Add Entry
                                                </button>
                                                <button onClick={mergeSelectedChronologyRows} disabled={selectedChronologyRows.size < 2} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm">
                                                    Merge ({selectedChronologyRows.size})
                                                </button>
                                                <div className="w-px h-6 bg-slate-200 mx-1 hidden sm:block"></div>
                                                <button onClick={() => saveChronologyVersion(false)} className="px-4 py-1.5 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-black transition-all shadow-lg hover:shadow-xl active:scale-95">Save Draft</button>
                                                <button onClick={() => saveChronologyVersion(true)} className="px-4 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 hover:shadow-xl active:scale-95">Mark Final</button>
                                            </div>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 bg-white/40 p-3 sm:p-4 rounded-xl border border-slate-200/60 backdrop-blur-sm">
                                            <div className="flex flex-col gap-1 min-w-[160px]">
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] ml-0.5">Filter Patient</label>
                                                <div className="relative group">
                                                    <UserIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                                                    <select
                                                        value={selectedPatient}
                                                        onChange={(e) => setSelectedPatient(e.target.value)}
                                                        className="w-full pl-8 pr-8 py-1.5 bg-white/80 border border-slate-200 rounded-lg text-[13px] font-bold text-slate-800 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white transition-all appearance-none cursor-pointer shadow-sm"
                                                    >
                                                        {patientOptions.map(name => (
                                                            <option key={name} value={name}>{name}</option>
                                                        ))}
                                                    </select>
                                                    <ChevronDownIcon className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-1 min-w-[140px]">
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] ml-0.5">Incident Date</label>
                                                <div className="relative group">
                                                    <CalendarIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 group-hover:text-blue-500 transition-colors" />
                                                    <input
                                                        type="date"
                                                        value={incidentDateInput}
                                                        onChange={(e) => setIncidentDateInput(e.target.value)}
                                                        className="w-full pl-8 pr-3 py-1.5 bg-white/80 border border-slate-200 rounded-lg text-[13px] font-bold text-slate-800 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white transition-all cursor-pointer shadow-sm"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex flex-col gap-1 min-w-[100px]">
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] ml-0.5">Gap Alert</label>
                                                <div className="flex items-center gap-2 group">
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={gapThresholdInput}
                                                        onChange={(e) => setGapThresholdInput(Number(e.target.value))}
                                                        className="w-full px-3 py-1.5 bg-white/80 border border-slate-200 rounded-lg text-[13px] font-bold text-slate-800 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/50 focus:bg-white transition-all shadow-sm"
                                                    />
                                                    <button onClick={updateChronologySettings} title="Update Settings" className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all active:scale-90 border border-blue-100/50 shadow-sm">
                                                        <ArrowPathIcon className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="flex-1"></div>

                                            <div className="flex flex-col gap-1">
                                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.1em] ml-0.5">Export Bundle</label>
                                                <div className="flex items-center bg-slate-100/80 p-1 rounded-lg border border-slate-200/50">
                                                    <button onClick={() => exportChronologyCsv('chronology.csv')} className="px-3 py-1 text-[11px] font-black text-slate-600 hover:text-blue-600 transition-colors uppercase tracking-tight">CSV</button>
                                                    <div className="w-px h-3 bg-slate-300 mx-1"></div>
                                                    <button onClick={() => exportChronologyWord('chronology.doc')} className="px-3 py-1 text-[11px] font-black text-slate-600 hover:text-blue-600 transition-colors uppercase tracking-tight">DOC</button>
                                                    <div className="w-px h-3 bg-slate-300 mx-1"></div>
                                                    <button onClick={() => exportChronologyMarkdown('chronology.md')} className="px-3 py-1 text-[11px] font-black text-slate-600 hover:text-blue-600 transition-colors uppercase tracking-tight">MD</button>
                                                </div>
                                            </div>
                                        </div>

                                        {(chronologySaveStatus || chronologyError) && (
                                            <div className={`p-3 rounded-xl flex items-center gap-2 ${chronologyError ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100 animate-pulse'}`}>
                                                {chronologyError ? <ExclamationCircleIcon className="w-4 h-4" /> : <CheckCircleIcon className="w-4 h-4" />}
                                                <span className="text-xs font-bold leading-none">{chronologyError || chronologySaveStatus}</span>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-200 rounded-xl shadow-sm">
                                            <div>
                                                <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Review Mode</div>
                                                <div className="mt-1 text-sm text-slate-500">Pick an event from the list and edit it with the PDF still visible beside you.</div>
                                            </div>
                                            <button onClick={revertToAiChronology} className="shrink-0 px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-100 text-xs font-bold hover:bg-blue-100 transition-colors">
                                                Reset to Original
                                            </button>
                                        </div>
                                    </div>

                                    <div className={`grid gap-4 ${activeChronologyEditor ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : 'grid-cols-1'}`}>
                                        <div className="space-y-3 min-w-0">
                                            <div className="flex items-center justify-between px-4 py-3 bg-white border border-slate-200 rounded-2xl shadow-sm">
                                                <div>
                                                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Chronology List</div>
                                                    <div className="mt-1 text-sm text-slate-600">Scan events here, then open one row in the editor while keeping the PDF visible on the left.</div>
                                                </div>
                                                {activeChronologyEditor && (
                                                    <button
                                                        onClick={() => setActiveChronologyEditorId(null)}
                                                        className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                                                    >
                                                        Hide Editor
                                                    </button>
                                                )}
                                            </div>

                                            <div className="max-h-[75vh] overflow-y-auto space-y-3 rounded-2xl">
                                                {displayedChronology.map((ev, index) => (
                                                    <div
                                                        key={ev.id}
                                                        className={`rounded-2xl border shadow-sm transition-all ${activeChronologyEditorId === ev.id ? 'border-blue-300 bg-blue-50/50 shadow-blue-100' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'}`}
                                                    >
                                                        <div className="p-4 sm:p-5">
                                                            <div className="flex items-start justify-between gap-4">
                                                                <div className="flex items-start gap-3 min-w-0">
                                                                    <input type="checkbox" checked={selectedChronologyRows.has(ev.id)} onChange={() => toggleRowSelection(ev.id)} className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer transition-all" />
                                                                    <div className="min-w-0 space-y-3">
                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-black">
                                                                                <CalendarIcon className="w-4 h-4 text-slate-400" />
                                                                                {formatChronologyDateLabel(ev.date)}
                                                                            </span>
                                                                            <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${CATEGORY_STYLES[ev.category || 'visit']?.bg} ${CATEGORY_STYLES[ev.category || 'visit']?.text}`}>
                                                                                {ev.category || 'visit'}
                                                                            </span>
                                                                            {ev.patient_name && (
                                                                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-600">
                                                                                    {ev.patient_name}
                                                                                </span>
                                                                            )}
                                                                            {ev.significance && (
                                                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${ev.significance === 'key' ? 'bg-amber-50 text-amber-700 border border-amber-200' : ev.significance === 'high' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                                                                                    {ev.significance}
                                                                                </span>
                                                                            )}
                                                                        </div>

                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setActiveChronologyEditorId(ev.id)}
                                                                            className="block text-left w-full"
                                                                        >
                                                                            <div className="text-base sm:text-[17px] font-bold text-slate-900 leading-relaxed">
                                                                                {summarizeText(ev.description, 220)}
                                                                            </div>
                                                                        </button>

                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            {(ev.pages || []).length > 0 ? (ev.pages || []).map((page, pageIndex) => (
                                                                                <PageBadge key={`${ev.id}-page-${pageIndex}`} page={page} onClick={() => navigateToPage(page)} />
                                                                            )) : (
                                                                                <span className="inline-flex items-center px-2 py-1 rounded-lg bg-slate-100 text-slate-400 text-[11px] font-bold border border-slate-200">No pages</span>
                                                                            )}
                                                                            {ev.phase && ev.phase !== 'unknown' && (
                                                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${ev.phase === 'pre' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                                                    {ev.phase}
                                                                                </span>
                                                                            )}
                                                                        </div>

                                                                        {(ev.comments || (ev.body_parts || []).length > 0 || (ev.defendants || []).length > 0) && (
                                                                            <div className="space-y-2">
                                                                                {ev.comments && (
                                                                                    <div className="text-sm text-slate-500 italic leading-relaxed">
                                                                                        {summarizeText(ev.comments, 140)}
                                                                                    </div>
                                                                                )}
                                                                                <div className="flex flex-wrap gap-1.5">
                                                                                    {(ev.body_parts || []).map((part, partIndex) => (
                                                                                        <span key={`${ev.id}-body-${partIndex}`} className="inline-flex items-center px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold border border-slate-200">
                                                                                            {part}
                                                                                        </span>
                                                                                    ))}
                                                                                    {(ev.defendants || []).map((name, defendantIndex) => (
                                                                                        <span key={`${ev.id}-defendant-${defendantIndex}`} className="inline-flex items-center px-2 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold border border-slate-200">
                                                                                            {name}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                <div className="flex flex-col items-end gap-2 shrink-0">
                                                                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                                                                        Event {index + 1}
                                                                    </div>
                                                                    <button onClick={() => setActiveChronologyEditorId(ev.id)} className="w-24 py-2 bg-slate-900 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-sm border border-slate-900">Edit</button>
                                                                    <button onClick={() => splitChronologyRow(ev.id)} className="w-24 py-2 bg-blue-50 text-blue-600 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-blue-100">Split</button>
                                                                    <button onClick={() => deleteChronologyRow(ev.id)} className="w-24 py-2 bg-red-50 text-red-600 rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100">Delete</button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {activeChronologyEditor && (
                                            <div className="min-w-0">
                                                <div className="xl:sticky xl:top-4 max-h-[75vh] overflow-y-auto rounded-3xl bg-white shadow-xl border border-slate-200">
                                                    <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-white/95 backdrop-blur">
                                                        <div>
                                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">Chronology Editor</div>
                                                            <div className="mt-1 text-xl font-bold text-slate-900">{formatChronologyDateLabel(activeChronologyEditor.date)}</div>
                                                            <div className="mt-1 text-xs text-slate-500">PDF stays visible on the left while you edit here.</div>
                                                        </div>
                                                        <button
                                                            onClick={() => setActiveChronologyEditorId(null)}
                                                            className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50"
                                                        >
                                                            Done
                                                        </button>
                                                    </div>

                                                    <div className="p-6 grid grid-cols-1 gap-5">
                                                        <div className="space-y-2">
                                                            <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Date</label>
                                                            <div className="relative">
                                                                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                                <input
                                                                    type="date"
                                                                    value={normalizeDateInputValue(activeChronologyEditor.date)}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'date', e.target.value)}
                                                                    className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                />
                                                            </div>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Patient</label>
                                                            <select
                                                                value={activeChronologyEditor.patient_name || ''}
                                                                onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'patient_name', e.target.value || null)}
                                                                className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                            >
                                                                <option value="">Unassigned</option>
                                                                {assignablePatients.map(name => (
                                                                    <option key={name} value={name}>{name}</option>
                                                                ))}
                                                            </select>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Description</label>
                                                            <textarea
                                                                value={activeChronologyEditor.description}
                                                                onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'description', e.target.value)}
                                                                className="w-full min-h-[160px] px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[15px] leading-relaxed font-semibold text-slate-800 resize-y focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                placeholder="Describe the event clearly..."
                                                            />
                                                        </div>

                                                        <div className="space-y-2">
                                                            <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Pages</label>
                                                            <input
                                                                type="text"
                                                                value={(activeChronologyEditor.pages || []).join(', ')}
                                                                onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'pages', parsePagesInput(e.target.value))}
                                                                className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                placeholder="2, 3, 5"
                                                            />
                                                            {(activeChronologyEditor.pages || []).length > 0 && (
                                                                <div className="flex flex-wrap gap-1.5 pt-1">
                                                                    {(activeChronologyEditor.pages || []).map((page, index) => (
                                                                        <PageBadge key={`${activeChronologyEditor.id}-editor-page-${index}`} page={page} onClick={() => navigateToPage(page)} />
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                            <div className="space-y-2">
                                                                <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Category</label>
                                                                <select
                                                                    value={activeChronologyEditor.category || 'visit'}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'category', e.target.value)}
                                                                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                >
                                                                    <option value="visit">visit</option>
                                                                    <option value="test">test</option>
                                                                    <option value="procedure">procedure</option>
                                                                    <option value="follow-up">follow-up</option>
                                                                    <option value="billing">billing</option>
                                                                    <option value="incident">incident</option>
                                                                    <option value="injury">injury</option>
                                                                    <option value="administrative">administrative</option>
                                                                    <option value="milestone">milestone</option>
                                                                    <option value="claim_correspondence">claim correspondence</option>
                                                                </select>
                                                            </div>

                                                            <div className="space-y-2">
                                                                <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Significance</label>
                                                                <select
                                                                    value={activeChronologyEditor.significance || ''}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'significance', e.target.value)}
                                                                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                >
                                                                    <option value="">Normal</option>
                                                                    <option value="low">Low</option>
                                                                    <option value="medium">Medium</option>
                                                                    <option value="high">High</option>
                                                                    <option value="key">Key Fact</option>
                                                                </select>
                                                            </div>

                                                            <div className="space-y-2">
                                                                <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Phase</label>
                                                                <select
                                                                    value={activeChronologyEditor.phase || 'unknown'}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'phase', e.target.value as ChronologyEvent['phase'])}
                                                                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                >
                                                                    <option value="unknown">unknown</option>
                                                                    <option value="pre">pre</option>
                                                                    <option value="post">post</option>
                                                                </select>
                                                            </div>
                                                        </div>

                                                        <div className="space-y-2">
                                                            <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Comments</label>
                                                            <textarea
                                                                value={activeChronologyEditor.comments || ''}
                                                                onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'comments', e.target.value)}
                                                                className="w-full min-h-[120px] px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-700 resize-y focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                placeholder="Optional notes, caveats, or context..."
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                            <div className="space-y-2">
                                                                <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Body Parts</label>
                                                                <input
                                                                    type="text"
                                                                    value={(activeChronologyEditor.body_parts || []).join(', ')}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'body_parts', e.target.value.split(',').map(v => v.trim()).filter(Boolean))}
                                                                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                    placeholder="neck, shoulder, lumbar spine"
                                                                />
                                                            </div>

                                                            <div className="space-y-2">
                                                                <label className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Defendants</label>
                                                                <input
                                                                    type="text"
                                                                    value={(activeChronologyEditor.defendants || []).join(', ')}
                                                                    onChange={(e) => updateChronologyField(activeChronologyEditor.id, 'defendants', e.target.value.split(',').map(v => v.trim()).filter(Boolean))}
                                                                    className="w-full px-3 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:bg-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/5 transition-all"
                                                                    placeholder="Names separated by commas"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="sticky bottom-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-white">
                                                        <div className="text-xs text-slate-500">
                                                            Tip: click a page chip to jump the PDF while you edit.
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button onClick={() => splitChronologyRow(activeChronologyEditor.id)} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all border border-blue-100">Split</button>
                                                            <button onClick={() => deleteChronologyRow(activeChronologyEditor.id)} className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all border border-red-100">Delete</button>
                                                            <button onClick={() => setActiveChronologyEditorId(null)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-black transition-all border border-slate-900">Close Editor</button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <EmptyState icon={<ListBulletIcon className="w-10 h-10 text-slate-200" />} text="No chronology events found" />
                            )}
                        </div>
                    )}

                    {/* ── ISSUES TAB ── */}
                    {activeTab === 'issues' && (
                        <div className="p-5 space-y-4">
                            {chronologyLoading ? (
                                <LoadingCard text="Scanning for gaps and inconsistencies..." />
                            ) : chronologyData?.status === 'processing' ? (
                                <LoadingCard text={chronologyData?.message || "Awaiting OCR..."} />
                            ) : chronologyData === null ? (
                                <LoadingCard text="Waiting for text..." />
                            ) : hasIssues ? (
                                <div className="space-y-3">
                                    {chronologyData?.issues?.map((issue, i) => (
                                        <div key={issue.id || i} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-xs font-bold uppercase tracking-wider text-slate-400">{issue.type}</div>
                                                    <div className="text-sm font-semibold text-slate-800 mt-1">{issue.description}</div>
                                                </div>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${issue.severity === 'high' ? 'bg-red-100 text-red-700' : issue.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {issue.severity}
                                                </span>
                                            </div>
                                            {issue.patient_name && (
                                                <div className="mt-2 text-xs text-slate-500">Patient: {issue.patient_name}</div>
                                            )}
                                            {(issue.event_ids && issue.event_ids.length > 0) && (
                                                <div className="mt-2 text-xs text-slate-500">
                                                    Rows: {issue.event_ids.map(id => {
                                                        const idx = chronologyEdits.findIndex(e => e.id === id);
                                                        return idx >= 0 ? `#${idx + 1}` : id;
                                                    }).join(', ')}
                                                </div>
                                            )}
                                            {(issue.pages && issue.pages.length > 0) && (
                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {issue.pages.map((p, pi) => <PageBadge key={`${issue.id}-p-${pi}`} page={p} />)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center p-12 bg-emerald-50 border-2 border-emerald-100 rounded-2xl text-emerald-700">
                                    <CheckCircleIcon className="w-16 h-16 text-emerald-500 mb-4" />
                                    <h3 className="text-xl font-bold uppercase tracking-wider mb-2">No Issues Detected</h3>
                                    <p className="text-emerald-600/80 font-medium">No gaps or inconsistencies flagged.</p>
                                </div>
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

                    {/* ── INTAKE TAB ── */}
                    {activeTab === 'intake' && (
                        <div className="p-5">
                            <IntakeSheet 
                                fileId={fileId}
                                data={intakeData}
                                loading={intakeLoading}
                                onNavigateToPage={navigateToPage}
                                onDecisionSave={saveDecision}
                                onExport={exportIntake}
                                onOpenCodeSearch={openCodeSearch}
                            />
                        </div>
                    )}

                    {/* ── CONSULTATION TAB ── */}
                    {activeTab === 'consultation' && (
                        caseId ? (
                            <ConsultationAssistant caseId={caseId} />
                        ) : (
                            <div className="p-5">
                                <EmptyState icon={<DocumentTextIcon className="w-10 h-10 text-slate-200" />} text="Consultation assistant becomes available once this document is tied to a case." />
                            </div>
                        )
                    )}

                    {/* ── IME TAB ── */}
                    {activeTab === 'ime' && (
                        caseId ? (
                            <IMESummaryBuilder caseId={caseId} />
                        ) : (
                            <div className="p-5">
                                <EmptyState icon={<DocumentTextIcon className="w-10 h-10 text-slate-200" />} text="IME builder becomes available once this document is tied to a case." />
                            </div>
                        )
                    )}

                    {/* ── BODY MAP TAB ── */}
                    {activeTab === 'bodymap' && (
                        <div className="h-full w-full min-h-[400px]">
                            <BodyMap3D fileId={fileId} patients={summaryData?.patients} />
                        </div>
                    )}

                </div>
            </div>

            {codeSearchOpen && (
                <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl shadow-xl w-[520px] max-w-[90vw] p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-bold text-slate-800">ICD-10 Code Search</div>
                            <button onClick={() => { setCodeSearchOpen(false); setEditingProblemId(null); }} className="text-slate-400 hover:text-slate-600">Close</button>
                        </div>
                        <input
                            type="text"
                            value={codeSearchQuery}
                            onChange={(e) => setCodeSearchQuery(e.target.value)}
                            placeholder="Search ICD-10 codes..."
                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                        />
                        <div className="mt-3 max-h-[300px] overflow-auto border border-slate-100 rounded-lg">
                            {codeSearchResults.length === 0 ? (
                                <div className="p-4 text-xs text-slate-500">No results</div>
                            ) : (
                                codeSearchResults.map((r) => (
                                    <button
                                        key={r.code}
                                        onClick={() => {
                                            if (!editingProblemId) return;
                                            saveDecision({
                                                item_type: 'diagnosis',
                                                item_id: editingProblemId,
                                                action: 'edited',
                                                edited_value: { icd10_code: r.code, icd10_description: r.description, validated: true },
                                            });
                                            setCodeSearchOpen(false);
                                            setEditingProblemId(null);
                                        }}
                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-100"
                                    >
                                        <div className="text-xs font-semibold text-slate-700">{r.code}</div>
                                        <div className="text-xs text-slate-500">{r.description}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

/* ─── Reusable Sub-Components ─── */

function PageBadge({ page, onClick }: { page: number; onClick?: () => void }) {
    const className = `inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${onClick ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100 cursor-pointer transition-colors' : 'bg-slate-100 text-slate-500 border-slate-200'}`;
    if (onClick) {
        return (
            <button type="button" onClick={onClick} className={className}>
                p.{page}
            </button>
        );
    }
    return (
        <span className={className}>
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
            <span className="text-sm text-slate-900">{text}</span>
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
