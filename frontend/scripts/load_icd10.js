const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env') });

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node scripts/load_icd10.js /path/to/icd10.csv');
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const raw = fs.readFileSync(csvPath, 'utf8');
const records = parse(raw, { columns: true, skip_empty_lines: true });

const normalizeBool = (value) => {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(v)) return true;
    if (['false', '0', 'no', 'n'].includes(v)) return false;
  }
  return null;
};

const rows = records.map((r) => ({
  code: r.code ? String(r.code).trim() : null,
  description: r.description ? String(r.description).trim() : null,
  category: r.category || null,
  is_billable: normalizeBool(r.is_billable),
  is_hcc: normalizeBool(r.is_hcc),
  hcc_category: r.hcc_category || null,
})).filter(r => r.code && r.description);

const batchSize = 1000;
let inserted = 0;

(async () => {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('icd10_codes').upsert(batch, { onConflict: 'code' });
    if (error) {
      console.error('Insert failed:', error);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${rows.length}`);
  }

  console.log('ICD-10 load complete');
})();
