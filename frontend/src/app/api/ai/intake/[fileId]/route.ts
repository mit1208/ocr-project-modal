import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  try {
    // 1. Fetch intake data and status
    const { data: analysis, error: analysisError } = await supabase
      .from('ai_analysis')
      .select('clinical_intake, intake_status, intake_passes')
      .eq('file_id', fileId)
      .maybeSingle();

    if (analysisError) throw analysisError;

    // 2. Fetch associated decisions
    const { data: decisions, error: decisionsError } = await supabase
      .from('intake_decisions')
      .select('item_type, item_id, action, edited_value, reason')
      .eq('file_id', fileId);

    if (decisionsError) throw decisionsError;

    // 3. Return combined payload
    // If intake_status is not 'complete', we can still return partial data from 'intake_passes'
    return NextResponse.json({
      status: 'success',
      data: {
        clinical_intake: analysis?.clinical_intake,
        intake_status: analysis?.intake_status || 'pending',
        partial_data: analysis?.intake_passes,
        decisions: decisions || []
      }
    });

  } catch (err: any) {
    console.error('Error fetching intake data:', err);
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
