import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServiceClient, jsonError, proxyJsonToSlmService, requireAuthenticatedUser } from '@/lib/server/slm';
import { runLocalSlmQuery } from '@/lib/server/slm-local';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const question = typeof body.question === 'string' ? body.question.trim() : '';

    if (!question) {
      return jsonError('Question is required.', 400);
    }

    const serverUrl = process.env.SLM_SERVER_URL;
    if (!serverUrl) {
      const payload = await runLocalSlmQuery({
        userId: user.id,
        query: question,
        topK: typeof body.topK === 'number' ? body.topK : 4,
      });
      return NextResponse.json({
        ok: true,
        userId: user.id,
        modelVersion: payload.model_version,
        ...payload,
      });
    }

    const supabase = createSupabaseServiceClient();
    const { data: model, error: modelError } = await supabase
      .from('slm_models')
      .select('version, status')
      .eq('user_id', user.id)
      .eq('status', 'ready')
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (modelError) {
      return jsonError(modelError.message, 500);
    }

    if (!model) {
      return jsonError('No ready SLM model found. Train the model first.', 409);
    }

    const upstream = await proxyJsonToSlmService({
      baseUrl: serverUrl,
      path: '/query',
      body: {
        user_id: user.id,
        query: question,
        top_k: typeof body.topK === 'number' ? body.topK : 4,
      },
    });

    if (!upstream.ok) {
      const message =
        typeof upstream.payload?.error === 'string'
          ? upstream.payload.error
          : 'SLM query failed.';
      return jsonError(message, upstream.status, { upstream: upstream.payload });
    }

    return NextResponse.json({
      ok: true,
      userId: user.id,
      modelVersion: model.version,
      ...upstream.payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Missing bearer token' || message === 'Invalid or expired session' ? 401 : 500;
    return jsonError(message, status);
  }
}
