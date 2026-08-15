import { getProcessTask } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const [{ taskId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "task:read"),
    ]);
    return apiJson(
      { data: await getProcessTask(context, taskId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
