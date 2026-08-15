import { exportProjectPackage } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const [{ projectId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "project:read"),
    ]);
    return apiJson({ data: await exportProjectPackage(context, projectId) });
  } catch (error) {
    return apiError(error);
  }
}
