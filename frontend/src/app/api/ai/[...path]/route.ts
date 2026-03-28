import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { PDFDocument, StandardFonts } from 'pdf-lib';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
// Use 2.5 Flash for primary text analysis
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
// Use the specific TTS model for unary audio generateContent calls
const audioModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-tts" });
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

type ChronologyEvent = {
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
};

type ChronologyIssue = {
    id: string;
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    event_ids?: string[];
    pages?: number[];
    patient_name?: string | null;
};

type CaseSettings = {
    incident_date?: string | null;
    gap_days_threshold?: number | null;
    preferred_columns?: string[] | null;
    hidden_columns?: string[] | null;
    column_order?: string[] | null;
};

const DEFAULT_GAP_DAYS = 30;

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

function diffDays(a: Date, b: Date): number {
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function buildChronologyFromTimeline(timeline: any[] | null | undefined, incidentDate?: string | null): ChronologyEvent[] {
    const incident = parseDateString(incidentDate || undefined);
    return (timeline || []).map((ev: any, idx: number) => {
        const pages = typeof ev.page === 'number' ? [ev.page] : Array.isArray(ev.pages) ? ev.pages : [];
        const evDate = parseDateString(ev.date);
        let phase: 'pre' | 'post' | 'unknown' = 'unknown';
        if (incident && evDate) {
            phase = evDate < incident ? 'pre' : 'post';
        }
        return {
            id: `v0-${idx + 1}`,
            date: ev.date || '',
            description: ev.event || '',
            pages,
            category: ev.category || 'visit',
            comments: '',
            body_parts: [],
            defendants: [],
            significance: '',
            phase,
            patient_name: ev.patient_name || ev.patient || null,
        };
    });
}

function applyPhase(events: ChronologyEvent[], incidentDate?: string | null): ChronologyEvent[] {
    const incident = parseDateString(incidentDate || undefined);
    if (!incident) return events.map(e => ({ ...e, phase: e.phase || 'unknown' }));
    return events.map(ev => {
        const evDate = parseDateString(ev.date);
        if (!evDate) return { ...ev, phase: 'unknown' };
        return { ...ev, phase: evDate < incident ? 'pre' : 'post' };
    });
}

function computeIssuesForGroup(events: ChronologyEvent[], settings: CaseSettings, patientName: string | null): ChronologyIssue[] {
    const issues: ChronologyIssue[] = [];
    const gapThreshold = settings.gap_days_threshold || DEFAULT_GAP_DAYS;

    // Missing page references
    for (const ev of events) {
        if (!ev.pages || ev.pages.length === 0 || ev.pages.some(p => typeof p !== 'number')) {
            issues.push({
                id: `issue-missing-pages-${ev.id}`,
                type: 'missing-page-reference',
                description: `Event "${ev.description || ev.id}" is missing Bates/page references.`,
                severity: 'high',
                event_ids: [ev.id],
                pages: [],
                patient_name: patientName,
            });
        }
    }

    // Gap detection
    const dated = events
        .map(ev => ({ ev, date: parseDateString(ev.date) }))
        .filter(d => d.date)
        .sort((a, b) => (a.date!.getTime() - b.date!.getTime()));

    const incident = parseDateString(settings.incident_date || undefined);
    if (incident && dated.length > 0) {
        const first = dated[0];
        const gap = diffDays(incident, first.date!);
        if (gap > gapThreshold) {
            issues.push({
                id: `issue-gap-incident-${first.ev.id}`,
                type: 'care-gap',
                description: `Potential gap of ${gap} days from incident date to first documented event – confirm missing records or patient non-attendance.`,
                severity: gap > gapThreshold * 2 ? 'high' : 'medium',
                event_ids: [first.ev.id],
                pages: first.ev.pages,
                patient_name: patientName,
            });
        }
    }

    for (let i = 0; i < dated.length - 1; i++) {
        const prev = dated[i];
        const next = dated[i + 1];
        const gap = diffDays(prev.date!, next.date!);
        if (gap > gapThreshold) {
            issues.push({
                id: `issue-gap-${prev.ev.id}-${next.ev.id}`,
                type: 'care-gap',
                description: `Potential gap of ${gap} days between events (${prev.ev.date} → ${next.ev.date}) – confirm missing records or patient non-attendance.`,
                severity: gap > gapThreshold * 2 ? 'high' : 'medium',
                event_ids: [prev.ev.id, next.ev.id],
                pages: [...(prev.ev.pages || []), ...(next.ev.pages || [])],
                patient_name: patientName,
            });
        }
    }

    // Work status inconsistencies
    const fullDutyKeywords = ['full duty', 'full-duty', 'no restrictions', 'return to work'];
    const restrictedKeywords = ['restricted', 'light duty', 'no work', 'off work', 'work restrictions', 'modified duty'];
    const dutyEvents: { ev: ChronologyEvent; status: 'full' | 'restricted' }[] = [];
    for (const ev of events) {
        const text = (ev.description || '').toLowerCase();
        const isFull = fullDutyKeywords.some(k => text.includes(k));
        const isRestricted = restrictedKeywords.some(k => text.includes(k));
        if (isFull) dutyEvents.push({ ev, status: 'full' });
        if (isRestricted) dutyEvents.push({ ev, status: 'restricted' });
    }
    const hasFull = dutyEvents.some(d => d.status === 'full');
    const hasRestricted = dutyEvents.some(d => d.status === 'restricted');
    if (hasFull && hasRestricted) {
        const firstFull = dutyEvents.find(d => d.status === 'full')?.ev;
        const firstRestricted = dutyEvents.find(d => d.status === 'restricted')?.ev;
        issues.push({
            id: `issue-work-status`,
            type: 'work-status-inconsistency',
            description: 'Work status appears inconsistent (full duty vs restrictions) across notes.',
            severity: 'medium',
            event_ids: [firstFull?.id, firstRestricted?.id].filter(Boolean) as string[],
            pages: [...(firstFull?.pages || []), ...(firstRestricted?.pages || [])],
            patient_name: patientName,
        });
    }

    // Differing diagnoses for same body part (simple heuristic)
    const bodyParts = ['shoulder', 'knee', 'back', 'neck', 'spine', 'hip', 'ankle', 'wrist', 'elbow', 'hand', 'foot', 'arm', 'leg'];
    const diagnoses = ['fracture', 'sprain', 'strain', 'tear', 'contusion', 'dislocation', 'herniation', 'arthritis', 'tendinitis', 'concussion'];
    const bodyDiagMap: Record<string, Set<string>> = {};
    const bodyDiagEvents: Record<string, ChronologyEvent[]> = {};
    for (const ev of events) {
        const text = (ev.description || '').toLowerCase();
        for (const part of bodyParts) {
            if (!text.includes(part)) continue;
            for (const diag of diagnoses) {
                if (text.includes(diag)) {
                    if (!bodyDiagMap[part]) bodyDiagMap[part] = new Set();
                    bodyDiagMap[part].add(diag);
                    if (!bodyDiagEvents[part]) bodyDiagEvents[part] = [];
                    bodyDiagEvents[part].push(ev);
                }
            }
        }
    }
    for (const [part, diagSet] of Object.entries(bodyDiagMap)) {
        if (diagSet.size > 1) {
            const relatedEvents = bodyDiagEvents[part] || [];
            issues.push({
                id: `issue-diagnosis-${part}`,
                type: 'diagnosis-inconsistency',
                description: `Differing diagnoses for the same body part (${part}) across notes.`,
                severity: 'medium',
                event_ids: relatedEvents.map(e => e.id),
                pages: relatedEvents.flatMap(e => e.pages || []),
                patient_name: patientName,
            });
        }
    }

    return issues;
}

function computeIssues(events: ChronologyEvent[], ocrPages: { page: number; text: string }[], settings: CaseSettings, intakeFlags?: any[]): ChronologyIssue[] {
    const issues: ChronologyIssue[] = [];

    const groups = new Map<string, ChronologyEvent[]>();
    for (const ev of events) {
        const key = ev.patient_name || 'All';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(ev);
    }
    for (const [patientName, groupEvents] of groups) {
        issues.push(...computeIssuesForGroup(groupEvents, settings, patientName === 'All' ? null : patientName));
    }

    // Imaging/report referenced but not present (file-level)
    const referencePages: number[] = [];
    let hasImagingReport = false;
    for (const p of ocrPages) {
        const t = (p.text || '').toLowerCase();
        if (/(see|refer to|attached|pending)\s+(mri|ct|x[- ]?ray|ultrasound|imaging)\s+report/.test(t)) {
            referencePages.push(p.page);
        }
        if (/(mri|ct|x[- ]?ray|ultrasound|imaging|radiology)\s+report/.test(t) && /(report)/.test(t)) {
            hasImagingReport = true;
        }
    }
    if (referencePages.length > 0 && !hasImagingReport) {
        issues.push({
            id: `issue-imaging-missing`,
            type: 'missing-imaging-report',
            description: 'Reference to imaging/report found, but the actual report is not present in the file.',
            severity: 'medium',
            pages: Array.from(new Set(referencePages)),
        });
    }

    // Merge in AI-detected issues from clinical intake (if available)
    // These are higher quality than heuristic detection since they come from structured entity analysis
    if (intakeFlags && Array.isArray(intakeFlags)) {
        const severityMap: Record<string, 'low' | 'medium' | 'high'> = {
            'critical': 'high',
            'warning': 'medium',
            'info': 'low',
        };
        for (const flag of intakeFlags) {
            if (!flag || typeof flag !== 'object') continue;
            // Avoid duplicating issues already caught by heuristics
            let issueType = 'ai-detected';
            if (flag.type === 'contradiction') issueType = 'ai-contradiction';
            else if (flag.type === 'care_gap') issueType = 'ai-care-gap';
            else if (flag.type === 'missing_data') issueType = 'ai-missing-data';

            // Resolve pages — prefer pre-resolved pages array, fall back to item_a/item_b/page
            const flagPages: number[] = Array.isArray(flag.pages) && flag.pages.length > 0
                ? flag.pages.filter((p: any): p is number => typeof p === 'number')
                : [flag.item_a?.page, flag.item_b?.page, flag.page].filter((p): p is number => typeof p === 'number');

            // Skip if a heuristic already caught a similar issue on the same pages
            const isDuplicate = issues.some(i =>
                i.description?.toLowerCase().includes((flag.description || '').toLowerCase().slice(0, 30)) &&
                flagPages.length > 0 && flagPages.some(fp => i.pages?.includes(fp))
            );
            if (isDuplicate) continue;

            issues.push({
                id: `intake-${flag.id || issues.length}`,
                type: issueType,
                description: flag.description || 'AI-detected issue',
                severity: severityMap[flag.severity] || 'medium',
                pages: flagPages,
            });
        }
    }

    return issues;
}

async function fetchCaseSettings(fileId: string): Promise<{ settings: CaseSettings; docInfo: { case_id?: string | null; user_id?: string | null } }> {
    const { data: docInfo } = await supabase.from('documents').select('case_id, user_id').eq('file_id', fileId).maybeSingle();
    const caseId = docInfo?.case_id;
    const userId = docInfo?.user_id;
    if (!caseId || !userId) {
        return { settings: { gap_days_threshold: DEFAULT_GAP_DAYS }, docInfo: docInfo || {} };
    }
    const { data: settings } = await supabase
        .from('case_settings')
        .select('incident_date, gap_days_threshold, preferred_columns, hidden_columns, column_order')
        .eq('case_id', caseId)
        .eq('user_id', userId)
        .maybeSingle();
    return { settings: settings || { gap_days_threshold: DEFAULT_GAP_DAYS }, docInfo };
}

async function fetchLatestChronology(fileId: string) {
    const { data } = await supabase
        .from('chronology_versions')
        .select('version, label, is_final, data, columns, created_at, source')
        .eq('file_id', fileId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
    return data || null;
}

async function fetchChronologyVersions(fileId: string) {
    const { data } = await supabase
        .from('chronology_versions')
        .select('version, label, is_final, created_at, source')
        .eq('file_id', fileId)
        .order('version', { ascending: false });
    return data || [];
}

/* ─── CHUNKED PROCESSING LOGIC ─── */

async function processLargeDocument(fullText: string) {
    // If document is small enough for one go (< 300k chars ~ 75k tokens)
    if (fullText.length < 300000) {
        return await analyzeBatch(fullText);
    }

    // For 10k pages, we chunk and reduce. 
    // This is a simplified "Map-Reduce" strategy for a demo.
    const chunks = [];
    const chunkSize = 200000; // ~50k tokens
    for (let i = 0; i < fullText.length; i += chunkSize) {
        chunks.push(fullText.substring(i, i + chunkSize));
    }

    console.log(`Processing ${chunks.length} chunks for a massive document...`);

    const chunkSummaries = await Promise.all(chunks.map(async (chunk) => {
        const prompt = `System: You are an expert medical analyzer. Summarize this segment of a massive medical file. Extract clinical facts, timeline events, and abnormal findings. Return JSON with keys:
        {
          "clinical_summary": "string",
          "timeline": [{ "date": "string", "event": "string", "page": 1, "category": "visit|test|procedure|other", "patient_name": "string|null" }],
          "critical_flags": [{ "flag": "string", "page": 1, "severity": "CRITICAL|HIGH|MEDIUM" }],
          "abnormal_findings": [{ "finding": "string", "value": "string", "reference": "string", "page": 1, "severity": "HIGH|MEDIUM|LOW" }]
        }
        
        Text Segment:
        ${chunk}`;

        const result = await model.generateContent(prompt);
        return result.response.text();
    }));

    // Final Reduction
    return await analyzeBatch(`Combined Partial Summaries from massive file:\n${chunkSummaries.join('\n\n')}`);
}

async function analyzeBatch(textContext: string) {
    const systemPrompt = `You are a medical AI. Analyze the medical OCR text and provide a full clinical intelligence report in JSON format.
    Use the provided <page_X>...</page_X> tags to accurately determine and reference the page number for every finding, event, and group item.
    
    CRITICAL: Keep the JSON keys exact as requested.
    
    Response Schema:
    {
        "document_type": "string",
        "clinical_summary": "string",
        "patients": [{ "patient_name": "string", "date_of_birth": "string", "facility": "string", "provider": "string", "summary": "string", "chief_complaint": "string", "follow_up": "string", "pages": [1] }],
        "critical_flags": [{ "flag": "string", "page": 1, "severity": "CRITICAL" }],
        "abnormal_findings": [{ "finding": "string", "value": "string", "reference": "string", "page": 1, "severity": "HIGH" }],
        "timeline": [{ "date": "string", "event": "string", "page": 1, "category": "visit|test|procedure", "patient_name": "string|null" }],
        "groups": [{ "title": "group name", "items": [{"label": "string", "value": "string", "page": 1, "status": "normal|abnormal", "reference": "string"}] }]
    }`;

    const prompt = `${systemPrompt}\n\nText:\n${textContext}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJson);
}

type IntakeDecision = {
    item_type: string;
    item_id: string;
    action: string;
    edited_value?: any | null;
    reason?: string | null;
};

type ClinicalIntake = {
    problem_list: any[];
    medications: any[];
    completed_workup: any[];
    flags: any[];
    suggested_next_steps: string[];
};

const INTAKE_PAGES_PER_CHUNK = 10;
const INTAKE_MAX_CHARS = 80_000;

const INTAKE_PASS1_PROMPT = `You are a medical AI extractor. Extract ONLY structured entities from the pages.
Do not summarize. Use <page_X> tags to determine page numbers.
Return strict JSON with this schema (no markdown):
{
  "entities": {
    "diagnoses": [
      {"text": "string", "status": "active|resolved|unknown", "page": 1, "source_text": "string"}
    ],
    "medications": [
      {"name": "string", "dose": "string", "frequency": "string", "prescriber": "string", "page": 1, "source_text": "string"}
    ],
    "procedures": [
      {"description": "string", "date": "string", "findings": "string", "page": 1, "source_text": "string"}
    ],
    "lab_results": [
      {"test": "string", "value": "string", "reference_range": "string", "date": "string", "page": 1, "source_text": "string"}
    ],
    "vitals": [
      {"name": "string", "value": "string", "units": "string", "date": "string", "page": 1, "source_text": "string"}
    ],
    "allergies": [
      {"substance": "string", "reaction": "string", "severity": "string", "page": 1, "source_text": "string"}
    ]
  }
}`;

const INTAKE_PASS2_PROMPT = `You are a medical coding assistant. Map diagnoses to ICD-10-CM and procedures to CPT.
Return strict JSON (no markdown):
{
  "diagnoses": [
    {
      "id": "string",
      "description": "string",
      "icd10_code": "string",
      "icd10_description": "string",
      "confidence": "high|medium|low",
      "specificity_note": "string|null",
      "alternatives": [{"code": "string", "description": "string", "reason": "string"}]
    }
  ],
  "procedures": [
    {
      "id": "string",
      "description": "string",
      "cpt_code": "string",
      "cpt_description": "string",
      "modifier_suggestions": ["string"],
      "confidence": "high|medium|low"
    }
  ]
}`;

const INTAKE_PASS3_PROMPT = `You are a medical QA auditor. Detect contradictions, care gaps, and missing data.
Use entity ids when referencing items. Return strict JSON (no markdown):
{
  "contradictions": [
    {
      "id": "string",
      "type": "diagnosis_conflict|medication_mismatch|lab_trend_alert|temporal_impossibility|missing_support|phantom_reference",
      "severity": "critical|warning|info",
      "description": "string",
      "item_a": {"entity_id": "string|null", "text": "string", "page": 1},
      "item_b": {"entity_id": "string|null", "text": "string", "page": 1},
      "explanation": "string",
      "suggested_action": "string"
    }
  ],
  "care_gaps": [
    {
      "id": "string",
      "type": "missing_test|missing_followup|med_without_dx|dx_without_med|incomplete_med_info",
      "related_entity_id": "string|null",
      "severity": "warning|info",
      "description": "string",
      "guideline": "string|null",
      "suggested_action": "string"
    }
  ],
  "missing_data": [
    {
      "id": "string",
      "type": "phantom_reference|missing_results",
      "description": "string",
      "page": 1,
      "suggested_action": "string"
    }
  ]
}`;

function safeJsonParse(raw: string) {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new Error('Failed to parse JSON');
    }
}

async function callGeminiJson(prompt: string) {
    const result = await model.generateContent(prompt);
    return safeJsonParse(result.response.text());
}

function buildPageText(pages: { page: number; text: string }[]) {
    return pages.map(r => `<page_${r.page}>\n${r.text}\n</page_${r.page}>`).join('\n');
}

function chunkPages(pages: { page: number; text: string }[], pagesPerChunk: number, maxChars: number) {
    const chunks: { page: number; text: string }[][] = [];
    let current: { page: number; text: string }[] = [];
    let currentChars = 0;
    for (const page of pages) {
        const pageChars = (page.text || '').length;
        if (current.length > 0 && (current.length >= pagesPerChunk || currentChars + pageChars > maxChars)) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(page);
        currentChars += pageChars;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

function dedupEntities(items: any[], keyFields: string[]) {
    const seen = new Map<string, any>();
    for (const item of items) {
        const key = keyFields.map(f => String(item?.[f] || '').trim().toLowerCase()).join('|');
        if (seen.has(key)) {
            // Aggregate page references from duplicates
            const existing = seen.get(key)!;
            const existingPages = existing.source_pages || (existing.page != null ? [existing.page] : []);
            const newPage = item.page;
            if (newPage != null && !existingPages.includes(newPage)) {
                existingPages.push(newPage);
            }
            existing.source_pages = existingPages;
        } else {
            // Initialize source_pages from the first occurrence
            if (item.page != null && !item.source_pages) {
                item.source_pages = [item.page];
            }
            seen.set(key, item);
        }
    }
    return Array.from(seen.values());
}

function assignIds(items: any[], prefix: string) {
    return items.map((item, idx) => ({ id: `${prefix}_${String(idx + 1).padStart(3, '0')}`, ...item }));
}

async function validateIcd10(code: string | null | undefined, description: string) {
    if (!code) return { validated: false, icd10_description: null, hcc_relevant: false, hcc_category: null, alternatives: [] };
    const { data } = await supabase
        .from('icd10_codes')
        .select('code, description, is_hcc, hcc_category')
        .eq('code', code)
        .maybeSingle();
    if (data) {
        return {
            validated: true,
            icd10_description: data.description,
            hcc_relevant: !!data.is_hcc,
            hcc_category: data.hcc_category,
            alternatives: [],
        };
    }
    const { data: alts } = await supabase
        .from('icd10_codes')
        .select('code, description')
        .ilike('description', `%${description.slice(0, 80)}%`)
        .limit(5);
    return {
        validated: false,
        icd10_description: null,
        hcc_relevant: false,
        hcc_category: null,
        alternatives: (alts || []).map(a => ({ code: a.code, description: a.description, reason: 'Similar description' })),
    };
}

async function generateClinicalIntake(fileId: string, ocrPages: { page: number; text: string }[]) {
    const chunks = chunkPages(ocrPages, INTAKE_PAGES_PER_CHUNK, INTAKE_MAX_CHARS);
    const entities = { diagnoses: [], medications: [], procedures: [], lab_results: [], vitals: [], allergies: [] } as any;

    for (const chunk of chunks) {
        const pageText = buildPageText(chunk);
        const payload = await callGeminiJson(`${INTAKE_PASS1_PROMPT}\n\nClinical Text:\n${pageText}`);
        const partial = payload?.entities || {};
        Object.keys(entities).forEach(k => entities[k].push(...(partial[k] || [])));
    }

    let diagnoses = dedupEntities(entities.diagnoses, ['text', 'status']);
    let medications = dedupEntities(entities.medications, ['name', 'dose', 'frequency']);
    let procedures = dedupEntities(entities.procedures, ['description', 'date']);
    const lab_results = dedupEntities(entities.lab_results, ['test', 'value', 'date']);
    const vitals = dedupEntities(entities.vitals, ['name', 'value', 'date']);
    const allergies = dedupEntities(entities.allergies, ['substance', 'reaction']);

    diagnoses = assignIds(diagnoses, 'dx');
    medications = assignIds(medications, 'med');
    procedures = assignIds(procedures, 'proc');

    const codingPayload = {
        diagnoses: diagnoses.map((d: any) => ({ id: d.id, description: d.text })),
        procedures: procedures.map((p: any) => ({ id: p.id, description: p.description })),
    };
    const coding = await callGeminiJson(`${INTAKE_PASS2_PROMPT}\n\nEntities to code:\n${JSON.stringify(codingPayload)}`);
    const codedDx: Record<string, any> = Object.fromEntries((coding.diagnoses || []).map((d: any) => [d.id, d]));
    const codedProc: Record<string, any> = Object.fromEntries((coding.procedures || []).map((p: any) => [p.id, p]));

    for (const dx of diagnoses) {
        const mapped = codedDx[dx.id] || {};
        dx.icd10_code = mapped.icd10_code || null;
        dx.icd10_description = mapped.icd10_description || null;
        dx.confidence = mapped.confidence || null;
        dx.specificity_note = mapped.specificity_note || null;
        dx.alternatives = mapped.alternatives || [];
        const validation = await validateIcd10(dx.icd10_code, dx.text || '');
        dx.validated = validation.validated;
        dx.icd10_description = validation.icd10_description || dx.icd10_description;
        dx.hcc_relevant = validation.hcc_relevant || false;
        dx.hcc_category = validation.hcc_category || null;
        if (validation.alternatives?.length) dx.alternatives = validation.alternatives;
    }

    for (const proc of procedures) {
        const mapped = codedProc[proc.id] || {};
        proc.cpt_code = mapped.cpt_code || null;
        proc.cpt_description = mapped.cpt_description || null;
        proc.modifier_suggestions = mapped.modifier_suggestions || [];
        proc.confidence = mapped.confidence || null;
        proc.validated = false;
    }

    const pass3Payload = { diagnoses, medications, procedures, lab_results, vitals, allergies };
    const contradictions = await callGeminiJson(`${INTAKE_PASS3_PROMPT}\n\nEntities and codes:\n${JSON.stringify(pass3Payload)}`);
    const contradictionsList = contradictions?.contradictions || [];
    const careGaps = contradictions?.care_gaps || [];
    const missingData = contradictions?.missing_data || [];

    const flags: any[] = [];
    contradictionsList.forEach((c: any) => flags.push({
        id: c.id,
        type: 'contradiction',
        severity: c.severity || 'warning',
        description: c.description,
        explanation: c.explanation,
        suggested_action: c.suggested_action,
    }));
    careGaps.forEach((g: any) => flags.push({
        id: g.id,
        type: 'care_gap',
        severity: g.severity || 'warning',
        description: g.description,
        explanation: g.guideline || null,
        suggested_action: g.suggested_action,
    }));
    missingData.forEach((m: any) => flags.push({
        id: m.id,
        type: 'missing_data',
        severity: 'warning',
        description: m.description,
        explanation: null,
        suggested_action: m.suggested_action,
    }));

    const problemList = diagnoses.map((dx: any) => ({
        id: dx.id,
        description: dx.text,
        icd10_code: dx.icd10_code,
        icd10_description: dx.icd10_description,
        status: dx.status,
        source_pages: [dx.page],
        source_text: dx.source_text,
        flags: [
            ...contradictionsList.filter((c: any) => c.item_a?.entity_id === dx.id || c.item_b?.entity_id === dx.id).map((c: any) => c.id),
            ...careGaps.filter((g: any) => g.related_entity_id === dx.id).map((g: any) => g.id),
        ].filter(Boolean),
        hcc_relevant: dx.hcc_relevant || false,
        validated: dx.validated || false,
        confidence: dx.confidence || null,
    }));

    const medicationList = medications.map((m: any) => ({
        id: m.id,
        name: m.name,
        dose: m.dose,
        frequency: m.frequency,
        prescriber: m.prescriber,
        source_pages: [m.page],
        source_text: m.source_text,
        flags: [],
    }));

    const completedWorkup = [
        ...procedures.map((p: any) => ({
            id: p.id,
            description: p.description,
            cpt_code: p.cpt_code,
            cpt_description: p.cpt_description,
            date: p.date,
            key_findings: p.findings,
            status: 'completed',
            validated: p.validated || false,
            source_pages: [p.page],
        })),
        ...missingData.map((m: any) => ({
            id: m.id,
            description: m.description,
            status: 'referenced_missing',
            referenced_on_page: m.page,
        })),
    ];

    const suggestedNextSteps: string[] = [];
    flags.forEach(f => {
        if (f.suggested_action && !suggestedNextSteps.includes(f.suggested_action)) {
            suggestedNextSteps.push(f.suggested_action);
        }
    });

    const clinicalIntake: ClinicalIntake = {
        problem_list: problemList,
        medications: medicationList,
        completed_workup: completedWorkup,
        flags,
        suggested_next_steps: suggestedNextSteps,
    };

    return {
        clinical_intake: clinicalIntake,
        contradictions: { contradictions: contradictionsList, care_gaps: careGaps, missing_data: missingData },
    };
}

function applyDecisions(intake: ClinicalIntake, decisions: IntakeDecision[]) {
    const decisionMap = new Map(decisions.map(d => [`${d.item_type}:${d.item_id}`, d]));
    const includeItem = (itemType: string, item: any) => {
        const decision = decisionMap.get(`${itemType}:${item.id}`);
        if (!decision) return { include: true, value: item };
        if (decision.action === 'rejected' || decision.action === 'dismissed') return { include: false, value: item };
        if (decision.action === 'edited' && decision.edited_value) return { include: true, value: { ...item, ...decision.edited_value } };
        return { include: true, value: item };
    };

    const problem_list = intake.problem_list.map(item => includeItem('diagnosis', item)).filter(r => r.include).map(r => r.value);
    const medications = intake.medications.map(item => includeItem('medication', item)).filter(r => r.include).map(r => r.value);
    const completed_workup = intake.completed_workup.map(item => includeItem('workup', item)).filter(r => r.include).map(r => r.value);
    const flags = intake.flags.map(item => includeItem('flag', item)).filter(r => r.include).map(r => r.value);

    return { ...intake, problem_list, medications, completed_workup, flags };
}

function buildCsv(intake: ClinicalIntake) {
    const rows: string[][] = [["Type", "Code", "Description", "Status", "Source Page", "Confidence"]];
    intake.problem_list.forEach((p: any) => rows.push(["diagnosis", p.icd10_code || "", p.description || "", p.status || "", (p.source_pages || []).join('|'), p.confidence || ""]));
    intake.medications.forEach((m: any) => rows.push(["medication", "", m.name || "", m.frequency || "", (m.source_pages || []).join('|'), ""]));
    intake.completed_workup.forEach((w: any) => rows.push(["workup", w.cpt_code || "", w.description || "", w.status || "", (w.source_pages || []).join('|'), ""]));
    return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function buildFhirBundle(intake: ClinicalIntake, patient?: any) {
    const bundle: any = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [],
    };

    let patientRef: string | null = null;
    if (patient) {
        const patientResource = {
            resourceType: 'Patient',
            id: 'patient-1',
            name: patient.patient_name ? [{ text: patient.patient_name }] : undefined,
            birthDate: patient.date_of_birth || undefined,
        };
        patientRef = 'Patient/patient-1';
        bundle.entry.push({ resource: patientResource });
    }

    intake.problem_list.forEach((p: any) => {
        bundle.entry.push({
            resource: {
                resourceType: 'Condition',
                id: `condition-${p.id}`,
                clinicalStatus: { text: p.status || 'active' },
                code: {
                    coding: p.icd10_code ? [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: p.icd10_code, display: p.icd10_description || p.description }] : undefined,
                    text: p.description,
                },
                subject: patientRef ? { reference: patientRef } : undefined,
            },
        });
    });

    intake.completed_workup.forEach((w: any) => {
        if (w.status !== 'completed') return;
        bundle.entry.push({
            resource: {
                resourceType: 'Procedure',
                id: `procedure-${w.id}`,
                status: 'completed',
                code: {
                    coding: w.cpt_code ? [{ system: 'http://www.ama-assn.org/go/cpt', code: w.cpt_code, display: w.cpt_description || w.description }] : undefined,
                    text: w.description,
                },
                subject: patientRef ? { reference: patientRef } : undefined,
            },
        });
    });

    intake.medications.forEach((m: any) => {
        bundle.entry.push({
            resource: {
                resourceType: 'MedicationStatement',
                id: `med-${m.id}`,
                status: 'active',
                medicationCodeableConcept: { text: m.name },
                subject: patientRef ? { reference: patientRef } : undefined,
            },
        });
    });

    bundle.entry.push({
        resource: {
            resourceType: 'DocumentReference',
            id: 'document-1',
            status: 'current',
            description: 'Clinical Intake Sheet',
        },
    });

    bundle.entry.push({
        resource: {
            resourceType: 'Provenance',
            id: 'provenance-1',
            recorded: new Date().toISOString(),
            activity: { text: 'AI-assisted extraction' },
        },
    });

    return bundle;
}

async function buildPdf(intake: ClinicalIntake) {
    const doc = await PDFDocument.create();
    let page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 11;
    const titleSize = 16;
    const marginX = 50;
    const marginY = 50;
    const lineHeight = 15;
    const contentWidth = page.getSize().width - marginX * 2;
    let y = page.getSize().height - marginY;

    const wrapLine = (text: string, currentFont = font, size = fontSize) => {
        const words = text.split(' ');
        const lines: string[] = [];
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (currentFont.widthOfTextAtSize(test, size) <= contentWidth) {
                line = test;
            } else {
                if (line) lines.push(line);
                line = word;
            }
        }
        if (line) lines.push(line);
        return lines;
    };

    const drawLine = (text: string, currentFont = font, size = fontSize) => {
        if (y < marginY) {
            page = doc.addPage();
            y = page.getSize().height - marginY;
        }
        page.drawText(text, { x: marginX, y, size, font: currentFont });
        y -= lineHeight;
    };

    drawLine('Clinical Intake Sheet', fontBold, titleSize);
    y -= lineHeight / 2;

    const section = (label: string, items: string[]) => {
        drawLine(label, fontBold, fontSize + 1);
        if (items.length === 0) {
            drawLine('No entries.', font, fontSize);
        } else {
            for (const item of items) {
                const wrapped = wrapLine(`• ${item}`, font, fontSize);
                wrapped.forEach(line => drawLine(line, font, fontSize));
            }
        }
        y -= lineHeight / 2;
    };

    section('Problem List', intake.problem_list.map((p: any) => `${p.icd10_code || ''} ${p.description || ''}`.trim()));
    section('Medications', intake.medications.map((m: any) => [m.name, m.dose, m.frequency].filter(Boolean).join(' ')));
    section('Completed Workup', intake.completed_workup.map((w: any) => `${w.cpt_code || ''} ${w.description || ''} (${w.status || ''})`.trim()));
    section('Flags', intake.flags.map((f: any) => `${(f.severity || '').toUpperCase()} ${f.description || ''}`.trim()));

    return await doc.save();
}

/* ─── API HANDLERS ─── */

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    const endpoint = path[0];
    const isIntakeExport = endpoint === 'intake' && path[path.length - 1] === 'export';
    const fileId = isIntakeExport ? path[path.length - 2] : path[path.length - 1];

    if (endpoint === 'code-search') {
        const { searchParams } = new URL(request.url);
        const type = searchParams.get('type');
        const q = (searchParams.get('q') || '').trim();
        if (type !== 'icd10') return NextResponse.json({ error: 'Unsupported code type' }, { status: 400 });
        if (!q) return NextResponse.json({ data: [] });
        const { data } = await supabase
            .from('icd10_codes')
            .select('code, description')
            .or(`code.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(10);
        return NextResponse.json({ data: data || [] });
    }

    if (!fileId) return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });

    try {
        // 1. Check if analysis already exists in DB
        const { data: cached } = await supabase
            .from('ai_analysis')
            .select('*')
            .eq('file_id', fileId)
            .maybeSingle();

        if (cached && endpoint === 'intake') {
            console.log(`AI Route [${endpoint}]: Serving from DB cache`);
            const { data: docInfo } = await supabase
                .from('documents')
                .select('user_id')
                .eq('file_id', fileId)
                .maybeSingle();
            const { data: decisions } = await supabase
                .from('intake_decisions')
                .select('item_type,item_id,action,edited_value,reason')
                .eq('file_id', fileId)
                .eq('user_id', docInfo?.user_id || null);

            if (!cached.clinical_intake) {
                const { data: ocrPages } = await supabase.from('ocr_results').select('page, text').eq('file_id', fileId).order('page');
                if (!ocrPages || ocrPages.length === 0) {
                    return NextResponse.json({ data: null, status: 'processing', message: 'Awaiting OCR...' });
                }
                const generated = await generateClinicalIntake(fileId, ocrPages);
                await supabase.from('ai_analysis').upsert({
                    file_id: fileId,
                    clinical_intake: generated.clinical_intake,
                    contradictions: generated.contradictions,
                    intake_status: 'complete',
                });
                return NextResponse.json({ data: { ...generated, intake_status: 'complete', decisions: decisions || [] } });
            }

            if (isIntakeExport) {
                const format = new URL(request.url).searchParams.get('format') || 'csv';
                const baseIntake = applyDecisions(cached.clinical_intake as ClinicalIntake, decisions || []);
                if (format === 'fhir') {
                    const patient = cached.patients?.[0];
                    const bundle = buildFhirBundle(baseIntake, patient);
                    return NextResponse.json({ data: bundle });
                }
                if (format === 'pdf') {
                    const pdfBytes = await buildPdf(baseIntake);
                    return new Response(pdfBytes as any, {
                        headers: { 'Content-Type': 'application/pdf' },
                    });
                }
                const csv = buildCsv(baseIntake);
                return new Response(csv as any, {
                    headers: { 'Content-Type': 'text/csv' },
                });
            }

            return NextResponse.json({
                data: {
                    clinical_intake: cached.clinical_intake,
                    contradictions: cached.contradictions,
                    intake_status: cached.intake_status || 'complete',
                    decisions: decisions || [],
                }
            });
        }

        if (cached && cached.is_complete) {
            console.log(`AI Route [${endpoint}]: Serving from DB cache`);

            // Special handling for body-map endpoint — uses Gemini to classify findings into body regions
            if (endpoint === 'body-map') {
                try {
                    // Build per-patient finding lists
                    const patients: { name: string; findings: { text: string; severity: string; type: string }[] }[] = [];

                    // Shared findings (flags apply to all patients)
                    const sharedFindings: { text: string; severity: string; type: string }[] = [];
                    if (cached.critical_flags) {
                        for (const f of cached.critical_flags) {
                            sharedFindings.push({ text: f.flag, severity: 'critical', type: 'critical_flag' });
                        }
                    }
                    if (cached.abnormal_findings) {
                        for (const f of cached.abnormal_findings) {
                            sharedFindings.push({ text: `${f.finding}: ${f.value} (ref: ${f.reference})`, severity: f.severity === 'CRITICAL' ? 'critical' : 'abnormal', type: 'abnormal_finding' });
                        }
                    }

                    // If multiple patients exist, create per-patient entries
                    const patientEntries = cached.patients && cached.patients.length > 1 ? cached.patients : null;

                    if (patientEntries) {
                        // Multi-patient: distribute shared findings + per-patient group items
                        const perPatientGroups = cached.groups
                            ? (Array.isArray(cached.groups[0]?.items) ? [{ patient_name: 'All', groups: cached.groups }] : [])
                            : [];

                        // Check if details has per-patient grouping via patients array in details
                        // For now, shared findings go to all patients; group items distributed if possible
                        for (let pi = 0; pi < patientEntries.length; pi++) {
                            const p = patientEntries[pi];
                            const pFindings = [...sharedFindings]; // each patient gets the flags

                            // Add group items as patient-specific findings
                            if (cached.groups) {
                                for (const g of cached.groups) {
                                    for (const item of g.items) {
                                        if (item.status === 'abnormal') {
                                            pFindings.push({ text: `${item.label}: ${item.value}`, severity: 'abnormal', type: 'detail' });
                                        }
                                    }
                                }
                            }

                            patients.push({
                                name: p.patient_name || `Patient ${pi + 1}`,
                                findings: pFindings,
                            });
                        }
                    } else {
                        // Single patient (or no patient info)
                        const singleFindings = [...sharedFindings];
                        if (cached.groups) {
                            for (const g of cached.groups) {
                                for (const item of g.items) {
                                    if (item.status === 'abnormal') {
                                        singleFindings.push({ text: `${item.label}: ${item.value}`, severity: 'abnormal', type: 'detail' });
                                    }
                                }
                            }
                        }
                        const patientName = cached.patients?.[0]?.patient_name || 'Patient';
                        patients.push({ name: patientName, findings: singleFindings });
                    }

                    // Deduplicate: run Gemini once with ALL unique findings across all patients
                    const allUnique = new Map<string, { text: string; severity: string; type: string }>();
                    for (const p of patients) {
                        for (const f of p.findings) {
                            allUnique.set(f.text, f);
                        }
                    }
                    const allFindings = Array.from(allUnique.values());

                    if (allFindings.length === 0) {
                        return NextResponse.json({ data: { patients: patients.map(p => ({ name: p.name, regions: {} })) } });
                    }

                    const findingsText = allFindings.map((f, i) => `${i + 1}. [${f.severity.toUpperCase()}] ${f.text}`).join('\n');

                    const bodyMapPrompt = `You are a medical AI. Given the following clinical findings, classify each finding into the most relevant body region.

Available body regions (use EXACTLY these keys):
- head (brain, neurological, headache, mental health, eyes, ears)
- neck (thyroid, throat, ENT, cervical)
- chest (lungs, respiratory, pulmonary, breathing)
- heart (cardiac, blood pressure, cholesterol, cardiovascular, pulse)
- abdomen (GI, liver, kidney, pancreas, stomach, intestinal, hepatic, renal)
- left_arm (left arm, left hand, left shoulder)
- right_arm (right arm, right hand, right shoulder)
- left_leg (left leg, left foot, left knee, left hip)
- right_leg (right leg, right foot, right knee, right hip)
- spine (back, spinal, lumbar, vertebral)
- pelvis (urological, reproductive, bladder, prostate, gynecological)
- skin (dermatological, rash, wound, lesion)
- systemic (blood, glucose, hemoglobin, WBC, platelets, infection, fever, general)

Findings:
${findingsText}

Return a JSON object with body region keys, each containing an array of finding indices (1-based) that belong to that region. A finding can appear in multiple regions if relevant.

Return ONLY the JSON object, no markdown formatting.`;

                    const bodyResult = await model.generateContent(bodyMapPrompt);
                    const bodyText = bodyResult.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                    const regionMapping: Record<string, number[]> = JSON.parse(bodyText);

                    // Build per-patient region data using the shared classification
                    const result = patients.map(patient => {
                        const patientFindingTexts = new Set(patient.findings.map(f => f.text));
                        const regions: Record<string, { findings: any[]; severity: string }> = {};

                        for (const [region, indices] of Object.entries(regionMapping)) {
                            const regionFindings = (indices as number[])
                                .map(i => allFindings[i - 1])
                                .filter(f => f && patientFindingTexts.has(f.text));
                            if (regionFindings.length === 0) continue;
                            const hasCritical = regionFindings.some(f => f.severity === 'critical');
                            regions[region] = {
                                findings: regionFindings,
                                severity: hasCritical ? 'critical' : 'abnormal'
                            };
                        }

                        return { name: patient.name, regions };
                    });

                    return NextResponse.json({ data: { patients: result } });
                } catch (bodyMapErr: any) {
                    console.error('Body map classification error:', bodyMapErr);
                    return NextResponse.json({ data: { patients: [{ name: 'Patient', regions: {} }] }, error: bodyMapErr.message });
                }
            }

            if (endpoint === 'chronology' || endpoint === 'issues') {
                const { settings } = await fetchCaseSettings(fileId);
                const latest = await fetchLatestChronology(fileId);
                const versions = await fetchChronologyVersions(fileId);
                const sourceTimeline = cached.timeline_index && cached.timeline_index.length > 0 ? cached.timeline_index : cached.timeline;
                const aiChronology = buildChronologyFromTimeline(sourceTimeline, settings.incident_date);
                const baseChronology = latest?.data || aiChronology;
                const chronology = applyPhase(baseChronology, settings.incident_date);
                const { data: ocrPages } = await supabase.from('ocr_results').select('page, text').eq('file_id', fileId).order('page');
                // Pull intake flags for AI-powered issue detection (if intake processing is complete)
                const intakeFlags = cached.clinical_intake?.flags || [];
                const issues = computeIssues(chronology, ocrPages || [], settings, intakeFlags);
                return NextResponse.json({
                    data: {
                        chronology,
                        ai_chronology: aiChronology,
                        issues,
                        version: latest?.version ?? 0,
                        source: latest?.source || (latest ? 'user' : 'ai'),
                        versions,
                        settings,
                        columns: latest?.columns || settings.column_order || null
                    }
                });
            }

            const mapping: Record<string, any> = {
                'summary': { document_type: cached.document_type, clinical_summary: cached.clinical_summary, patients: cached.patients },
                'flags': { critical_flags: cached.critical_flags, abnormal_findings: cached.abnormal_findings },
                'timeline': { timeline: cached.timeline_index && cached.timeline_index.length > 0 ? cached.timeline_index : cached.timeline },
                'details': { groups: cached.groups },
                'index': { document_index: cached.document_index, page_index: cached.page_index }
            };
            return NextResponse.json({ data: mapping[endpoint] || cached });
        }

        if (cached && !cached.is_complete) {
            return NextResponse.json({ data: null, status: "processing", message: "Awaiting AI Analysis..." });
        }

        // 2. If not cached, we need to check if OCR is done and trigger processing
        const { data: docInfo } = await supabase.from('documents').select('user_id').eq('file_id', fileId).maybeSingle();
        const { data: ocrData } = await supabase.from('ocr_results').select('page, text').eq('file_id', fileId).order('page');

        if (!ocrData || ocrData.length === 0) {
            return NextResponse.json({ data: null, status: "processing", message: "Awaiting OCR..." });
        }

        // If we reach here, text exists but analysis doesn't. 
        // We'll return a 202 Accepted and the UI should wait for the background process or a subsequent call should trigger it.
        // For simplicity in this demo, let's just trigger it synchronously on the first hit if it's missing.

        if (endpoint === 'intake') {
            const { data: ocrPages } = await supabase.from('ocr_results').select('page, text').eq('file_id', fileId).order('page');
            const generated = await generateClinicalIntake(fileId, (ocrPages || ocrData) as any);
            await supabase.from('ai_analysis').upsert({
                file_id: fileId,
                user_id: docInfo?.user_id,
                clinical_intake: generated.clinical_intake,
                contradictions: generated.contradictions,
                intake_status: 'complete',
                is_complete: false,
            });
            
            if (isIntakeExport) {
                const format = new URL(request.url).searchParams.get('format') || 'csv';
                const baseIntake = generated.clinical_intake as ClinicalIntake;
                if (format === 'fhir') {
                    const bundle = buildFhirBundle(baseIntake, undefined);
                    return NextResponse.json({ data: bundle });
                }
                if (format === 'pdf') {
                    const pdfBytes = await buildPdf(baseIntake);
                    return new Response(pdfBytes as any, {
                        headers: { 'Content-Type': 'application/pdf' },
                    });
                }
                const csv = buildCsv(baseIntake);
                return new Response(csv as any, {
                    headers: { 'Content-Type': 'text/csv' },
                });
            }
            
            return NextResponse.json({ data: { ...generated, intake_status: 'complete', decisions: [] } });
        }

        console.log(`AI Route [${endpoint}]: No cache found. Triggering full analysis...`);
        const fullText = ocrData.map(r => `<page_${r.page}>\n${r.text}\n</page_${r.page}>`).join('\n\n');
        const report = await processLargeDocument(fullText);

        // Save to DB
        await supabase.from('ai_analysis').upsert({
            file_id: fileId,
            user_id: docInfo?.user_id,
            document_type: report.document_type,
            clinical_summary: report.clinical_summary,
            patients: report.patients,
            critical_flags: report.critical_flags,
            abnormal_findings: report.abnormal_findings,
            timeline: report.timeline,
            groups: report.groups,
            is_complete: true
        });

        if (endpoint === 'chronology' || endpoint === 'issues') {
            const { settings } = await fetchCaseSettings(fileId);
            const aiChronology = buildChronologyFromTimeline(report.timeline, settings.incident_date);
            const chronology = applyPhase(aiChronology, settings.incident_date);
            const issues = computeIssues(chronology, ocrData || [], settings);
            return NextResponse.json({
                data: {
                    chronology,
                    ai_chronology: aiChronology,
                    issues,
                    version: 0,
                    source: 'ai',
                    versions: [],
                    settings,
                    columns: settings.column_order || null
                }
            });
        }

        const mapping: Record<string, any> = {
            'summary': { document_type: report.document_type, clinical_summary: report.clinical_summary, patients: report.patients },
            'flags': { critical_flags: report.critical_flags, abnormal_findings: report.abnormal_findings },
            'timeline': { timeline: report.timeline },
            'details': { groups: report.groups }
        };

        return NextResponse.json({ data: mapping[endpoint] || report });

    } catch (error: any) {
        console.error("AI Route Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    const endpoint = path[0];
    const isIntakeDecision = endpoint === 'intake' && path[path.length - 1] === 'decision';
    const fileId = isIntakeDecision ? path[path.length - 2] : path[path.length - 1];

    if (isIntakeDecision) {
        try {
            const body = await request.json();
            const { item_type, item_id, action, edited_value, reason } = body || {};
            if (!item_type || !item_id || !action) {
                return NextResponse.json({ error: 'Missing decision fields' }, { status: 400 });
            }
            const { data: docInfo } = await supabase.from('documents').select('user_id').eq('file_id', fileId).maybeSingle();
            if (!docInfo?.user_id) {
                return NextResponse.json({ error: 'Missing document user context' }, { status: 400 });
            }
            const payload = {
                file_id: fileId,
                user_id: docInfo.user_id,
                item_type,
                item_id,
                action,
                edited_value: edited_value || null,
                reason: reason || null,
            };
            const { error } = await supabase.from('intake_decisions').upsert(payload, { onConflict: 'file_id,user_id,item_type,item_id' });
            if (error) throw error;
            return NextResponse.json({ data: { ok: true } });
        } catch (error: any) {
            console.error('[Intake Decision] Error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
    }

    if (endpoint === 'chronology') {
        try {
            const body = await request.json();
            const action = body.action || 'save_version';

            const { data: docInfo } = await supabase.from('documents').select('case_id, user_id').eq('file_id', fileId).maybeSingle();
            if (!docInfo?.user_id) {
                return NextResponse.json({ error: "Missing document user context" }, { status: 400 });
            }

            if (action === 'update_settings') {
                const settingsPayload = {
                    user_id: docInfo.user_id,
                    case_id: docInfo.case_id,
                    incident_date: body.incident_date || null,
                    gap_days_threshold: body.gap_days_threshold ?? DEFAULT_GAP_DAYS,
                    preferred_columns: body.preferred_columns || null,
                    hidden_columns: body.hidden_columns || null,
                    column_order: body.column_order || null,
                };
                const { error } = await supabase.from('case_settings').upsert(settingsPayload, { onConflict: 'user_id,case_id' });
                if (error) throw error;
                return NextResponse.json({ data: { settings: settingsPayload } });
            }

            if (action === 'save_version') {
                const chronology = body.chronology as ChronologyEvent[];
                if (!Array.isArray(chronology) || chronology.length === 0) {
                    return NextResponse.json({ error: "Missing chronology data" }, { status: 400 });
                }
                const invalid = chronology.find(ev => !ev.pages || ev.pages.length === 0 || ev.pages.some(p => typeof p !== 'number'));
                if (invalid) {
                    return NextResponse.json({ error: "All chronology events must include at least one Bates/page reference." }, { status: 400 });
                }

                const { data: latest } = await supabase
                    .from('chronology_versions')
                    .select('version')
                    .eq('file_id', fileId)
                    .order('version', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                const nextVersion = (latest?.version || 0) + 1;

                const insertPayload = {
                    file_id: fileId,
                    user_id: docInfo.user_id,
                    version: nextVersion,
                    label: body.label || null,
                    comment: body.comment || null,
                    source: 'user',
                    base_version: body.base_version ?? null,
                    is_final: !!body.is_final,
                    data: chronology,
                    columns: body.columns || null,
                };
                const { error } = await supabase.from('chronology_versions').insert(insertPayload);
                if (error) throw error;
                return NextResponse.json({ data: { version: nextVersion } });
            }

            return NextResponse.json({ error: 'Unknown chronology action' }, { status: 400 });
        } catch (error: any) {
            console.error("[Chronology] Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
    }

    if (endpoint === 'ask') {
        try {
            const body = await request.json();
            const { question, fileId } = body;

            if (!question || !fileId) {
                return NextResponse.json({ error: "Missing question or fileId" }, { status: 400 });
            }

            console.log(`[Ask AI] Processing question for file ${fileId}: ${question}`);

            // 1. Generate Embedding for the question
            const embeddingResult = await embeddingModel.embedContent({
                content: { role: 'user', parts: [{ text: question }] },
                taskType: "RETRIEVAL_QUERY",
                outputDimensionality: 768,
            } as any);
            const embedding = embeddingResult.embedding.values;

            // 2. Search Vector DB
            const { data: chunks, error: meshError } = await supabase.rpc('match_document_chunks', {
                query_embedding: embedding,
                match_threshold: 0.1, // Low threshold for demo
                match_count: 5,
                p_file_id: fileId
            });

            if (meshError) {
                console.error("[Ask AI] Vector Search Error:", meshError);
                throw meshError;
            }

            const contextText = chunks?.map((c: any) => `[Page ${c.page_number}]: ${c.content}`).join('\n\n') || "No relevant context found.";

            console.log(`[Ask AI] Retrieved ${chunks?.length || 0} chunks for RAG:`);
            chunks?.forEach((c: any, i: number) => {
                console.log(`  - Chunk ${i + 1} (Page ${c.page_number}, Similarity: ${c.similarity?.toFixed(4)}): "${c.content.substring(0, 150)}..."`);
            });

            // 3. Generate Text Answer first
            const textResult = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{
                        text: `You are a medical AI assistant. Answer the user's question based ONLY on the provided document context.
                        If the answer is not in the context, say you don't know based on the file.
                        Be concise and direct, suitable for voice output.
                        
                        Document Context:
                        ${contextText}
                        
                        User Question: ${question}`
                    }]
                }]
            });
            const answer = textResult.response.text();

            // 4. Transform Text to Audio (Resilient Wrap)
            let audioBase64 = "";
            let mimeType = 'audio/wav';
            try {
                console.log(`[Ask AI] Attempting Speaking via Gemini TTS Service (Puck)...`);
                const aiResult = await audioModel.generateContent({
                    contents: [{
                        role: 'user',
                        parts: [{
                            text: answer
                        }]
                    }],
                    generationConfig: {
                        responseModalities: ["AUDIO"],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: "Puck", // Kore is usually preferred, but using Puck as per current config
                                }
                            }
                        }
                    }
                } as any);

                // Extract and wrap audio
                const parts = aiResult.response.candidates?.[0]?.content?.parts;
                if (parts) {
                    const audioPart = parts.find((p: any) => p.inlineData?.data);
                    if (audioPart?.inlineData?.data) {
                        const pcmBuffer = Buffer.from(audioPart.inlineData.data, "base64");

                        const sampleRate = 24000;
                        const numChannels = 1;
                        const bitsPerSample = 16;
                        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
                        const blockAlign = numChannels * (bitsPerSample / 8);
                        const dataSize = pcmBuffer.length;

                        const wavHeader = Buffer.alloc(44);
                        wavHeader.write('RIFF', 0);
                        wavHeader.writeUInt32LE(36 + dataSize, 4);
                        wavHeader.write('WAVE', 8);
                        wavHeader.write('fmt ', 12);
                        wavHeader.writeUInt32LE(16, 16);
                        wavHeader.writeUInt16LE(1, 20); // PCM
                        wavHeader.writeUInt16LE(numChannels, 22);
                        wavHeader.writeUInt32LE(sampleRate, 24);
                        wavHeader.writeUInt32LE(byteRate, 28);
                        wavHeader.writeUInt16LE(blockAlign, 32);
                        wavHeader.writeUInt16LE(bitsPerSample, 34);
                        wavHeader.write('data', 36);
                        wavHeader.writeUInt32LE(dataSize, 40);

                        const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
                        audioBase64 = wavBuffer.toString('base64');
                    }
                }
            } catch (audioErr: any) {
                console.warn("[Ask AI] Audio generation failed (fallback to text-only):", audioErr.message);
            }

            console.log(`[Ask AI] Generated Answer: ${answer} (Audio generated: ${!!audioBase64})`);

            return NextResponse.json({
                answer,
                audio: audioBase64,
                mimeType,
                contextUsed: chunks?.length || 0
            });

        } catch (error: any) {
            console.error("[Ask AI] Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
    }

    if (endpoint === 'speak') {
        try {
            const body = await request.json();
            const textToSpeak = body.text;

            if (!textToSpeak) {
                return NextResponse.json({ error: "Missing text to speak" }, { status: 400 });
            }

            console.log(`[Audio] Generating native audio stream via Gemini TTS Service (Puck) for text (${textToSpeak.length} chars)...`);

            const result = await audioModel.generateContentStream({
                contents: [{
                    role: 'user',
                    parts: [{ text: textToSpeak }]
                }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Puck",
                            },
                        },
                    },
                }
            } as any);

            const audioChunks: Buffer[] = [];
            for await (const chunk of result.stream) {
                const parts = chunk.candidates?.[0]?.content?.parts;
                if (parts) {
                    for (const part of parts) {
                        if (part.inlineData?.data) {
                            audioChunks.push(Buffer.from(part.inlineData.data, "base64"));
                        }
                    }
                }
            }

            if (audioChunks.length === 0) {
                console.log("[Audio] No audio chunks received in stream.");
                return NextResponse.json({ error: "No audio generated" }, { status: 500 });
            }

            const pcmBuffer = Buffer.concat(audioChunks);
            let audioBase64 = pcmBuffer.toString('base64');
            let mimeType = 'audio/L16;rate=24000'; // Default for Kore PCM

            // The model returns raw PCM (L16). We need to wrap it in a WAV header for browser playback.
            if (mimeType.includes('pcm') || mimeType.includes('L16')) {
                console.log("[Audio] Converting raw PCM to WAV container...");
                const wavHeader = Buffer.alloc(44);

                const sampleRate = 24000;
                const numChannels = 1;
                const bitsPerSample = 16;
                const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
                const blockAlign = numChannels * (bitsPerSample / 8);
                const dataSize = pcmBuffer.length;

                // RIFF header
                wavHeader.write('RIFF', 0);
                wavHeader.writeUInt32LE(36 + dataSize, 4);
                wavHeader.write('WAVE', 8);
                // fmt subchunk
                wavHeader.write('fmt ', 12);
                wavHeader.writeUInt32LE(16, 16);
                wavHeader.writeUInt16LE(1, 20); // PCM
                wavHeader.writeUInt16LE(numChannels, 22);
                wavHeader.writeUInt32LE(sampleRate, 24);
                wavHeader.writeUInt32LE(byteRate, 28);
                wavHeader.writeUInt16LE(blockAlign, 32);
                wavHeader.writeUInt16LE(bitsPerSample, 34);
                // data subchunk
                wavHeader.write('data', 36);
                wavHeader.writeUInt32LE(dataSize, 40);

                const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
                audioBase64 = wavBuffer.toString('base64');
                mimeType = 'audio/wav';
            }

            console.log(`[Audio] Successfully generated and converted ${audioBase64.length} bytes of audio (${mimeType})`);
            return NextResponse.json({ audio: audioBase64, mimeType });
        } catch (error: any) {
            console.error("Narration Endpoint Error:", error);
            return NextResponse.json({ error: error.message || "Failed to generate audio response." }, { status: 500 });
        }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
