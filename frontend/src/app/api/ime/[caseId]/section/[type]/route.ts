import { NextRequest, NextResponse } from 'next/server';
import { buildImeCaseContext, buildImeResponsePayload, ensureImeSummary, generateImeSection, IME_SECTION_DEFINITIONS, normalizeImeSections, updateImeSummarySections } from '@/lib/server/ime';
import { jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; type: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { caseId, type } = await params;
    const body = await request.json();

    if (!IME_SECTION_DEFINITIONS.some((section) => section.type === type)) {
      return jsonError('Unknown IME section type', 400);
    }
    const sectionType = type as typeof IME_SECTION_DEFINITIONS[number]['type'];

    const summary = await ensureImeSummary({
      userId: user.id,
      caseId,
      consultationSessionId: typeof body.consultationSessionId === 'string' ? body.consultationSessionId : null,
      templateId: typeof body.templateId === 'string' ? body.templateId : null,
    });

    const currentSections = normalizeImeSections(summary.sections);
    const context = await buildImeCaseContext({
      userId: user.id,
      caseId,
      consultationSessionId: summary.consultation_session_id || null,
    });

    const generated = await generateImeSection({
      sectionType,
      context,
      currentSections,
      steeringContext: summary.steering_context || {},
    });

    const now = new Date().toISOString();
    const nextSections = currentSections.map((section) => (
      section.type === sectionType
        ? {
            ...section,
            content: generated.content,
            status: generated.status,
            sourcePages: generated.sourcePages,
            updatedAt: now,
          }
        : section
    ));

    const updated = await updateImeSummarySections({
      summaryId: summary.id,
      sections: nextSections,
      status: 'in_progress',
    });

    return NextResponse.json({
      data: {
        ...buildImeResponsePayload({ summary: updated, context }),
        section: nextSections.find((section) => section.type === sectionType) || null,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to generate IME section', 401);
  }
}
