import { NextRequest, NextResponse } from 'next/server';
import { buildImeCaseContext, buildImeResponsePayload, ensureImeSummary, IME_SECTION_DEFINITIONS, loadSectionChatHistory, normalizeImeSections, refineImeSection, updateImeSummarySections, upsertSectionChatHistory } from '@/lib/server/ime';
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

    const instruction = typeof body.message === 'string' ? body.message.trim() : '';
    if (!instruction) {
      return jsonError('message is required', 400);
    }

    const summary = await ensureImeSummary({
      userId: user.id,
      caseId,
      consultationSessionId: typeof body.consultationSessionId === 'string' ? body.consultationSessionId : null,
    });

    const currentSections = normalizeImeSections(summary.sections);
    const currentSection = currentSections.find((section) => section.type === sectionType);
    const chatHistory = await loadSectionChatHistory(summary.id, sectionType);
    const context = await buildImeCaseContext({
      userId: user.id,
      caseId,
      consultationSessionId: summary.consultation_session_id || null,
    });

    const refined = await refineImeSection({
      sectionType,
      currentContent: currentSection?.content || '',
      instruction,
      context,
      chatHistory,
      steeringContext: summary.steering_context || {},
    });

    const now = new Date().toISOString();
    const nextSections = currentSections.map((section) => (
      section.type === sectionType
        ? {
            ...section,
            content: refined.content,
            status: refined.status,
            lastInstruction: instruction,
            updatedAt: now,
          }
        : section
    ));

    const nextMessages = [
      ...chatHistory,
      { role: 'user', content: instruction, timestamp: now },
      { role: 'assistant', content: refined.content, timestamp: now },
    ];

    await upsertSectionChatHistory({
      summaryId: summary.id,
      userId: user.id,
      sectionType,
      messages: nextMessages,
    });

    const updated = await updateImeSummarySections({
      summaryId: summary.id,
      sections: nextSections,
      status: 'in_progress',
      steeringContext: refined.steeringContext,
    });

    return NextResponse.json({
      data: {
        ...buildImeResponsePayload({ summary: updated, context }),
        section: nextSections.find((section) => section.type === sectionType) || null,
        chatHistory: nextMessages,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to refine IME section', 401);
  }
}
