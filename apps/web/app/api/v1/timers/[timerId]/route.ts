import { getProcessTimer } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ timerId: string }> },
) {
  try {
    const [{ timerId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "timer:read"),
    ]);
    return apiJson(
      { data: await getProcessTimer(context, timerId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
