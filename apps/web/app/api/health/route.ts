import { checkDatabaseHealth } from "@wanaflow/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const database = await checkDatabaseHealth();
    return Response.json(
      {
        status: "ready",
        database: { ok: database.ok, latencyMs: database.latencyMs },
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", checkedAt: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
