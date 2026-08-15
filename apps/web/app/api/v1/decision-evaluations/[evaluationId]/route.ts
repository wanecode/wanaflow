import { getDecisionEvaluation } from "@wanaflow/db";

import { apiError, apiJson } from "@/lib/server/api-response";
import { requirePrincipalContext } from "@/lib/server/authenticated-context";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ evaluationId: string }> },
) {
  try {
    const [{ evaluationId }, context] = await Promise.all([
      params,
      requirePrincipalContext(request, "decision:read"),
    ]);
    return apiJson(
      { data: await getDecisionEvaluation(context, evaluationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
