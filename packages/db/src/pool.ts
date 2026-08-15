import { Pool, type PoolClient } from "pg";

import { DatabaseConfigurationError } from "./errors";

const globalDatabase = globalThis as typeof globalThis & {
  __wanaflowPool?: Pool;
};

export function getDatabaseUrl() {
  const configured = process.env.DATABASE_URL;
  if (configured) return configured;

  if (process.env.NODE_ENV !== "production") {
    return "postgresql://wanaflow:wanaflow@127.0.0.1:5432/wanaflow";
  }

  throw new DatabaseConfigurationError("DATABASE_URL is required in production.");
}

export function getPool() {
  if (!globalDatabase.__wanaflowPool) {
    globalDatabase.__wanaflowPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      application_name: "wanaflow-web",
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  return globalDatabase.__wanaflowPool;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (globalDatabase.__wanaflowPool) {
    await globalDatabase.__wanaflowPool.end();
    globalDatabase.__wanaflowPool = undefined;
  }
}
