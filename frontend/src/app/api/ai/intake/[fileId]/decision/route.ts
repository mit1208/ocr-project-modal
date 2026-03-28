import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  try {
    const payload = await req.json();
    const { item_type, item_id, action, edited_value, reason } = payload;

    if (!item_type || !item_id || !action) {
      return NextResponse.json({ status: 'error', message: 'Missing required fields' }, { status: 400 });
    }

    // Upsert the decision
    // Note: in a real app, we'd get the user_id from the session.
    // For this context, we'll assume the client is authenticated or we use service role.
    const { data, error } = await supabase
      .from('intake_decisions')
      .upsert({
        file_id: fileId,
        item_type,
        item_id,
        action,
        edited_value,
        reason,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'file_id,item_type,item_id'
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ status: 'success', data });

  } catch (err: any) {
    console.error('Error saving intake decision:', err);
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
