import { listExternalJobs } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "job:read");
    const query = new URL(request.url).searchParams;
    const status = query.get("status");
    const normalizedStatus = status && ["WAITING", "COMPLETED", "CANCELLED"].includes(status)
      ? status as "WAITING" | "COMPLETED" | "CANCELLED"
      : undefined;
    return apiJson({ data: await listExternalJobs(context, {
      instanceId: query.get("instanceId") ?? undefined,
      status: normalizedStatus,
    }) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
