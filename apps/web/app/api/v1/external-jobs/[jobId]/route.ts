import { getExternalJob } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const [{ jobId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "job:read"),
    ]);
    return apiJson({ data: await getExternalJob(context, jobId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
