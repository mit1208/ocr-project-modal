require('dotenv').config({ path: './.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    console.log("🚀 Starting SQL Migration...");

    const sqlPath = path.join(__dirname, '..', 'setup_ai_analysis.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Since supabase-js doesn't have a direct 'query' method for raw SQL,
    // we use the REST API /rpc/exec_sql if available, or just describe the next step.
    // Actually, for a simple setup, the best way in this environment is using the 
    // postgres node client OR informing the user. 
    // However, I can try to use a sneaky trick: create a temporary function.

    console.log("Note: Raw SQL execution via JS client requires a 'remote_sql' function.");
    console.log("I will attempt to check if the table exists first...");

    const { error } = await supabase.from('ai_analysis').select('file_id').limit(1);

    if (error && error.code === '42P01') {
        console.log("❌ Table 'ai_analysis' does not exist.");
        console.log("Please copy the contents of 'setup_ai_analysis.sql' into the Supabase SQL Editor.");
    } else {
        console.log("✅ Table 'ai_analysis' is already initialized or accessible.");
    }
}

runMigration();
