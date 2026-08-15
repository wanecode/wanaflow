import { retryExternalJob } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const [{ jobId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "job:retry"),
    ]);
    return apiJson({ data: await retryExternalJob(context, jobId) });
  } catch (error) {
    return apiError(error);
  }
}
