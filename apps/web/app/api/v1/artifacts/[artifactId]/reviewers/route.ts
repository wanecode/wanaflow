import { listReviewerCandidates } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const [{ artifactId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "review:create"),
    ]);
    return apiJson(
      { data: await listReviewerCandidates(context, artifactId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
