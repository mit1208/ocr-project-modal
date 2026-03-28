const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env') });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/apply_sql.js path/to/file.sql [more.sql]');
  process.exit(1);
}

const connString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
if (!connString) {
  console.error('Missing SUPABASE_DB_URL or DATABASE_URL');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: connString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(file, 'utf8');
      console.log(`Applying ${file}...`);
      await client.query(sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
})();
