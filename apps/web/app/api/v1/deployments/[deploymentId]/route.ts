import { getDeployment } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ deploymentId: string }> },
) {
  try {
    const [{ deploymentId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "deployment:read"),
    ]);
    return apiJson(
      { data: await getDeployment(context, deploymentId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
