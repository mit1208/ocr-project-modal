'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type SlmModel = {
  id: string;
  version: number;
  status: string;
  base_model: string | null;
  adapter_path: string | null;
  created_at: string;
  updated_at?: string | null;
};

type SlmStatus = {
  latestModel: SlmModel | null;
  latestReadyModel: SlmModel | null;
  trainingModel: SlmModel | null;
  trainingInProgress: boolean;
  averageBestScore: number | null;
  recentFeedbackCount: number;
  pendingTrainingCount: number;
  models: SlmModel[];
};

type SlmQueryResponse = {
  answer?: string;
  response?: string;
  best_response?: string;
  modelVersion?: number;
  response_time_ms?: number;
  token_count?: number;
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function badgeClass(status: string) {
  if (status === 'ready') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (status === 'training') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (status === 'failed') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-white/10 bg-white/5 text-white/60';
}

export default function SlmWorkspace({
  accessToken,
  hasDocuments,
}: {
  accessToken: string;
  hasDocuments: boolean;
}) {
  const [status, setStatus] = useState<SlmStatus | null>(null);
  const [models, setModels] = useState<SlmModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTraining, setIsTraining] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [queryMeta, setQueryMeta] = useState<{ modelVersion?: number; responseTimeMs?: number; tokenCount?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchWithAuth = useCallback(
    async (input: string, init?: RequestInit) => {
      const response = await fetch(input, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(init?.headers || {}),
        },
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Request failed');
      }
      return payload;
    },
    [accessToken],
  );

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);

    try {
      const [statusPayload, modelsPayload] = await Promise.all([
        fetchWithAuth('/api/slm/status', { method: 'GET' }),
        fetchWithAuth('/api/slm/models', { method: 'GET' }),
      ]);
      setStatus(statusPayload as SlmStatus);
      setModels((modelsPayload.models || []) as SlmModel[]);
      setError(null);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Failed to load SLM state';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, fetchWithAuth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status?.trainingInProgress) return;

    const timer = window.setInterval(() => {
      void refresh();
    }, 8000);

    return () => window.clearInterval(timer);
  }, [refresh, status?.trainingInProgress]);

  const handleTrain = useCallback(async () => {
    if (!accessToken || !hasDocuments) return;
    setIsTraining(true);
    setError(null);

    try {
      await fetchWithAuth('/api/slm/train', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await refresh();
    } catch (trainError) {
      const message = trainError instanceof Error ? trainError.message : 'Failed to start training';
      setError(message);
    } finally {
      setIsTraining(false);
    }
  }, [accessToken, fetchWithAuth, hasDocuments, refresh]);

  const handleQuery = useCallback(async () => {
    if (!question.trim()) return;
    setIsQuerying(true);
    setError(null);

    try {
      const payload = (await fetchWithAuth('/api/slm/query', {
        method: 'POST',
        body: JSON.stringify({ question: question.trim() }),
      })) as SlmQueryResponse;

      const resolvedAnswer = payload.answer || payload.best_response || payload.response || 'No answer returned.';
      setAnswer(resolvedAnswer);
      setQueryMeta({
        modelVersion: payload.modelVersion,
        responseTimeMs: payload.response_time_ms,
        tokenCount: payload.token_count,
      });
      await refresh();
    } catch (queryError) {
      const message = queryError instanceof Error ? queryError.message : 'Failed to query the SLM';
      setError(message);
    } finally {
      setIsQuerying(false);
    }
  }, [fetchWithAuth, question, refresh]);

  const statusLabel = useMemo(() => {
    if (!hasDocuments) return 'Upload records to unlock training';
    if (status?.trainingInProgress) return 'Training in progress';
    if (status?.latestReadyModel) return `Model v${status.latestReadyModel.version} ready`;
    if (status?.latestModel?.status === 'failed') return 'Last training run failed';
    return 'No model trained yet';
  }, [hasDocuments, status]);

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-cyan-500/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.92),rgba(17,24,39,0.96))] p-8 shadow-[0_30px_120px_rgba(8,145,178,0.18)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.18),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_28%)]" />
      <div className="relative z-10 space-y-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-cyan-300/80">Personal SLM</p>
            <div>
              <h2 className="text-4xl font-black tracking-tight text-white">Train your own Qwen adapter.</h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-cyan-50/75">
                This panel starts Phase 1 training, shows version state from Supabase, and lets you query the latest ready adapter through the new SLM API surface.
              </p>
            </div>
          </div>

          <div className="min-w-[220px] rounded-[1.5rem] border border-white/10 bg-black/20 p-5 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/45">State</p>
            <p className="mt-2 text-xl font-black text-white">{statusLabel}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
              <span className={`rounded-full border px-3 py-1 ${status?.latestModel ? badgeClass(status.latestModel.status) : 'border-white/10 bg-white/5 text-white/50'}`}>
                {status?.latestModel?.status || 'uninitialized'}
              </span>
              {status?.latestReadyModel && (
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
                  v{status.latestReadyModel.version}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-6 backdrop-blur">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/75">Training Control</p>
                <p className="mt-2 text-2xl font-black text-white">Kick off knowledge injection.</p>
              </div>
              <button
                onClick={() => void handleTrain()}
                disabled={!hasDocuments || isTraining || status?.trainingInProgress}
                className="rounded-full bg-white px-6 py-3 text-[11px] font-black uppercase tracking-[0.25em] text-slate-950 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
              >
                {isTraining || status?.trainingInProgress ? 'Training...' : 'Train My Model'}
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Average Score</p>
                <p className="mt-3 text-3xl font-black text-white">
                  {status?.averageBestScore !== null && status?.averageBestScore !== undefined ? status.averageBestScore.toFixed(2) : '--'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Recent Feedback</p>
                <p className="mt-3 text-3xl font-black text-white">{status?.recentFeedbackCount ?? '--'}</p>
              </div>
              <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Pending Retrain</p>
                <p className="mt-3 text-3xl font-black text-white">{status?.pendingTrainingCount ?? '--'}</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/65">
              {!hasDocuments && 'No source documents found for this account yet.'}
              {hasDocuments && status?.latestModel && `Latest run recorded at ${formatTimestamp(status.latestModel.updated_at || status.latestModel.created_at)}.`}
              {hasDocuments && !status?.latestModel && 'The schema and routes are ready, but this user has not trained a model yet.'}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/75">Model Versions</p>
                <p className="mt-2 text-2xl font-black text-white">Latest adapters.</p>
              </div>
              <button
                onClick={() => void refresh()}
                disabled={isLoading}
                className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 transition hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {models.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-white/45">
                  No `slm_models` rows yet.
                </div>
              )}
              {models.map((model) => (
                <div key={model.id} className="rounded-2xl border border-white/8 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-lg font-black text-white">v{model.version}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-white/35">{model.base_model || 'Base model missing'}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${badgeClass(model.status)}`}>
                      {model.status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-white/55">{formatTimestamp(model.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-6 backdrop-blur">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-300/75">SLM Query</p>
          <div className="mt-4 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-4">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask the user-specific SLM a question about their uploaded records."
                className="min-h-[180px] w-full rounded-[1.5rem] border border-white/10 bg-slate-950/80 px-5 py-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-cyan-400/40"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void handleQuery()}
                  disabled={isQuerying || !question.trim() || !status?.latestReadyModel}
                  className="rounded-full bg-cyan-300 px-6 py-3 text-[11px] font-black uppercase tracking-[0.25em] text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
                >
                  {isQuerying ? 'Querying...' : 'Ask Model'}
                </button>
                {!status?.latestReadyModel && (
                  <span className="text-xs font-semibold text-white/45">A ready model is required before querying.</span>
                )}
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-white/35">Latest Answer</p>
              <div className="mt-4 min-h-[180px] whitespace-pre-wrap text-sm leading-7 text-white/85">
                {answer || 'No answer yet.'}
              </div>
              {queryMeta && (
                <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
                  {queryMeta.modelVersion !== undefined && (
                    <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200">
                      v{queryMeta.modelVersion}
                    </span>
                  )}
                  {queryMeta.responseTimeMs !== undefined && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
                      {queryMeta.responseTimeMs} ms
                    </span>
                  )}
                  {queryMeta.tokenCount !== undefined && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/60">
                      {queryMeta.tokenCount} tokens
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {(error || isLoading) && (
            <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-500/25 bg-red-500/10 text-red-200' : 'border-white/10 bg-white/5 text-white/55'}`}>
              {error || 'Loading SLM state...'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
