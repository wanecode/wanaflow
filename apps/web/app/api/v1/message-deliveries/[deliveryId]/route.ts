import { getMessageDelivery } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deliveryId: string }> },
) {
  try {
    const [{ deliveryId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "message:read"),
    ]);
    return apiJson(
      { data: await getMessageDelivery(context, deliveryId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
