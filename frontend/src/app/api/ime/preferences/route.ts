import { NextRequest, NextResponse } from 'next/server';
import { loadImePreferences } from '@/lib/server/ime';
import { createSupabaseServiceClient, jsonError, requireAuthenticatedUser } from '@/lib/server/slm';

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const preferences = await loadImePreferences(user.id);
    return NextResponse.json({ data: preferences });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to load IME preferences', 401);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json();
    const preferenceKey = typeof body.preferenceKey === 'string' ? body.preferenceKey.trim() : '';

    if (!preferenceKey) {
      return jsonError('preferenceKey is required', 400);
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from('user_ime_preferences')
      .upsert({
        user_id: user.id,
        preference_key: preferenceKey,
        preference_value: body.preferenceValue && typeof body.preferenceValue === 'object' ? body.preferenceValue : {},
        confidence: typeof body.confidence === 'number' ? body.confidence : 0.6,
      }, {
        onConflict: 'user_id,preference_key',
      });

    if (error) {
      return jsonError(error.message, 500);
    }

    const preferences = await loadImePreferences(user.id);
    return NextResponse.json({ data: preferences });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save IME preference', 401);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request);
    const body = await request.json().catch(() => ({}));
    const supabase = createSupabaseServiceClient();

    let query = supabase
      .from('user_ime_preferences')
      .delete()
      .eq('user_id', user.id);

    if (typeof body.preferenceKey === 'string') {
      query = query.eq('preference_key', body.preferenceKey);
    }

    const { error } = await query;
    if (error) {
      return jsonError(error.message, 500);
    }

    const preferences = await loadImePreferences(user.id);
    return NextResponse.json({ data: preferences });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to delete IME preference', 401);
  }
}
