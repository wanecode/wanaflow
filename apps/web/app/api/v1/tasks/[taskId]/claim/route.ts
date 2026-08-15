import { claimProcessTask } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const [{ taskId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "task:complete"),
    ]);
    return apiJson({ data: await claimProcessTask(context, taskId) });
  } catch (error) {
    return apiError(error);
  }
}
