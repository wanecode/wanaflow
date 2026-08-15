import { listProcessTimers } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "timer:read");
    const query = new URL(request.url).searchParams;
    const status = query.get("status");
    const normalizedStatus = status && ["WAITING", "FIRED", "CANCELLED"].includes(status)
      ? status as "WAITING" | "FIRED" | "CANCELLED"
      : undefined;
    return apiJson({
      data: await listProcessTimers(context, {
        instanceId: query.get("instanceId") ?? undefined,
        status: normalizedStatus,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
