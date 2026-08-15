import { listMessageDeliveries } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "message:read");
    const query = new URL(request.url).searchParams;
    const status = query.get("status");
    const normalizedStatus = status && ["AVAILABLE", "CLAIMED", "DELIVERED", "NO_MATCH", "AMBIGUOUS"].includes(status)
      ? status as "AVAILABLE" | "CLAIMED" | "DELIVERED" | "NO_MATCH" | "AMBIGUOUS"
      : undefined;
    return apiJson({
      data: await listMessageDeliveries(context, {
        instanceId: query.get("instanceId") ?? undefined,
        status: normalizedStatus,
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
