import { closePool, getPool } from "./pool";
import { migrations } from "./migrations";

export async function runMigrations() {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('wanaflow:migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const appliedIds = new Set(applied.rows.map((row) => row.id));

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        console.info(`Applied migration ${migration.id}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('wanaflow:migrations'))");
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(async () => closePool())
    .catch(async (error: unknown) => {
      console.error(error);
      await closePool();
      process.exitCode = 1;
    });
}
