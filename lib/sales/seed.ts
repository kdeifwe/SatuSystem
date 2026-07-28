// NOTE: requires `npm install pg` and `SUPABASE_DB_URL` in .env.local
// Example: postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

config({ path: '.env.local' });

/**
 * Runs SQL seed files from /db/seeds/ directory using direct PostgreSQL connection.
 * Use only in development or one-time setup.
 *
 * Requires: npm install pg
 * Requires env: SUPABASE_DB_URL (or DATABASE_URL)
 */
export async function runSalesSeeds(): Promise<{ success: boolean; message: string }> {
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;

  if (!dbUrl) {
    return {
      success: false,
      message: 'Missing SUPABASE_DB_URL or DATABASE_URL in environment',
    };
  }

  const client = new Client({ connectionString: dbUrl });
  const seedsDir = path.join(process.cwd(), 'db', 'seeds');

  try {
    await client.connect();

    const files = fs.readdirSync(seedsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf-8');
      await client.query(sql);
      console.log(`[SEED] ✅ ${file}`);
    }

    return { success: true, message: `Executed ${files.length} seed files` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[SEED] Failed:', message);
    return { success: false, message };
  } finally {
    await client.end();
  }
}

// Allow direct execution: npx ts-node lib/sales/seed.ts
if (require.main === module) {
  runSalesSeeds().then((result) => {
    console.log(result.message);
    process.exit(result.success ? 0 : 1);
  });
}
