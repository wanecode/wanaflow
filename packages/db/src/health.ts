import { getPool } from "./pool";

export async function checkDatabaseHealth() {
  const startedAt = Date.now();
  const result = await getPool().query<{ current_database: string }>(
    "SELECT current_database()",
  );
  return {
    ok: true as const,
    database: result.rows[0].current_database,
    latencyMs: Date.now() - startedAt,
  };
}
