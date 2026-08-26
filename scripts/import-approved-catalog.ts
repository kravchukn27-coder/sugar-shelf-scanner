import { Pool } from "pg";
import { importApprovedSpainCatalog } from "../src/lib/catalog/import-approved-catalog";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to import the approved catalog.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const result = await importApprovedSpainCatalog(pool);
  process.stdout.write(`Imported ${result.imported} approved catalog products.\n`);
} finally {
  await pool.end();
}
