import { NextRequest } from 'next/server';
import { buildImeCaseContext, buildImePdf, buildImeWordHtml, ensureImeSummary, normalizeImeSections } from '@/lib/server/ime';
import { jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
) {
  try {
    const user = await requireAuthenticatedUser(request);
    const { caseId } = await params;
    const body = await request.json();
    const format = body?.format === 'word' ? 'word' : 'pdf';

    const summary = await ensureImeSummary({
      userId: user.id,
      caseId,
      consultationSessionId: typeof body.consultationSessionId === 'string' ? body.consultationSessionId : null,
    });

    const context = await buildImeCaseContext({
      userId: user.id,
      caseId,
      consultationSessionId: summary.consultation_session_id || null,
    });
    const sections = normalizeImeSections(summary.sections);
    const title = summary.title || `IME Summary ${caseId}`;
    const safeCaseId = caseId.replace(/[^a-zA-Z0-9_-]+/g, '-');

    if (format === 'word') {
      const html = buildImeWordHtml({
        caseId,
        title,
        sections,
        recordsReviewed: context.recordsReviewed,
      });
      return new Response(html, {
        headers: {
          'Content-Type': 'application/msword',
          'Content-Disposition': `attachment; filename="ime-summary-${safeCaseId}.doc"`,
        },
      });
    }

    const pdf = await buildImePdf({
      caseId,
      title,
      sections,
      recordsReviewed: context.recordsReviewed,
    });

    return new Response(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ime-summary-${safeCaseId}.pdf"`,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to export IME summary', 401);
  }
}
