import { listNotifications, markAllNotificationsRead } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "notification:read");
    const query = new URL(request.url).searchParams;
    return apiJson({
      data: await listNotifications(context, {
        unreadOnly: query.get("unread") === "true",
        limit: Number(query.get("limit") ?? 50),
      }),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requirePrincipalContext(request, "notification:read");
    return apiJson({ data: { updated: await markAllNotificationsRead(context) } });
  } catch (error) {
    return apiError(error);
  }
}
