import { NextRequest, NextResponse } from 'next/server';
import { createDefaultImeSections, loadImeTemplates, normalizeImeSections } from '@/lib/server/ime';
import { createSupabaseServiceClient, jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

async function unsetExistingDefaults(userId: string) {
  const supabase = createSupabaseServiceClient();
  await supabase
    .from('ime_templates')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const templates = await loadImeTemplates(user.id);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load IME templates', 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return jsonError('name is required', 400);
    }

    if (body.isDefault) {
      await unsetExistingDefaults(user.id);
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('ime_templates')
      .insert({
        user_id: user.id,
        name,
        is_default: Boolean(body.isDefault),
        sections: body.sections ? normalizeImeSections(body.sections) : createDefaultImeSections(),
      });

    if (error) {
      return jsonError(error.message, 500);
    }

    const templates = await loadImeTemplates(user.id);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to create IME template', 401);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';

    if (!id) {
      return jsonError('id is required', 400);
    }

    if (body.isDefault) {
      await unsetExistingDefaults(user.id);
    }

    const payload: Record<string, unknown> = {};
    if (typeof body.name === 'string') payload.name = body.name.trim();
    if (body.sections) payload.sections = normalizeImeSections(body.sections);
    if (body.isDefault !== undefined) payload.is_default = Boolean(body.isDefault);

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('ime_templates')
      .update(payload)
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return jsonError(error.message, 500);
    }

    const templates = await loadImeTemplates(user.id);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to update IME template', 401);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';

    if (!id) {
      return jsonError('id is required', 400);
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('ime_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return jsonError(error.message, 500);
    }

    const templates = await loadImeTemplates(user.id);
    return NextResponse.json({ data: templates });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete IME template', 401);
  }
}
