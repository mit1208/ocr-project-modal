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
  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'csv';

  try {
    // 1. Fetch data
    const { data: analysis } = await supabase.from('ai_analysis').select('clinical_intake').eq('file_id', fileId).single();
    const { data: decisions } = await supabase.from('intake_decisions').select('*').eq('file_id', fileId);

    if (!analysis?.clinical_intake) {
      return NextResponse.json({ status: 'error', message: 'No intake data found' }, { status: 404 });
    }

    const intake = analysis.clinical_intake;
    const decisionMap = new Map((decisions || []).map(d => [`${d.item_type}:${d.item_id}`, d]));

    // 2. Filter and Apply Decisions
    const filterItems = (items: any[], type: string) => {
      return (items || []).filter(item => {
        const d = decisionMap.get(`${type}:${item.id}`);
        return !d || (d.action !== 'rejected' && d.action !== 'dismissed');
      }).map(item => {
        const d = decisionMap.get(`${type}:${item.id}`);
        if (d?.action === 'edited' && d.edited_value) {
          return { ...item, ...d.edited_value };
        }
        return item;
      });
    };

    const exportedData = {
      problem_list: filterItems(intake.problem_list, 'diagnosis'),
      medications: filterItems(intake.medications, 'medication'),
      completed_workup: filterItems(intake.completed_workup, 'workup'),
      flags: filterItems(intake.flags, 'flag')
    };

    // 3. Generate Format
    if (format === 'csv') {
      const csv = buildCsv(exportedData);
      return new Response(csv, {
        headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="intake-${fileId}.csv"` }
      });
    }

    if (format === 'fhir') {
        // Simple FHIR collection bundle
        const bundle = {
            resourceType: 'Bundle',
            type: 'collection',
            entry: exportedData.problem_list.map((p: any) => ({
                resource: {
                    resourceType: 'Condition',
                    code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: p.icd10_code, display: p.description }] },
                    clinicalStatus: { text: p.status || 'active' }
                }
            }))
        };
        return NextResponse.json(bundle);
    }

    return NextResponse.json({ status: 'error', message: 'Format not supported yet' }, { status: 400 });

  } catch (err: any) {
    console.error('Export failed:', err);
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}

function buildCsv(data: any) {
  const rows = [['Type', 'ID', 'Code', 'Description', 'Detail', 'Status']];
  data.problem_list.forEach((p: any) => rows.push(['Problem', p.id, p.icd10_code || '', p.description, p.icd10_description || '', p.status || '']));
  data.medications.forEach((m: any) => rows.push(['Medication', m.id, '', m.name, `${m.dose || ''} ${m.frequency || ''}`, '']));
  data.completed_workup.forEach((w: any) => rows.push(['Workup', w.id, w.cpt_code || '', w.description, w.key_findings || '', w.status || '']));
  
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}
