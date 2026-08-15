import { getProcessInstance } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  try {
    const [{ instanceId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "instance:read"),
    ]);
    return apiJson(
      { data: await getProcessInstance(context, instanceId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
