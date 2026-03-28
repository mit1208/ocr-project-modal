import { createClient, type User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

type JsonRecord = Record<string, unknown>;

type SupabaseModelRow = {
  id: string;
  user_id: string;
  version: number;
  adapter_path: string | null;
  status: string;
  base_model: string | null;
  training_config: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};

type SupabaseFeedbackRow = {
  scores: unknown;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createSupabaseAuthClient() {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  );
}

export function createSupabaseServiceClient() {
  return createClient(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader) return null;

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

export async function requireAuthenticatedUser(request: NextRequest): Promise<User> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error('Missing bearer token');
  }

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }

  return data.user;
}

export function jsonError(message: string, status = 400, extra?: JsonRecord) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status });
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), normalizedBase).toString();
}

export async function proxyJsonToSlmService(options: {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: JsonRecord;
  searchParams?: Record<string, string>;
}) {
  const method = options.method || 'POST';
  const url = new URL(joinUrl(options.baseUrl, options.path));

  for (const [key, value] of Object.entries(options.searchParams || {})) {
    url.searchParams.set(key, value);
  }

  const headers: HeadersInit = {
    Accept: 'application/json',
  };

  const serviceKey = process.env.SLM_SERVICE_API_KEY;
  if (serviceKey) {
    headers['x-slm-service-key'] = serviceKey;
  }

  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(options.body || {}),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : { message: await response.text() };

    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function extractBestScore(scores: unknown): number | null {
  if (!scores) return null;

  if (Array.isArray(scores)) {
    const numericValues = scores
      .map((entry) => {
        if (typeof entry === 'number') return entry;
        if (entry && typeof entry === 'object') {
          const candidate = (entry as Record<string, unknown>).overall
            ?? (entry as Record<string, unknown>).score
            ?? (entry as Record<string, unknown>).total;
          return typeof candidate === 'number' ? candidate : null;
        }
        return null;
      })
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (numericValues.length > 0) {
      return Math.max(...numericValues);
    }
  }

  if (scores && typeof scores === 'object') {
    const best = (scores as Record<string, unknown>).best_score;
    return typeof best === 'number' ? best : null;
  }

  return null;
}

export async function getUserSlmModels(userId: string) {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('slm_models')
    .select('id, user_id, version, adapter_path, status, base_model, training_config, created_at, updated_at')
    .eq('user_id', userId)
    .order('version', { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as SupabaseModelRow[];
}

export async function getUserSlmStatus(userId: string) {
  const supabase = createSupabaseServiceClient();
  const models = await getUserSlmModels(userId);

  const latestModel = models[0] || null;
  const latestReadyModel = models.find((model) => model.status === 'ready') || null;
  const trainingModel = models.find((model) => model.status === 'training') || null;

  const [{ data: feedbackRows, error: feedbackError }, { count: pendingTrainingCount, error: pendingError }] =
    await Promise.all([
      supabase
        .from('slm_feedback')
        .select('scores')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('slm_feedback')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('used_in_training', false),
    ]);

  if (feedbackError) {
    throw new Error(feedbackError.message);
  }
  if (pendingError) {
    throw new Error(pendingError.message);
  }

  const bestScores = ((feedbackRows || []) as SupabaseFeedbackRow[])
    .map((row) => extractBestScore(row.scores))
    .filter((value): value is number => value !== null);

  const averageBestScore = bestScores.length
    ? Number((bestScores.reduce((sum, value) => sum + value, 0) / bestScores.length).toFixed(2))
    : null;

  return {
    latestModel,
    latestReadyModel,
    trainingModel,
    trainingInProgress: Boolean(trainingModel),
    averageBestScore,
    recentFeedbackCount: bestScores.length,
    pendingTrainingCount: pendingTrainingCount || 0,
    models,
  };
}
