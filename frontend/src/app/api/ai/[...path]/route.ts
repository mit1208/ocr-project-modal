import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
// Use 2.5 Flash for primary text analysis
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
// Use the specific TTS model for unary audio generateContent calls
const audioModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-tts" });
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

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
        const prompt = `System: You are an expert medical analyzer. Summarize this segment of a massive medical file. Extract clinical facts, timeline events, and abnormal findings. Return JSON.
        
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
        "timeline": [{ "date": "string", "event": "string", "page": 1, "category": "visit|test|procedure" }],
        "groups": [{ "title": "group name", "items": [{"label": "string", "value": "string", "page": 1, "status": "normal|abnormal", "reference": "string"}] }]
    }`;

    const prompt = `${systemPrompt}\n\nText:\n${textContext}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJson);
}

/* ─── API HANDLERS ─── */

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    const { path } = await params;
    const endpoint = path[0];
    const fileId = path[path.length - 1];

    if (!fileId) return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });

    try {
        // 1. Check if analysis already exists in DB
        const { data: cached } = await supabase
            .from('ai_analysis')
            .select('*')
            .eq('file_id', fileId)
            .maybeSingle();

        if (cached) {
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

            const mapping: Record<string, any> = {
                'summary': { document_type: cached.document_type, clinical_summary: cached.clinical_summary, patients: cached.patients },
                'flags': { critical_flags: cached.critical_flags, abnormal_findings: cached.abnormal_findings },
                'timeline': { timeline: cached.timeline },
                'details': { groups: cached.groups }
            };
            return NextResponse.json({ data: mapping[endpoint] || cached });
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
