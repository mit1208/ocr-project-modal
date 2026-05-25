import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServiceClient, jsonError, requireAuthenticatedUser } from '@/lib/server/slm';
import { EMPTY_SUMMARY, generateConsultationInsights, loadConsultationSession, loadLatestConsultationForCase } from '@/lib/server/consultation';

async function createConsultationSession(request: NextRequest, userId: string) {
  const body = await request.json();
  const caseId = typeof body.caseId === 'string' ? body.caseId : '';
  const title = typeof body.title === 'string' ? body.title : null;
  const speakerLabels = body.speakerLabels && typeof body.speakerLabels === 'object'
    ? body.speakerLabels as Record<string, string>
    : { doctor: 'Doctor', patient: 'Patient' };

  if (!caseId) {
    return jsonError('caseId is required', 400);
  }

  const supabase = createSupabaseServiceClient();
  const { data: session, error: sessionError } = await supabase
    .from('consultation_sessions')
    .insert({
      case_id: caseId,
      user_id: userId,
      title,
      status: 'recording',
      speaker_labels: speakerLabels,
    })
    .select('id')
    .single();

  if (sessionError || !session?.id) {
    return jsonError(sessionError?.message || 'Failed to create consultation session', 500);
  }

  const { error: summaryError } = await supabase
    .from('consultation_summary')
    .insert({
      session_id: session.id,
      user_id: userId,
      summary_json: EMPTY_SUMMARY,
      suggested_questions_json: [],
      checklist_json: [],
      version: 1,
      is_final: false,
    });

  if (summaryError) {
    return jsonError(summaryError.message, 500);
  }

  const payload = await loadConsultationSession(userId, session.id);
  return NextResponse.json({ data: payload });
}

async function appendTranscriptToSession(request: NextRequest, userId: string, sessionId: string) {
  const body = await request.json();
  const segments = Array.isArray(body.segments) ? body.segments : [body];
  const supabase = createSupabaseServiceClient();

  const existing = await loadConsultationSession(userId, sessionId);
  if (!existing) {
    return jsonError('Consultation session not found', 404);
  }

  const nextSequenceStart = existing.transcript.length;
  const transcriptRows = segments
    .map((segment: any, index: number) => {
      const speaker = segment?.speaker === 'doctor' ? 'doctor' : 'patient';
      const text = typeof segment?.text === 'string' ? segment.text.trim() : '';
      const timestamp = typeof segment?.timestamp === 'number' ? segment.timestamp : nextSequenceStart + index;
      if (!text) return null;
      return {
        session_id: sessionId,
        user_id: userId,
        sequence: nextSequenceStart + index + 1,
        speaker,
        text,
        timestamp,
      };
    })
    .filter(Boolean);

  if (transcriptRows.length === 0) {
    return jsonError('At least one transcript segment with text is required', 400);
  }

  const { error: insertError } = await supabase
    .from('consultation_transcript')
    .insert(transcriptRows);

  if (insertError) {
    return jsonError(insertError.message, 500);
  }

  const refreshed = await loadConsultationSession(userId, sessionId);
  if (!refreshed) {
    return jsonError('Failed to reload consultation session', 500);
  }

  const insights = await generateConsultationInsights(refreshed.transcript, refreshed.summary);

  const nextVersion = (refreshed.version || 0) + 1;
  const { error: summaryError } = await supabase
    .from('consultation_summary')
    .insert({
      session_id: sessionId,
      user_id: userId,
      summary_json: insights.summary,
      suggested_questions_json: insights.suggestedQuestions,
      checklist_json: insights.suggestedQuestions,
      version: nextVersion,
      is_final: false,
    });

  if (summaryError) {
    return jsonError(summaryError.message, 500);
  }

  const payload = await loadConsultationSession(userId, sessionId);
  return NextResponse.json({ data: payload });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sessionId } = await params;

    if (sessionId === 'latest') {
      const caseId = request.nextUrl.searchParams.get('caseId') || '';
      if (!caseId) {
        return jsonError('caseId query parameter is required for latest consultation lookup', 400);
      }
      const payload = await loadLatestConsultationForCase(user.id, caseId);
      return NextResponse.json({ data: payload });
    }

    const payload = await loadConsultationSession(user.id, sessionId);
    if (!payload) {
      return jsonError('Consultation session not found', 404);
    }

    return NextResponse.json({ data: payload });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load consultation session', 401);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sessionId } = await params;

    if (sessionId === 'new') {
      return createConsultationSession(request, user.id);
    }

    return appendTranscriptToSession(request, user.id, sessionId);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update consultation session', 401);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { sessionId } = await params;
    const body = await request.json();

    const supabase = createSupabaseServiceClient();
    const updatePayload: Record<string, unknown> = {};

    if (typeof body.status === 'string') {
      updatePayload.status = body.status;
      if (body.status === 'completed') {
        updatePayload.ended_at = new Date().toISOString();
      }
    }
    if (typeof body.title === 'string') {
      updatePayload.title = body.title;
    }
    if (body.speakerLabels && typeof body.speakerLabels === 'object') {
      updatePayload.speaker_labels = body.speakerLabels;
    }

    const { error } = await supabase
      .from('consultation_sessions')
      .update(updatePayload)
      .eq('id', sessionId)
      .eq('user_id', user.id);

    if (error) {
      return jsonError(error.message, 500);
    }

    if (body.status === 'completed') {
      const latest = await loadConsultationSession(user.id, sessionId);
      if (latest) {
        const { error: summaryError } = await supabase
          .from('consultation_summary')
          .update({ is_final: true })
          .eq('session_id', sessionId)
          .eq('user_id', user.id)
          .eq('version', latest.version);
        if (summaryError) {
          return jsonError(summaryError.message, 500);
        }
      }
    }

    const payload = await loadConsultationSession(user.id, sessionId);
    return NextResponse.json({ data: payload });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to patch consultation session', 401);
  }
}
