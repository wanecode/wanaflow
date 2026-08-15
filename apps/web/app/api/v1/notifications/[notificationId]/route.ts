import { markNotificationRead } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  try {
    const [{ notificationId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "notification:read"),
    ]);
    await markNotificationRead(context, notificationId);
    return apiJson({ data: { updated: true } });
  } catch (error) {
    return apiError(error);
  }
}
