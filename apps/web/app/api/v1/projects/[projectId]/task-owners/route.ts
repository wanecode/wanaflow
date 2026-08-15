import { listTaskOwnerOptions } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const [{ projectId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "artifact:read"),
    ]);
    return apiJson(
      { data: await listTaskOwnerOptions(context, projectId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
