'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MicrophoneIcon,
  PauseIcon,
  PlayIcon,
  PlusCircleIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import { authedFetchJson, jsonRequest } from '@/lib/client/auth-fetch';
import type {
  ConsultationSessionData,
  ConsultationSpeaker,
  SuggestedQuestion,
} from '@/lib/ime-types';

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type ConsultationAssistantProps = {
  caseId: string;
};

type ConsultationResponse = {
  data: ConsultationSessionData | null;
};

function formatElapsed(session: ConsultationSessionData | null, nowMs: number) {
  if (!session) return '00:00';
  const start = new Date(session.started_at).getTime();
  const end = session.ended_at ? new Date(session.ended_at).getTime() : nowMs;
  const diff = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = String(Math.floor(diff / 60)).padStart(2, '0');
  const seconds = String(diff % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function QuestionCard({ question }: { question: SuggestedQuestion }) {
  const priorityClass = question.priority === 'high'
    ? 'bg-red-50 text-red-700 border-red-200'
    : question.priority === 'medium'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{question.label}</div>
          <p className="mt-2 text-sm font-semibold text-slate-800">{question.suggestedQuestion}</p>
          {question.rationale && (
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{question.rationale}</p>
          )}
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${priorityClass}`}>
          {question.priority}
        </span>
      </div>
    </div>
  );
}

export default function ConsultationAssistant({ caseId }: ConsultationAssistantProps) {
  const [session, setSession] = useState<ConsultationSessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entryText, setEntryText] = useState('');
  const [activeSpeaker, setActiveSpeaker] = useState<ConsultationSpeaker>('doctor');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authedFetchJson<ConsultationResponse>(`/api/consultation/latest?caseId=${encodeURIComponent(caseId)}`);
      setSession(response.data);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Unable to load consultation session.');
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const openRecognition = useCallback(() => {
    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!RecognitionCtor || !session || session.status === 'completed') {
      return;
    }

    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = async (event) => {
      let finalText = '';
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0]?.transcript || '';
        } else {
          interim += result[0]?.transcript || '';
        }
      }

      setInterimTranscript(interim.trim());
      if (finalText.trim()) {
        try {
          setSaving(true);
          const payload = await authedFetchJson<ConsultationResponse>(
            `/api/consultation/${session.id}`,
            jsonRequest({
              speaker: activeSpeaker,
              text: finalText.trim(),
              timestamp: session.transcript.length + 1,
            }),
          );
          setSession(payload.data);
          setStatusMessage('Speech captured and added to the transcript.');
          setInterimTranscript('');
        } catch (error) {
          setStatusMessage(error instanceof Error ? error.message : 'Failed to save dictated transcript.');
        } finally {
          setSaving(false);
        }
      }
    };

    recognition.onerror = (event) => {
      setStatusMessage(event.error ? `Microphone error: ${event.error}` : 'Microphone capture failed.');
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setStatusMessage('Browser speech capture is running.');
  }, [activeSpeaker, session]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setInterimTranscript('');
      return;
    }
    openRecognition();
  }, [isListening, openRecognition]);

  const createSession = useCallback(async () => {
    setSaving(true);
    try {
      const response = await authedFetchJson<ConsultationResponse>(
        '/api/consultation/new',
        jsonRequest({
          caseId,
          title: `Consultation ${new Date().toLocaleDateString('en-US')}`,
          speakerLabels: { doctor: 'Doctor', patient: 'Patient' },
        }),
      );
      setSession(response.data);
      setStatusMessage('Consultation session started.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to create consultation session.');
    } finally {
      setSaving(false);
    }
  }, [caseId]);

  const changeSessionStatus = useCallback(async (nextStatus: ConsultationSessionData['status']) => {
    if (!session) return;
    setSaving(true);
    try {
      const response = await authedFetchJson<ConsultationResponse>(`/api/consultation/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      setSession(response.data);
      setStatusMessage(nextStatus === 'completed' ? 'Consultation session completed.' : `Session marked ${nextStatus}.`);
      if (nextStatus !== 'recording') {
        recognitionRef.current?.stop();
        setIsListening(false);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to update session status.');
    } finally {
      setSaving(false);
    }
  }, [session]);

  const addTranscriptEntry = useCallback(async () => {
    if (!session || !entryText.trim()) return;
    setSaving(true);
    try {
      const response = await authedFetchJson<ConsultationResponse>(
        `/api/consultation/${session.id}`,
        jsonRequest({
          speaker: activeSpeaker,
          text: entryText.trim(),
          timestamp: session.transcript.length + 1,
        }),
      );
      setSession(response.data);
      setEntryText('');
      setStatusMessage('Transcript segment saved.');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Failed to save transcript segment.');
    } finally {
      setSaving(false);
    }
  }, [activeSpeaker, entryText, session]);

  const uncoveredQuestions = useMemo(
    () => (session?.suggestedQuestions || []).filter((question) => !question.covered),
    [session?.suggestedQuestions],
  );

  const summaryEntries = useMemo(() => {
    const summary = session?.summary;
    if (!summary) return [];
    return [
      { label: 'Chief Complaint', value: summary.chiefComplaint },
      { label: 'History of Present Illness', value: summary.historyOfPresentIllness },
      { label: 'Current Symptoms', value: summary.currentSymptoms },
      { label: 'Functional Limitations', value: summary.functionalLimitations },
      { label: 'Patient-Reported History', value: summary.patientReportedHistory },
    ].filter((item) => item.value);
  }, [session?.summary]);

  const canCapture = typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  if (loading) {
    return (
      <div className="p-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">Consultation Assistant</div>
            <h3 className="mt-2 text-lg font-bold text-slate-900">
              {session?.title || 'Live IME consultation capture'}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              First pass uses authenticated session storage plus manual transcript capture, with optional browser speech dictation when available. The reserved `/api/consultation/stream` path is ready for a future WebSocket transport.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-2xl border border-blue-200 bg-white px-4 py-2 text-sm font-black text-blue-700 shadow-sm">
              {formatElapsed(session, nowMs)}
            </div>
            {!session ? (
              <button
                onClick={createSession}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:opacity-60"
              >
                <PlusCircleIcon className="h-5 w-5" />
                Start Session
              </button>
            ) : (
              <>
                {session.status === 'recording' ? (
                  <button
                    onClick={() => changeSessionStatus('paused')}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <PauseIcon className="h-5 w-5" />
                    Pause
                  </button>
                ) : session.status === 'paused' ? (
                  <button
                    onClick={() => changeSessionStatus('recording')}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    <PlayIcon className="h-5 w-5" />
                    Resume
                  </button>
                ) : null}
                {session.status !== 'completed' && (
                  <button
                    onClick={() => changeSessionStatus('completed')}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-black disabled:opacity-60"
                  >
                    <StopIcon className="h-5 w-5" />
                    Complete
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {statusMessage && (
          <div className="mt-4 rounded-2xl border border-blue-100 bg-white/80 px-4 py-3 text-sm text-slate-600">
            {statusMessage}
          </div>
        )}
      </div>

      {!session ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-slate-500">
          Start a consultation session to capture transcript segments, build a rolling IME summary, and surface missing-question prompts.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Transcript Capture</div>
                  <p className="mt-2 text-sm text-slate-600">Toggle the speaker, dictate with the browser, or paste/add transcript snippets manually.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                    {(['doctor', 'patient'] as ConsultationSpeaker[]).map((speaker) => (
                      <button
                        key={speaker}
                        onClick={() => setActiveSpeaker(speaker)}
                        className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition ${
                          activeSpeaker === speaker ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        {speaker}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={toggleListening}
                    disabled={!canCapture || session.status !== 'recording' || saving}
                    className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-black transition ${
                      isListening
                        ? 'bg-red-600 text-white shadow-lg shadow-red-100'
                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <MicrophoneIcon className="h-5 w-5" />
                    {isListening ? 'Stop Mic' : 'Start Mic'}
                  </button>
                </div>
              </div>

              {interimTranscript && (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm italic text-blue-700">
                  Listening: {interimTranscript}
                </div>
              )}

              <div className="mt-4 flex flex-col gap-3">
                <textarea
                  value={entryText}
                  onChange={(event) => setEntryText(event.target.value)}
                  placeholder={`Add a ${activeSpeaker} transcript segment...`}
                  rows={4}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
                <div className="flex justify-end">
                  <button
                    onClick={addTranscriptEntry}
                    disabled={saving || !entryText.trim() || session.status !== 'recording'}
                    className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    Add Segment
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Live Transcript</div>
                <div className="text-xs font-semibold text-slate-500">{session.transcript.length} segments</div>
              </div>
              <div className="mt-4 max-h-[480px] space-y-3 overflow-y-auto pr-1">
                {session.transcript.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Transcript entries will appear here as the consultation progresses.
                  </div>
                ) : session.transcript.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-2xl border px-4 py-3 ${
                      entry.speaker === 'doctor'
                        ? 'border-blue-100 bg-blue-50'
                        : 'border-emerald-100 bg-emerald-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{entry.speaker}</span>
                      <span className="text-xs text-slate-400">#{entry.sequence}</span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">{entry.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Rolling Summary</div>
              <div className="mt-4 space-y-3">
                {summaryEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                    Summary headings will fill in as transcript segments are captured.
                  </div>
                ) : summaryEntries.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{item.label}</div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Suggested Questions</div>
                <div className="text-xs font-semibold text-slate-500">{uncoveredQuestions.length} open</div>
              </div>
              <div className="mt-4 space-y-3">
                {uncoveredQuestions.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-8 text-center text-sm text-emerald-700">
                    Current consultation coverage looks strong. No outstanding IME gaps are flagged right now.
                  </div>
                ) : uncoveredQuestions.map((question) => (
                  <QuestionCard key={question.key} question={question} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
