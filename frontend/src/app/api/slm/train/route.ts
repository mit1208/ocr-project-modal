import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseServiceClient,
  jsonError,
  proxyJsonToSlmService,
  requireAuthenticatedUser,
} from '@/lib/server/slm';
import { runLocalSlmTraining } from '@/lib/server/slm-local';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const supabase = createSupabaseServiceClient();

    const { count: documentCount, error: documentError } = await supabase
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (documentError) {
      return jsonError(documentError.message, 500);
    }

    if (!documentCount) {
      return jsonError('Upload at least one document before training a model.', 400);
    }

    const trainerUrl = process.env.SLM_TRAINER_URL;
    if (!trainerUrl) {
      const localResult = await runLocalSlmTraining({
        userId: user.id,
        force: Boolean(body.force),
        trainingConfig: body.trainingConfig ?? null,
      });
      return NextResponse.json({
        ok: true,
        userId: user.id,
        ...localResult,
      });
    }

    const upstream = await proxyJsonToSlmService({
      baseUrl: trainerUrl,
      path: '/train',
      body: {
        user_id: user.id,
        force: Boolean(body.force),
        training_config: body.trainingConfig ?? null,
      },
    });

    if (!upstream.ok) {
      const message =
        typeof upstream.payload?.error === 'string'
          ? upstream.payload.error
          : 'SLM training request failed.';
      return jsonError(message, upstream.status, { upstream: upstream.payload });
    }

    return NextResponse.json({
      ok: true,
      userId: user.id,
      ...upstream.payload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Missing bearer token' || message === 'Invalid or expired session' ? 401 : 500;
    return jsonError(message, status);
  }
}
