import { NextRequest, NextResponse } from 'next/server';
import { buildImeCaseContext, buildImeResponsePayload, ensureImeSummary, loadImeSummary, normalizeImeSections, updateImeSummarySections } from '@/lib/server/ime';
import { jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { caseId } = await params;
    const summary = await loadImeSummary(user.id, caseId);
    const context = await buildImeCaseContext({
      userId: user.id,
      caseId,
      consultationSessionId: summary?.consultation_session_id || null,
    });

    return NextResponse.json({
      data: buildImeResponsePayload({ summary, context }),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load IME summary', 401);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { caseId } = await params;
    const body = await request.json();

    const summary = await ensureImeSummary({
      userId: user.id,
      caseId,
      consultationSessionId: typeof body.consultationSessionId === 'string' ? body.consultationSessionId : null,
      templateId: typeof body.templateId === 'string' ? body.templateId : null,
      title: typeof body.title === 'string' ? body.title : null,
    });

    const sections = body.sections ? normalizeImeSections(body.sections) : normalizeImeSections(summary.sections);
    const updated = body.sections || body.status || body.title !== undefined || body.consultationSessionId !== undefined || body.templateId !== undefined || body.steeringContext
      ? await updateImeSummarySections({
          summaryId: summary.id,
          sections,
          status: typeof body.status === 'string' ? body.status : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          consultationSessionId: body.consultationSessionId !== undefined ? body.consultationSessionId : undefined,
          templateId: body.templateId !== undefined ? body.templateId : undefined,
          steeringContext: body.steeringContext && typeof body.steeringContext === 'object' ? body.steeringContext : undefined,
        })
      : summary;

    const context = await buildImeCaseContext({
      userId: user.id,
      caseId,
      consultationSessionId: updated.consultation_session_id || null,
    });

    return NextResponse.json({
      data: buildImeResponsePayload({ summary: updated, context }),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save IME summary', 401);
  }
}
