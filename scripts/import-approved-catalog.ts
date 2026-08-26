import { Pool } from "pg";
import { importApprovedSpainCatalog } from "../src/lib/catalog/import-approved-catalog";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to import the approved catalog.");

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await importApprovedSpainCatalog(client);
    await client.query("COMMIT");
    process.stdout.write(`Imported ${result.imported} approved catalog products.\n`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
